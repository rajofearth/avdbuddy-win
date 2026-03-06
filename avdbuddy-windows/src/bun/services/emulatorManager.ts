import { accessSync, constants, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, renameSync, rmSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import type {
  EmulatorInstance,
  AndroidToolchainStatus,
  CreateAVDResolvedConfiguration,
  AndroidSystemImage,
  AndroidVersionFamily,
  CreateAVDDeviceType,
  CommandResult,
} from "../models/types.ts";
import {
  parseApiLevel,
  parseDeviceType,
  parseColorSeed,
  parseDeviceName,
  parseSkinName,
  parseSkinPath,
  parseShowDeviceFrame,
} from "./configParser.ts";
import { apiLevelFromIdentifier } from "../models/versionCatalog.ts";
import {
  toolchainStatus,
  resolveToolchain,
  setStoredSDKPath,
  autodetectedSDKPath,
  preferredSDKPath,
} from "./sdkLocator.ts";
import { runCommand, runCommandStreaming } from "./commandRunner.ts";
import { parseSdkManagerOutput, versionFamilies } from "./systemImageCatalog.ts";

let cachedImages: AndroidSystemImage[] | null = null;
const RECOVERABLE_SDKMANAGER_WARNINGS = [
  "Dependant package with key emulator not found!",
  "Unable to compute a complete list of dependencies.",
] as const;
const SYSTEM_IMAGE_FEED_URLS: Record<string, string> = {
  default:
    "https://dl.google.com/android/repository/sys-img/android/sys-img2-1.xml",
  google_apis:
    "https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-1.xml",
  google_apis_playstore:
    "https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-1.xml",
};

const systemImageFeedCache = new Map<string, Promise<Set<string>>>();

interface ParsedSystemImagePackagePath {
  versionIdentifier: string;
  tag: string;
  abi: string;
}

function appendOutput(
  current: string,
  chunk: string,
  onOutput?: (chunk: string) => void
): string {
  onOutput?.(chunk);
  return current + chunk;
}

function commandError(result: CommandResult, fallback: string): string {
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(-6).join("\n") || fallback;
}

function combinedCommandOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function hasRecoverableSdkManagerWarning(output: string): boolean {
  return RECOVERABLE_SDKMANAGER_WARNINGS.some((warning) => output.includes(warning));
}

function parseSystemImagePackagePath(
  packagePath: string
): ParsedSystemImagePackagePath | null {
  const parts = packagePath.split(";");
  if (parts.length !== 4 || parts[0] !== "system-images") return null;
  const [, versionIdentifier, tag, abi] = parts;
  if (!versionIdentifier || !tag || !abi) return null;
  return { versionIdentifier, tag, abi };
}

function parseInstalledPackages(output: string): Set<string> {
  const installed = new Set<string>();
  let inInstalledSection = false;

  for (const rawLine of output.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "Installed packages:") {
      inInstalledSection = true;
      continue;
    }
    if (trimmed === "Available Packages:" || trimmed === "Available Updates:") {
      inInstalledSection = false;
      continue;
    }
    if (!inInstalledSection || trimmed.length === 0) continue;

    const pkg = trimmed.split("|")[0]?.trim();
    if (
      pkg &&
      pkg !== "Path" &&
      !/^[-\s]+$/.test(pkg) &&
      /^[a-z0-9][^|\s]*$/i.test(pkg)
    ) {
      installed.add(pkg);
    }
  }

  return installed;
}

async function sdkManagerListResult(sdkPath: string): Promise<CommandResult> {
  const toolchain = resolveToolchain(sdkPath);
  return await runCommand(toolchain.sdkManager, [
    `--sdk_root=${sdkPath}`,
    "--list",
  ]);
}

async function isPackageInstalled(
  sdkPath: string,
  packagePath: string
): Promise<boolean> {
  const result = await sdkManagerListResult(sdkPath);
  const output = combinedCommandOutput(result);
  return parseInstalledPackages(output).has(packagePath);
}

function systemImageVersionPreference(versionIdentifier: string): {
  tier: number;
  extensionLevel: number;
} {
  const extMatch = versionIdentifier.match(/^android-\d+-ext(\d+)$/);
  if (extMatch) {
    return {
      tier: 0,
      extensionLevel: Number(extMatch[1] ?? "0"),
    };
  }
  if (/^android-\d+$/.test(versionIdentifier)) {
    return { tier: 1, extensionLevel: 0 };
  }
  return { tier: 2, extensionLevel: 0 };
}

function normalizeSystemImagePackagePathWithAvailablePackages(
  requestedPackagePath: string,
  availablePackagePaths: Iterable<string>,
  installedPackagePaths: Iterable<string> = []
): string {
  const installed = new Set(installedPackagePaths);
  if (installed.has(requestedPackagePath)) return requestedPackagePath;

  const parsedRequested = parseSystemImagePackagePath(requestedPackagePath);
  if (!parsedRequested) return requestedPackagePath;

  const available = new Set(availablePackagePaths);
  if (available.has(requestedPackagePath)) return requestedPackagePath;

  const requestedApi = apiLevelFromIdentifier(parsedRequested.versionIdentifier);
  if (requestedApi === null) return requestedPackagePath;

  const candidates = [...available].filter((candidate) => {
    const parsedCandidate = parseSystemImagePackagePath(candidate);
    if (!parsedCandidate) return false;
    if (
      parsedCandidate.tag !== parsedRequested.tag ||
      parsedCandidate.abi !== parsedRequested.abi
    ) {
      return false;
    }
    return apiLevelFromIdentifier(parsedCandidate.versionIdentifier) === requestedApi;
  });

  const selected = candidates.sort((a, b) => {
    const parsedA = parseSystemImagePackagePath(a)!;
    const parsedB = parseSystemImagePackagePath(b)!;
    const prefA = systemImageVersionPreference(parsedA.versionIdentifier);
    const prefB = systemImageVersionPreference(parsedB.versionIdentifier);
    if (prefA.tier !== prefB.tier) return prefA.tier - prefB.tier;
    if (prefA.extensionLevel !== prefB.extensionLevel) {
      return prefB.extensionLevel - prefA.extensionLevel;
    }
    return parsedB.versionIdentifier.localeCompare(parsedA.versionIdentifier);
  })[0];

  return selected ?? requestedPackagePath;
}

async function officialSystemImagePackagePaths(tag: string): Promise<Set<string> | null> {
  const feedURL = SYSTEM_IMAGE_FEED_URLS[tag];
  if (!feedURL) return null;

  if (!systemImageFeedCache.has(feedURL)) {
    systemImageFeedCache.set(
      feedURL,
      (async () => {
        const response = await fetch(feedURL);
        if (!response.ok) {
          throw new Error(
            `Failed to load Android system image metadata (${response.status} ${response.statusText}).`
          );
        }
        const repositoryXML = await response.text();
        return new Set(
          [...repositoryXML.matchAll(/<remotePackage path="(system-images;[^"]+)">/g)]
            .map((match) => match[1])
            .filter((value): value is string => Boolean(value))
        );
      })()
    );
  }

  return await systemImageFeedCache.get(feedURL)!;
}

async function canonicalSystemImagePackagePath(
  sdkPath: string,
  requestedPackagePath: string
): Promise<string> {
  const parsedRequested = parseSystemImagePackagePath(requestedPackagePath);
  if (!parsedRequested) return requestedPackagePath;

  try {
    const officialPackages = await officialSystemImagePackagePaths(parsedRequested.tag);
    if (!officialPackages) return requestedPackagePath;

    const installedPackages = parseInstalledPackages(
      combinedCommandOutput(await sdkManagerListResult(sdkPath))
    );
    return normalizeSystemImagePackagePathWithAvailablePackages(
      requestedPackagePath,
      officialPackages,
      installedPackages
    );
  } catch (error: any) {
    logBackendWarning(
      "system image package normalization skipped",
      error?.message ?? String(error)
    );
    return requestedPackagePath;
  }
}

function logBackendWarning(context: string, detail: string): void {
  console.warn(`[AvdBuddy] ${context}: ${detail}`);
}

function avdRootDir(): string {
  const home = homedir();
  return join(home, ".android", "avd");
}

function avdDir(name: string): string {
  return join(avdRootDir(), `${name}.avd`);
}

function linuxNeedsSoftwareAcceleration(): boolean {
  if (process.platform !== "linux") return false;
  try {
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

function fallbackColorSeed(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function avdMetadata(
  name: string
): { apiLevel: number | null; deviceType: string; colorSeed: string | null } {
  const configPath = join(avdDir(name), "config.ini");
  try {
    const config = readFileSync(configPath, "utf-8");
    return {
      apiLevel: parseApiLevel(config),
      deviceType: parseDeviceType(config),
      colorSeed: parseColorSeed(config),
    };
  } catch {
    return { apiLevel: null, deviceType: "unknown", colorSeed: null };
  }
}

export function getToolchainStatus(): AndroidToolchainStatus {
  return toolchainStatus();
}

export function getAutodetectedSDKPath(): string | null {
  return autodetectedSDKPath();
}

export function updateSDKPath(path: string | null): AndroidToolchainStatus {
  setStoredSDKPath(path);
  cachedImages = null;
  return toolchainStatus();
}

export function refreshEmulators(): EmulatorInstance[] {
  const root = avdRootDir();
  if (!existsSync(root)) return [];

  let files: string[];
  try {
    files = readdirSync(root);
  } catch {
    return [];
  }

  const iniFiles = files
    .filter((f) => f.endsWith(".ini") && !f.endsWith(".avd.ini"))
    .map((f) => f.replace(/\.ini$/, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return iniFiles.map((name) => {
    const meta = avdMetadata(name);
    return {
      id: name,
      name,
      apiLevel: meta.apiLevel,
      deviceType: meta.deviceType as EmulatorInstance["deviceType"],
      colorSeed: meta.colorSeed ?? fallbackColorSeed(name),
      isRunning: false,
      isDeleting: false,
    };
  });
}

export async function getRunningEmulators(): Promise<Set<string>> {
  const status = toolchainStatus();
  if (!status.isConfigured) return new Set();

  const toolchain = resolveToolchain(status.sdkPath);
  try {
    const result = await runCommand(toolchain.adb, ["devices"]);
    const serials = result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("emulator-") && l.endsWith("\tdevice"))
      .map((l) => l.split("\t")[0]!);

    const names = new Set<string>();
    for (const serial of serials) {
      const name = await getAvdName(serial, toolchain.adb);
      if (name) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function getAvdName(
  serial: string,
  adb: string
): Promise<string | null> {
  try {
    const r1 = await runCommand(adb, [
      "-s", serial, "shell", "getprop", "ro.boot.qemu.avd_name",
    ]);
    const name1 = parseAvdNameFromOutput(r1.stdout);
    if (name1) return name1;
  } catch { /* ignore */ }

  try {
    const r2 = await runCommand(adb, ["-s", serial, "emu", "avd", "name"]);
    return parseAvdNameFromOutput(r2.stdout);
  } catch {
    return null;
  }
}

function parseAvdNameFromOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "OK" && !l.startsWith("KO:"));
  return lines[0] ?? null;
}

export async function launchEmulator(name: string): Promise<string> {
  const status = toolchainStatus();
  if (!status.isConfigured) throw new Error(status.summary);

  const toolchain = resolveToolchain(status.sdkPath);
  const args = ["-avd", name];
  if (linuxNeedsSoftwareAcceleration()) {
    args.push("-accel", "off", "-gpu", "swiftshader_indirect");
  }

  const configPath = join(avdDir(name), "config.ini");
  try {
    const config = readFileSync(configPath, "utf-8");
    const showFrame = parseShowDeviceFrame(config);
    const skinName = parseSkinName(config);
    const skinPath = parseSkinPath(config);
    if (showFrame !== false) {
      if (skinName && skinPath && existsSync(skinPath)) {
        args.push("-skindir", dirname(skinPath), "-skin", skinName);
      }
    }
  } catch {
    // ignore config overrides
  }
  await runCommand(toolchain.emulator, args, { waitForExit: false });
  return `Launched ${name}.`;
}

export async function stopEmulator(name: string): Promise<string> {
  const status = toolchainStatus();
  if (!status.isConfigured) throw new Error(status.summary);

  const toolchain = resolveToolchain(status.sdkPath);
  const devicesResult = await runCommand(toolchain.adb, ["devices"]);
  const serials = devicesResult.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("emulator-") && l.endsWith("\tdevice"))
    .map((l) => l.split("\t")[0]!);

  for (const serial of serials) {
    const avdName = await getAvdName(serial, toolchain.adb);
    if (avdName === name) {
      await runCommand(toolchain.adb, ["-s", serial, "emu", "kill"]);
      return `Stopped ${name}.`;
    }
  }
  return `${name} is not running.`;
}

export async function deleteEmulator(name: string): Promise<string> {
  const status = toolchainStatus();
  if (!status.isConfigured) throw new Error(status.summary);

  const toolchain = resolveToolchain(status.sdkPath);
  await runCommand(toolchain.avdManager, ["delete", "avd", "-n", name]);
  return `Deleted ${name}.`;
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export function duplicateEmulator(name: string): string {
  const emulators = refreshEmulators();
  const existingNames = new Set(emulators.map((e) => e.name));
  let duplicatedName = `${name}_Copy`;
  if (existingNames.has(duplicatedName)) {
    let counter = 2;
    while (existingNames.has(`${duplicatedName} ${counter}`)) counter++;
    duplicatedName = `${duplicatedName} ${counter}`;
  }

  const srcDir = avdDir(name);
  const destDir = avdDir(duplicatedName);
  copyDirSync(srcDir, destDir);

  const srcIni = join(avdRootDir(), `${name}.ini`);
  const destIni = join(avdRootDir(), `${duplicatedName}.ini`);
  copyFileSync(srcIni, destIni);

  rewriteIniFile(destIni, duplicatedName);

  const configPath = join(destDir, "config.ini");
  if (existsSync(configPath)) {
    const lines = readFileSync(configPath, "utf-8").split(/\r?\n/);
    replaceOrAppend(lines, "avd.ini.displayname=", `avd.ini.displayname=${duplicatedName}`);
    replaceOrAppend(lines, "avdbuddy.color.seed=", `avdbuddy.color.seed=${fallbackColorSeed(duplicatedName)}`);
    writeFileSync(configPath, lines.join("\n") + "\n");
  }

  removeTransientArtifacts(destDir);
  return duplicatedName;
}

export function renameEmulator(
  oldName: string,
  newName: string
): string {
  const validation = validateNewName(newName);
  if (validation) throw new Error(validation);

  const emulators = refreshEmulators();
  if (emulators.some((e) => e.name === newName)) {
    throw new Error(`An emulator named ${newName} already exists.`);
  }

  const srcDir = avdDir(oldName);
  const destDir = avdDir(newName);
  renameSync(srcDir, destDir);

  const srcIni = join(avdRootDir(), `${oldName}.ini`);
  const destIni = join(avdRootDir(), `${newName}.ini`);
  renameSync(srcIni, destIni);
  rewriteIniFile(destIni, newName);

  const configPath = join(destDir, "config.ini");
  if (existsSync(configPath)) {
    const lines = readFileSync(configPath, "utf-8").split(/\r?\n/);
    replaceOrAppend(lines, "avd.ini.displayname=", `avd.ini.displayname=${newName}`);
    writeFileSync(configPath, lines.join("\n") + "\n");
  }

  removeTransientArtifacts(destDir);
  return `Renamed ${oldName} to ${newName}.`;
}

export async function loadSystemImages(): Promise<AndroidSystemImage[]> {
  if (cachedImages) return cachedImages;

  const status = toolchainStatus();
  if (!status.isConfigured) throw new Error(status.summary);

  const result = await sdkManagerListResult(status.sdkPath);
  const output = combinedCommandOutput(result);
  const images = parseSdkManagerOutput(output);
  if (result.exitCode !== 0) {
    if (images.length > 0 && hasRecoverableSdkManagerWarning(output)) {
      logBackendWarning(
        "sdkmanager --list returned warnings",
        "Proceeding with parsed system images because the output still contains a valid package list."
      );
    } else {
      console.error(`[AvdBuddy] sdkmanager --list failed:\n${output}`);
      throw new Error(
        commandError(result, "Failed to load Android system images.")
      );
    }
  }
  cachedImages = images;
  return images;
}

export function invalidateImageCache(): void {
  cachedImages = null;
}

export async function getVersionFamilies(
  deviceType: CreateAVDDeviceType
): Promise<AndroidVersionFamily[]> {
  const images = await loadSystemImages();
  return versionFamilies(images, deviceType);
}

export async function createAVD(
  config: CreateAVDResolvedConfiguration,
  onOutput?: (chunk: string) => void
): Promise<{ success: boolean; output: string }> {
  const validation = validateNewName(config.avdName);
  if (validation) return { success: false, output: validation };

  const existing = refreshEmulators();
  if (existing.some((e) => e.name === config.avdName)) {
    return {
      success: false,
      output: `An emulator named ${config.avdName} already exists.`,
    };
  }

  const status = toolchainStatus();
  if (!status.isConfigured)
    return { success: false, output: status.summary };

  const toolchain = resolveToolchain(status.sdkPath);
  let output = "";
  const requestedPackagePath = config.packagePath;
  const resolvedPackagePath = await canonicalSystemImagePackagePath(
    status.sdkPath,
    requestedPackagePath
  );
  if (resolvedPackagePath !== requestedPackagePath) {
    const message =
      `Normalized system image package from ${requestedPackagePath} to ${resolvedPackagePath} ` +
      "to match Google's published SDK package paths.";
    logBackendWarning("system image package normalization", message);
    output = appendOutput(output, `[AvdBuddy] ${message}\n`, onOutput);
  }

  const installArgs = [`--sdk_root=${status.sdkPath}`, "--install", resolvedPackagePath];
  const installHeader = `$ ${toolchain.sdkManager} ${installArgs.join(" ")}\n`;
  output = appendOutput(output, installHeader, onOutput);

  const installResult = await runCommandStreaming(
    toolchain.sdkManager,
    installArgs,
    {
      stdin: "y\n".repeat(32),
      onOutput: (chunk) => {
        output = appendOutput(output, chunk, onOutput);
      },
    }
  );
  if (installResult.exitCode !== 0) {
    const installOutput = combinedCommandOutput(installResult);
    const recoverableWarning = hasRecoverableSdkManagerWarning(installOutput);
    const packageInstalled = recoverableWarning
      ? await isPackageInstalled(status.sdkPath, resolvedPackagePath)
      : false;

    if (!(recoverableWarning && packageInstalled)) {
      console.error(
        `[AvdBuddy] sdkmanager install failed for ${resolvedPackagePath}:\n${installOutput}`
      );
      return {
        success: false,
        output: commandError(
          installResult,
          `Failed to install ${resolvedPackagePath}.`
        ),
      };
    }

    logBackendWarning(
      `sdkmanager install warning for ${resolvedPackagePath}`,
      "Package appears to be installed despite dependency warnings, continuing with AVD creation."
    );
  }

  const createArgs = [
    "create", "avd",
    "-n", config.avdName,
    "-k", resolvedPackagePath,
    "-d", config.deviceProfileID,
  ];
  if (config.sdCard) createArgs.push("-c", config.sdCard);

  const createHeader = `\n\n$ ${toolchain.avdManager} ${createArgs.join(" ")}\n`;
  output = appendOutput(output, createHeader, onOutput);

  const createResult = await runCommandStreaming(
    toolchain.avdManager,
    createArgs,
    {
      stdin: "no\n",
      onOutput: (chunk) => {
        output = appendOutput(output, chunk, onOutput);
      },
    }
  );
  if (createResult.exitCode !== 0) {
    return {
      success: false,
      output: commandError(createResult, `Failed to create ${config.avdName}.`),
    };
  }

  const configPath = join(avdDir(config.avdName), "config.ini");
  if (!existsSync(configPath)) {
    return {
      success: false,
      output: `Failed to create ${config.avdName}. The AVD config file was not generated.`,
    };
  }
  applyConfiguration(config, configPath, toolchain.sdkPath);

  return { success: true, output };
}

function applyConfiguration(
  config: CreateAVDResolvedConfiguration,
  configPath: string,
  sdkRootPath: string
): void {
  if (!existsSync(configPath)) return;
  const lines = readFileSync(configPath, "utf-8").split(/\r?\n/);

  replaceOrAppend(lines, "disk.dataPartition.size=", `disk.dataPartition.size=${config.storage}`);
  replaceOrAppend(lines, "avd.ini.displayname=", `avd.ini.displayname=${config.avdName}`);
  replaceOrAppend(lines, "avdbuddy.color.seed=", `avdbuddy.color.seed=${config.colorSeed}`);
  replaceOrAppend(
    lines,
    "showDeviceFrame=",
    `showDeviceFrame=${config.showDeviceFrame ? "yes" : "no"}`
  );

  if (config.ramMB !== null) {
    replaceOrAppend(lines, "hw.ramSize=", `hw.ramSize=${config.ramMB}`);
  }

  writeFileSync(configPath, lines.join("\n") + "\n");
}

function rewriteIniFile(iniPath: string, avdName: string): void {
  const absPath = avdDir(avdName);
  try {
    const lines = readFileSync(iniPath, "utf-8").split(/\r?\n/);
    replaceOrAppend(lines, "path=", `path=${absPath}`);
    replaceOrAppend(lines, "path.rel=", `path.rel=avd/${avdName}.avd`);
    writeFileSync(iniPath, lines.join("\n") + "\n");
  } catch { /* ignore */ }
}

function replaceOrAppend(
  lines: string[],
  prefix: string,
  replacement: string
): void {
  const idx = lines.findIndex((l) => l.startsWith(prefix));
  if (idx >= 0) {
    lines[idx] = replacement;
  } else {
    lines.push(replacement);
  }
}

function removeTransientArtifacts(dirPath: string): void {
  const transient = [
    "hardware-qemu.ini",
    "multiinstance.lock",
    "read-snapshot.txt",
    "emu-launch-params.txt",
    "tmpAdbCmds",
    "cache.img.qcow2",
    "userdata-qemu.img.qcow2",
    "encryptionkey.img.qcow2",
    "snapshots",
  ];

  for (const name of transient) {
    const p = join(dirPath, name);
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  try {
    for (const f of readdirSync(dirPath)) {
      if (f.includes(".tmp-")) {
        try {
          rmSync(join(dirPath, f), { force: true });
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

export function validateNewName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Please enter an emulator name.";
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return "Use only letters, numbers, dots, underscores, or dashes.";
  }
  return null;
}

export function validateRenameName(
  currentName: string,
  newName: string
): string | null {
  const trimmed = newName.trim();
  const basic = validateNewName(trimmed);
  if (basic) return basic;
  if (trimmed === currentName) return "Choose a different name.";
  const emulators = refreshEmulators();
  if (emulators.some((e) => e.name === trimmed)) {
    return `An emulator named ${trimmed} already exists.`;
  }
  return null;
}

export const __emulatorManagerTestUtils = {
  hasRecoverableSdkManagerWarning,
  normalizeSystemImagePackagePathWithAvailablePackages,
  parseSystemImagePackagePath,
  parseInstalledPackages,
};
