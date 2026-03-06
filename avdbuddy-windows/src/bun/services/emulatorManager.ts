import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, renameSync, rmSync } from "fs";
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

function avdRootDir(): string {
  const home = homedir();
  return join(home, ".android", "avd");
}

function avdDir(name: string): string {
  return join(avdRootDir(), `${name}.avd`);
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

  const configPath = join(avdDir(name), "config.ini");
  try {
    const config = readFileSync(configPath, "utf-8");
    const showFrame = parseShowDeviceFrame(config);
    if (showFrame !== false) {
      const skinName = parseSkinName(config);
      const skinPath = parseSkinPath(config);
      if (skinName && skinPath && existsSync(skinPath)) {
        args.push("-skindir", dirname(skinPath), "-skin", skinName);
      }
    }
  } catch { /* ignore */ }

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

  const toolchain = resolveToolchain(status.sdkPath);
  const result = await runCommand(toolchain.sdkManager, [
    `--sdk_root=${status.sdkPath}`,
    "--list",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      commandError(result, "Failed to load Android system images.")
    );
  }
  const images = parseSdkManagerOutput(result.stdout + "\n" + result.stderr);
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

  const installArgs = [`--sdk_root=${status.sdkPath}`, "--install", config.packagePath];
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
    return {
      success: false,
      output: commandError(
        installResult,
        `Failed to install ${config.packagePath}.`
      ),
    };
  }

  const createArgs = [
    "create", "avd",
    "-n", config.avdName,
    "-k", config.packagePath,
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
