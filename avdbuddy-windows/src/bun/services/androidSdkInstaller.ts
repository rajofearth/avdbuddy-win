import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { basename, join } from "path";
import type {
  AndroidSDKSetupResult,
  AndroidTool,
  AndroidToolchainStatus,
  CommandResult,
} from "../models/types.ts";
import { runCommand, runCommandStreaming } from "./commandRunner.ts";
import { preferredSDKPath, resolveToolchain, toolchainStatus } from "./sdkLocator.ts";

const ANDROID_REPOSITORY_URL =
  "https://dl.google.com/android/repository/repository2-1.xml";
const ANDROID_REPOSITORY_BASE_URL =
  "https://dl.google.com/android/repository";
const BASE_SDK_PACKAGES = [
  "platform-tools",
  "platforms;android-36",
] as const;
const EMULATOR_PACKAGE = "emulator";
const LICENSE_INPUT = "y\n".repeat(64);

type SupportedHostOS = "linux" | "windows";

interface RepositoryArchive {
  packagePath: string;
  revision: {
    major: number;
    minor: number;
    micro: number;
  };
  hostOS: SupportedHostOS;
  checksum: string;
  size: number;
  url: string;
  channel: number;
}

interface HostRuntime {
  platform: NodeJS.Platform;
  arch: string;
  hostOS: SupportedHostOS;
}

interface SDKInstallPlan {
  sdkManagerPackages: string[];
  requiresDirectEmulatorInstall: boolean;
}

interface LocalPackageMetadata {
  packagePath: string;
  displayName: string;
  revision: RepositoryArchive["revision"];
}

function outputLine(
  onOutput: ((chunk: string) => void) | undefined,
  message: string
): void {
  onOutput?.(message.endsWith("\n") ? message : `${message}\n`);
}

function supportedHostOS(): SupportedHostOS {
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "windows";
  throw new Error(
    "Automatic Android SDK setup is currently supported on Linux and Windows only."
  );
}

function normalizeArchitectureName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "arm64" || normalized === "aarch64") return "arm64";
  if (normalized === "x64" || normalized === "amd64" || normalized === "x86_64") {
    return "x64";
  }
  if (normalized === "x86" || normalized === "i386" || normalized === "i686") {
    return "x86";
  }
  return normalized;
}

function resolveHostArchitecture(
  platform: NodeJS.Platform,
  processArch: string,
  windowsOSArch: string | null
): string {
  if (platform === "win32") {
    return normalizeArchitectureName(windowsOSArch) ?? normalizeArchitectureName(processArch) ?? processArch;
  }
  return normalizeArchitectureName(processArch) ?? processArch;
}

async function detectWindowsOSArchitecture(): Promise<string | null> {
  if (process.platform !== "win32") return null;

  const envCandidates = [
    process.env["PROCESSOR_ARCHITEW6432"],
    process.env["PROCESSOR_ARCHITECTURE"],
  ];
  for (const candidate of envCandidates) {
    const normalized = normalizeArchitectureName(candidate);
    if (normalized === "arm64") return normalized;
  }

  try {
    const result = await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()",
    ]);
    if (result.exitCode !== 0) return null;
    return normalizeArchitectureName(result.stdout);
  } catch {
    return null;
  }
}

async function currentHostRuntime(): Promise<HostRuntime> {
  const windowsOSArch = await detectWindowsOSArchitecture();
  return {
    platform: process.platform,
    arch: resolveHostArchitecture(process.platform, process.arch, windowsOSArch),
    hostOS: supportedHostOS(),
  };
}

function revisionScore(revision: RepositoryArchive["revision"]): number {
  return revision.major * 1_000_000 + revision.minor * 1_000 + revision.micro;
}

function channelFromBlock(block: string): number {
  return Number(block.match(/<channelRef ref="channel-(\d+)"/)?.[1] ?? "0");
}

function toolIsAvailable(
  status: AndroidToolchainStatus,
  tool: AndroidTool
): boolean {
  return (
    status.toolStates.find((state) => state.tool === tool)?.validationStatus.kind ===
    "available"
  );
}

function needsCommandLineTools(status: AndroidToolchainStatus): boolean {
  return !toolIsAvailable(status, "sdkManager") || !toolIsAvailable(status, "avdManager");
}

function buildInstallPlan(
  runtime: Pick<HostRuntime, "platform" | "arch">
): SDKInstallPlan {
  const sdkManagerPackages: string[] = [...BASE_SDK_PACKAGES];
  const requiresDirectEmulatorInstall =
    runtime.platform === "win32" && runtime.arch === "arm64";

  if (!requiresDirectEmulatorInstall) {
    sdkManagerPackages.splice(1, 0, EMULATOR_PACKAGE);
  }

  return {
    sdkManagerPackages,
    requiresDirectEmulatorInstall,
  };
}

function revisionFromVersionString(
  version: string | null | undefined
): RepositoryArchive["revision"] | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  const [major, minor = "0", micro = "0"] = trimmed.split(".");
  if (!major || !/^\d+$/.test(major)) return null;
  if (!/^\d+$/.test(minor) || !/^\d+$/.test(micro)) return null;
  return {
    major: Number(major),
    minor: Number(minor),
    micro: Number(micro),
  };
}

function parseSourceProperties(sourceProperties: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of sourceProperties.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.length > 0) values[key] = value;
  }
  return values;
}

function emulatorLocalMetadataFromSourceProperties(
  sourceProperties: string
): LocalPackageMetadata | null {
  const values = parseSourceProperties(sourceProperties);
  const revision = revisionFromVersionString(values["Pkg.Revision"]);
  if (!revision) return null;
  return {
    packagePath: values["Pkg.Path"]?.trim() || EMULATOR_PACKAGE,
    displayName: values["Pkg.Desc"]?.trim() || "Android Emulator",
    revision,
  };
}

async function ensureJavaAvailable(): Promise<void> {
  let result: CommandResult;
  try {
    result = await runCommand("java", ["-version"]);
  } catch {
    throw new Error(
      "Java is required before setting up the Android SDK. Install Java 17 or newer and try again."
    );
  }

  if (result.exitCode !== 0) {
    throw new Error(
      "Java is required before setting up the Android SDK. Install Java 17 or newer and try again."
    );
  }
}

function parseRepositoryArchive(
  repositoryXML: string,
  hostOS: SupportedHostOS,
  packageMatcher: RegExp,
  packageDescription: string,
  stableOnly = true
): RepositoryArchive {
  const packages = repositoryXML.matchAll(
    /<remotePackage path="([^"]+)">([\s\S]*?)<\/remotePackage>/g
  );

  const archives: RepositoryArchive[] = [];
  for (const pkg of packages) {
    const packagePath = pkg[1];
    const block = pkg[2];
    if (!packagePath || !block) continue;
    if (!packageMatcher.test(packagePath)) continue;
    if (
      stableOnly &&
      (packagePath.includes("alpha") ||
        packagePath.includes("beta") ||
        packagePath.includes("rc"))
    ) {
      continue;
    }
    if (stableOnly && (block.includes("<preview>") || channelFromBlock(block) > 0)) {
      continue;
    }

    const revisionMatch = block.match(
      /<revision>\s*<major>(\d+)<\/major>\s*<minor>(\d+)<\/minor>(?:\s*<micro>(\d+)<\/micro>)?[\s\S]*?<\/revision>/
    );
    if (!revisionMatch) continue;

    const revision = {
      major: Number(revisionMatch[1] ?? "0"),
      minor: Number(revisionMatch[2] ?? "0"),
      micro: Number(revisionMatch[3] ?? "0"),
    };

    const archiveBlocks = block.matchAll(/<archive>([\s\S]*?)<\/archive>/g);
    for (const archiveMatch of archiveBlocks) {
      const archiveBlock = archiveMatch[1];
      if (!archiveBlock?.includes(`<host-os>${hostOS}</host-os>`)) continue;
      const url = archiveBlock.match(/<url>([^<]+)<\/url>/)?.[1]?.trim();
      const checksum = archiveBlock
        .match(/<checksum>([^<]+)<\/checksum>/)?.[1]
        ?.trim()
        .toLowerCase();
      const size = Number(
        archiveBlock.match(/<size>(\d+)<\/size>/)?.[1] ?? "0"
      );
      if (!url || !checksum || size <= 0) continue;

      archives.push({
        packagePath,
        revision,
        hostOS,
        checksum,
        size,
        url,
        channel: channelFromBlock(block),
      });
    }
  }

  const selected = archives.sort(
    (a, b) => revisionScore(b.revision) - revisionScore(a.revision)
  )[0];

  if (!selected) {
    throw new Error(
      `Unable to locate a downloadable ${packageDescription} package for ${hostOS}.`
    );
  }

  return selected;
}

async function fetchLatestCommandLineToolsArchive(
  hostOS: SupportedHostOS
): Promise<RepositoryArchive> {
  const response = await fetch(ANDROID_REPOSITORY_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load Android repository metadata (${response.status} ${response.statusText}).`
    );
  }

  const repositoryXML = await response.text();
  return parseRepositoryArchive(
    repositoryXML,
    hostOS,
    /^cmdline-tools;[^"]+$/,
    "Android command-line tools"
  );
}

async function fetchLatestEmulatorArchive(
  hostOS: SupportedHostOS
): Promise<RepositoryArchive> {
  const response = await fetch(ANDROID_REPOSITORY_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load Android repository metadata (${response.status} ${response.statusText}).`
    );
  }

  const repositoryXML = await response.text();
  return parseRepositoryArchive(
    repositoryXML,
    hostOS,
    /^emulator$/,
    "Android emulator"
  );
}

function localPackageXML(metadata: LocalPackageMetadata): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns5="http://schemas.android.com/repository/android/generic/02">',
    `  <localPackage path="${metadata.packagePath}" obsolete="false">`,
    '    <type-details xsi:type="ns5:genericDetailsType"/>',
    `    <revision><major>${metadata.revision.major}</major><minor>${metadata.revision.minor}</minor><micro>${metadata.revision.micro}</micro></revision>`,
    `    <display-name>${metadata.displayName}</display-name>`,
    "  </localPackage>",
    "</ns2:repository>",
    "",
  ].join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

async function downloadArchive(
  archive: RepositoryArchive,
  destinationPath: string,
  onOutput?: (chunk: string) => void
): Promise<void> {
  const url = `${ANDROID_REPOSITORY_BASE_URL}/${archive.url}`;
  outputLine(
    onOutput,
    `Downloading ${basename(archive.url)} (${formatBytes(archive.size)})...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Android command-line tools (${response.status} ${response.statusText}).`
    );
  }
  if (!response.body) {
    throw new Error("Download failed because no response body was returned.");
  }

  const totalBytes = Number(response.headers.get("content-length") ?? archive.size);
  let receivedBytes = 0;
  let nextProgressPercent = 10;
  const reader = response.body.getReader();
  const stream = createWriteStream(destinationPath);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      receivedBytes += value.length;
      await new Promise<void>((resolve, reject) => {
        stream.write(Buffer.from(value), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      if (totalBytes > 0) {
        const percent = Math.min(
          100,
          Math.floor((receivedBytes / totalBytes) * 100)
        );
        if (percent >= nextProgressPercent) {
          outputLine(
            onOutput,
            `Downloaded ${percent}% (${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)})`
          );
          nextProgressPercent += 10;
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.end(() => resolve());
    });
    reader.releaseLock();
  }

  const sha1 = createHash("sha1")
    .update(Buffer.from(await Bun.file(destinationPath).arrayBuffer()))
    .digest("hex")
    .toLowerCase();
  if (sha1 !== archive.checksum) {
    throw new Error(
      `Checksum mismatch for ${archive.packagePath}. Expected ${archive.checksum}, received ${sha1}.`
    );
  }

  outputLine(onOutput, "Download verified.");
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function commandFailureMessage(
  action: string,
  result: CommandResult
): string {
  const combined = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const detail = combined.slice(-6).join(" ");
  return detail.length > 0
    ? `${action} failed: ${detail}`
    : `${action} failed with exit code ${result.exitCode}.`;
}

async function runStreamingCommandChecked(
  executable: string,
  args: string[],
  action: string,
  options: {
    stdin?: string;
    onOutput?: (chunk: string) => void;
  } = {}
): Promise<void> {
  const { stdin, onOutput } = options;
  outputLine(onOutput, `$ ${executable} ${args.join(" ")}`);

  let result: CommandResult;
  try {
    result = await runCommandStreaming(executable, args, {
      stdin,
      onOutput,
    });
  } catch (error: any) {
    throw new Error(`${action} failed: ${error?.message ?? String(error)}`);
  }

  if (result.exitCode !== 0) {
    throw new Error(commandFailureMessage(action, result));
  }
}

function findExtractedCmdlineToolsRoot(extractRoot: string): string {
  const directChild = join(extractRoot, "cmdline-tools");
  if (existsSync(join(directChild, "bin"))) return directChild;

  for (const child of readdirSync(extractRoot)) {
    const childPath = join(extractRoot, child);
    if (existsSync(join(childPath, "bin"))) return childPath;
    if (existsSync(join(childPath, "cmdline-tools", "bin"))) {
      return join(childPath, "cmdline-tools");
    }
  }

  throw new Error(
    "Downloaded Android command-line tools archive did not contain the expected folder structure."
  );
}

function findExtractedEmulatorRoot(extractRoot: string): string {
  const binaryName = process.platform === "win32" ? "emulator.exe" : "emulator";
  const directChild = join(extractRoot, "emulator");
  if (existsSync(join(directChild, binaryName))) return directChild;

  for (const child of readdirSync(extractRoot)) {
    const childPath = join(extractRoot, child);
    if (existsSync(join(childPath, binaryName))) return childPath;
    if (existsSync(join(childPath, "emulator", binaryName))) {
      return join(childPath, "emulator");
    }
  }

  throw new Error(
    "Downloaded Android emulator archive did not contain the expected folder structure."
  );
}

async function extractArchiveContents(
  hostOS: SupportedHostOS,
  archivePath: string,
  extractRoot: string,
  action: string,
  onOutput?: (chunk: string) => void
): Promise<void> {
  mkdirSync(extractRoot, { recursive: true });

  if (hostOS === "windows") {
    await runStreamingCommandChecked(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${escapePowerShellLiteral(
          archivePath
        )}' -DestinationPath '${escapePowerShellLiteral(extractRoot)}' -Force`,
      ],
      action,
      { onOutput }
    );
  } else {
    await runStreamingCommandChecked(
      "unzip",
      ["-q", archivePath, "-d", extractRoot],
      action,
      { onOutput }
    );
  }
}

function installCmdlineTools(
  extractedPath: string,
  sdkPath: string,
  onOutput?: (chunk: string) => void
): void {
  const targetDir = join(sdkPath, "cmdline-tools", "latest");
  mkdirSync(join(sdkPath, "cmdline-tools"), { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(extractedPath, targetDir, { recursive: true });
  outputLine(onOutput, `Installed command-line tools into ${targetDir}.`);
}

function installEmulatorPackage(
  extractedPath: string,
  sdkPath: string,
  onOutput?: (chunk: string) => void
): void {
  const targetDir = join(sdkPath, "emulator");
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(extractedPath, targetDir, { recursive: true });
  outputLine(onOutput, `Installed emulator package into ${targetDir}.`);
}

function emulatorPackageXMLPath(sdkPath: string): string {
  return join(sdkPath, "emulator", "package.xml");
}

function emulatorSourcePropertiesPath(sdkPath: string): string {
  return join(sdkPath, "emulator", "source.properties");
}

function ensureLocalEmulatorPackageMetadata(
  sdkPath: string,
  archive?: RepositoryArchive,
  onOutput?: (chunk: string) => void
): void {
  const packageXMLPath = emulatorPackageXMLPath(sdkPath);
  if (existsSync(packageXMLPath)) return;

  let metadata: LocalPackageMetadata | null = null;
  const sourcePropertiesPath = emulatorSourcePropertiesPath(sdkPath);
  if (existsSync(sourcePropertiesPath)) {
    metadata = emulatorLocalMetadataFromSourceProperties(
      readFileSync(sourcePropertiesPath, "utf-8")
    );
  }

  if (!metadata && archive) {
    metadata = {
      packagePath: archive.packagePath,
      displayName: "Android Emulator",
      revision: archive.revision,
    };
  }

  if (!metadata) {
    throw new Error(
      "The Android emulator files were installed, but package metadata could not be created for sdkmanager."
    );
  }

  writeFileSync(packageXMLPath, localPackageXML(metadata), "utf-8");
  outputLine(
    onOutput,
    "Registered emulator package metadata so sdkmanager can resolve emulator dependencies."
  );
}

async function ensureDirectEmulatorPackageInstalled(
  sdkPath: string,
  runtime: HostRuntime,
  onOutput?: (chunk: string) => void
): Promise<void> {
  const status = toolchainStatus(sdkPath);
  if (toolIsAvailable(status, "emulator")) {
    ensureLocalEmulatorPackageMetadata(sdkPath, undefined, onOutput);
    return;
  }

  outputLine(
    onOutput,
    "Windows on Arm detected. Installing the published Windows x64 emulator archive directly."
  );
  const archive = await fetchLatestEmulatorArchive(runtime.hostOS);
  outputLine(
    onOutput,
    `Using ${archive.packagePath} revision ${archive.revision.major}.${archive.revision.minor}.${archive.revision.micro} (${basename(archive.url)}).`
  );

  const tempRoot = mkdtempSync(join(tmpdir(), "avdbuddy-emulator-"));
  try {
    const zipPath = join(tempRoot, basename(archive.url));
    const extractRoot = join(tempRoot, "extracted");
    await downloadArchive(archive, zipPath, onOutput);
    await extractArchiveContents(
      runtime.hostOS,
      zipPath,
      extractRoot,
      "Extracting Android emulator",
      onOutput
    );
    const extracted = findExtractedEmulatorRoot(extractRoot);
    installEmulatorPackage(extracted, sdkPath, onOutput);
    ensureLocalEmulatorPackageMetadata(sdkPath, archive, onOutput);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function installBasePackages(
  sdkPath: string,
  runtime: HostRuntime,
  onOutput?: (chunk: string) => void
): Promise<string[]> {
  const toolchain = resolveToolchain(sdkPath);
  const installPlan = buildInstallPlan(runtime);
  await runStreamingCommandChecked(
    toolchain.sdkManager,
    [`--sdk_root=${sdkPath}`, "--licenses"],
    "Accepting Android SDK licenses",
    {
      stdin: LICENSE_INPUT,
      onOutput,
    }
  );

  if (installPlan.requiresDirectEmulatorInstall) {
    await ensureDirectEmulatorPackageInstalled(sdkPath, runtime, onOutput);
  }

  await runStreamingCommandChecked(
    toolchain.sdkManager,
    [`--sdk_root=${sdkPath}`, "--install", ...installPlan.sdkManagerPackages],
    "Installing Android SDK packages",
    {
      stdin: LICENSE_INPUT,
      onOutput,
    }
  );

  const installedPackages = [...installPlan.sdkManagerPackages];

  if (installPlan.requiresDirectEmulatorInstall) {
    installedPackages.push(EMULATOR_PACKAGE);
  }

  return installedPackages;
}

export async function autoSetupAndroidSDK(
  requestedPath: string | null,
  onOutput?: (chunk: string) => void
): Promise<AndroidSDKSetupResult> {
  const runtime = await currentHostRuntime();
  const { hostOS } = runtime;
  const sdkPath = requestedPath?.trim() || preferredSDKPath();
  outputLine(onOutput, `Preparing Android SDK in ${sdkPath}`);

  await ensureJavaAvailable();
  mkdirSync(sdkPath, { recursive: true });

  let status = toolchainStatus(sdkPath);
  if (needsCommandLineTools(status)) {
    outputLine(onOutput, "Android command-line tools are missing or outdated.");
    const archive = await fetchLatestCommandLineToolsArchive(hostOS);
    outputLine(
      onOutput,
      `Using ${archive.packagePath} for ${hostOS}.`
    );

    const tempRoot = mkdtempSync(join(tmpdir(), "avdbuddy-sdk-"));
    try {
      const zipPath = join(tempRoot, basename(archive.url));
      const extractRoot = join(tempRoot, "extracted");
      await downloadArchive(archive, zipPath, onOutput);
      await extractArchiveContents(
        hostOS,
        zipPath,
        extractRoot,
        "Extracting Android command-line tools",
        onOutput
      );
      const extracted = findExtractedCmdlineToolsRoot(extractRoot);
      installCmdlineTools(extracted, sdkPath, onOutput);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  } else {
    outputLine(onOutput, "Android command-line tools already look valid.");
  }

  const installedPackages = await installBasePackages(sdkPath, runtime, onOutput);
  status = toolchainStatus(sdkPath);

  if (!status.isConfigured) {
    throw new Error(status.summary);
  }

  outputLine(onOutput, "Android SDK setup finished.");
  return {
    sdkPath,
    installedPackages,
    status,
  };
}

export const __sdkInstallerTestUtils = {
  buildInstallPlan,
  emulatorLocalMetadataFromSourceProperties,
  fetchLatestEmulatorArchive,
  localPackageXML,
  normalizeArchitectureName,
  parseRepositoryArchive,
  revisionFromVersionString,
  resolveHostArchitecture,
};
