import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
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
import { runCommandStreaming } from "./commandRunner.ts";
import {
  MINIMUM_JAVA_FEATURE_VERSION,
  javaEnvironment,
  managedJavaHome,
  managedJavaRoot,
  resolveJavaRuntime,
} from "./javaRuntime.ts";
import { preferredSDKPath, resolveToolchain, toolchainStatus } from "./sdkLocator.ts";

const ANDROID_REPOSITORY_URL =
  "https://dl.google.com/android/repository/repository2-1.xml";
const ANDROID_REPOSITORY_BASE_URL =
  "https://dl.google.com/android/repository";
const TEMURIN_API_URL = "https://api.adoptium.net/v3/assets/latest/17/hotspot";
const DOWNLOAD_USER_AGENT = "AvdBuddy/1.0";
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

type DownloadChecksumAlgorithm = "sha1" | "sha256";

interface DownloadableArchive {
  packagePath: string;
  checksum: string;
  checksumAlgorithm: DownloadChecksumAlgorithm;
  downloadURL: string;
  fileName: string;
  size: number;
}

type SupportedJavaArchitecture = "x64" | "aarch64";

interface JavaPackageArchive {
  architecture: SupportedJavaArchitecture;
  packagePath: string;
  checksum: string;
  downloadURL: string;
  fileName: string;
  size: number;
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

function currentHostRuntime(): HostRuntime {
  return {
    platform: process.platform,
    arch: process.arch,
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

function javaArchitectureCandidates(runtime: HostRuntime): SupportedJavaArchitecture[] {
  if (runtime.arch === "x64") return ["x64"];
  if (runtime.arch === "arm64") {
    return runtime.platform === "win32" ? ["aarch64", "x64"] : ["aarch64"];
  }
  throw new Error(
    "Automatic Java setup is currently supported on Linux and Windows x64/arm64 only."
  );
}

function javaPackageFormat(fileName: string): "zip" | "tar.gz" {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".zip")) return "zip";
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) return "tar.gz";
  throw new Error(`Unsupported Java archive format for ${fileName}.`);
}

async function fetchLatestJavaArchive(runtime: HostRuntime): Promise<JavaPackageArchive> {
  const architectures = javaArchitectureCandidates(runtime);

  for (const architecture of architectures) {
    const response = await fetch(
      `${TEMURIN_API_URL}?architecture=${architecture}&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=${runtime.hostOS}&package_type=jdk&project=jdk&vendor=eclipse`,
      {
        headers: {
          "User-Agent": DOWNLOAD_USER_AGENT,
        },
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to load Java runtime metadata (${response.status} ${response.statusText}).`
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) continue;

    const pkg = payload[0]?.binary?.package;
    const fileName = pkg?.name?.trim();
    const downloadURL = pkg?.link?.trim();
    const checksum = pkg?.checksum?.trim().toLowerCase();
    const size = Number(pkg?.size ?? "0");
    if (!fileName || !downloadURL || !checksum || size <= 0) continue;

    return {
      architecture,
      packagePath: `temurin-jdk-${architecture}`,
      checksum,
      downloadURL,
      fileName,
      size,
    };
  }

  throw new Error(
    `Unable to locate a downloadable Java ${MINIMUM_JAVA_FEATURE_VERSION}+ runtime for ${runtime.hostOS} ${runtime.arch}.`
  );
}

async function ensureJavaAvailable(
  runtime: HostRuntime,
  onOutput?: (chunk: string) => void
): Promise<void> {
  const existing = resolveJavaRuntime();
  if (existing.validationStatus.kind === "available") {
    outputLine(
      onOutput,
      `Java ${existing.featureVersion} detected at ${existing.displayPath}.`
    );
    return;
  }

  if (existing.validationStatus.kind === "unsupported") {
    outputLine(onOutput, `${existing.validationStatus.message}`);
  } else {
    outputLine(
      onOutput,
      `Java ${MINIMUM_JAVA_FEATURE_VERSION}+ not detected. Installing a managed runtime.`
    );
  }

  const archive = await fetchLatestJavaArchive(runtime);
  javaPackageFormat(archive.fileName);
  if (runtime.platform === "win32" && runtime.arch === "arm64" && archive.architecture === "x64") {
    outputLine(
      onOutput,
      "No native Windows arm64 Temurin archive was published. Falling back to the Windows x64 JDK."
    );
  }
  outputLine(onOutput, `Using ${archive.fileName}.`);

  const tempRoot = mkdtempSync(join(tmpdir(), "avdbuddy-java-"));
  try {
    const archivePath = join(tempRoot, archive.fileName);
    const extractRoot = join(tempRoot, "extracted");
    await downloadArchive(
      {
        packagePath: archive.packagePath,
        checksum: archive.checksum,
        checksumAlgorithm: "sha256",
        downloadURL: archive.downloadURL,
        fileName: archive.fileName,
        size: archive.size,
      },
      archivePath,
      onOutput
    );
    await extractArchiveContents(
      runtime.hostOS,
      archivePath,
      extractRoot,
      "Extracting Java runtime",
      onOutput
    );
    const extracted = findExtractedJavaRoot(extractRoot);
    installJavaPackage(extracted, onOutput);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const installed = resolveJavaRuntime();
  if (installed.validationStatus.kind !== "available") {
    throw new Error(
      `Java installation completed, but AvdBuddy could not verify Java ${MINIMUM_JAVA_FEATURE_VERSION}+ afterwards.`
    );
  }

  outputLine(
    onOutput,
    `Java ${installed.featureVersion} ready at ${installed.displayPath}.`
  );
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

function repositoryDownloadArchive(archive: RepositoryArchive): DownloadableArchive {
  return {
    packagePath: archive.packagePath,
    checksum: archive.checksum,
    checksumAlgorithm: "sha1",
    downloadURL: `${ANDROID_REPOSITORY_BASE_URL}/${archive.url}`,
    fileName: basename(archive.url),
    size: archive.size,
  };
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
  archive: DownloadableArchive,
  destinationPath: string,
  onOutput?: (chunk: string) => void
): Promise<void> {
  outputLine(
    onOutput,
    `Downloading ${archive.fileName} (${formatBytes(archive.size)})...`
  );

  const response = await fetch(archive.downloadURL, {
    headers: {
      "User-Agent": DOWNLOAD_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${archive.packagePath} (${response.status} ${response.statusText}).`
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

  const digest = createHash(archive.checksumAlgorithm)
    .update(Buffer.from(await Bun.file(destinationPath).arrayBuffer()))
    .digest("hex")
    .toLowerCase();
  if (digest !== archive.checksum) {
    throw new Error(
      `Checksum mismatch for ${archive.packagePath}. Expected ${archive.checksum}, received ${digest}.`
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
    env?: Record<string, string | undefined>;
  } = {}
): Promise<void> {
  const { stdin, onOutput, env } = options;
  outputLine(onOutput, `$ ${executable} ${args.join(" ")}`);

  let result: CommandResult;
  try {
    result = await runCommandStreaming(executable, args, {
      env,
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

function findExtractedJavaRoot(extractRoot: string): string {
  const binaryName = process.platform === "win32" ? "java.exe" : "java";

  for (const child of readdirSync(extractRoot)) {
    const childPath = join(extractRoot, child);
    if (existsSync(join(childPath, "bin", binaryName))) return childPath;
  }

  if (existsSync(join(extractRoot, "bin", binaryName))) return extractRoot;

  throw new Error(
    "Downloaded Java archive did not contain the expected JDK folder structure."
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
  const normalizedPath = archivePath.toLowerCase();

  if (normalizedPath.endsWith(".zip")) {
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
      return;
    }

    await runStreamingCommandChecked(
      "unzip",
      ["-q", archivePath, "-d", extractRoot],
      action,
      { onOutput }
    );
    return;
  }

  if (normalizedPath.endsWith(".tar.gz") || normalizedPath.endsWith(".tgz")) {
    await runStreamingCommandChecked(
      "tar",
      ["-xzf", archivePath, "-C", extractRoot],
      action,
      { onOutput }
    );
    return;
  }

  throw new Error(`Unsupported archive format for ${archivePath}.`);
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

function installJavaPackage(
  extractedPath: string,
  onOutput?: (chunk: string) => void
): void {
  const targetDir = managedJavaHome();
  mkdirSync(managedJavaRoot(), { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(extractedPath, targetDir, { recursive: true });
  outputLine(onOutput, `Installed Java runtime into ${targetDir}.`);
}

async function installBasePackages(
  sdkPath: string,
  runtime: HostRuntime,
  onOutput?: (chunk: string) => void
): Promise<string[]> {
  const toolchain = resolveToolchain(sdkPath);
  const env = javaEnvironment(toolchain.javaHome);
  const installPlan = buildInstallPlan(runtime);
  await runStreamingCommandChecked(
    toolchain.sdkManager,
    [`--sdk_root=${sdkPath}`, "--licenses"],
    "Accepting Android SDK licenses",
    {
      env,
      stdin: LICENSE_INPUT,
      onOutput,
    }
  );

  await runStreamingCommandChecked(
    toolchain.sdkManager,
    [`--sdk_root=${sdkPath}`, "--install", ...installPlan.sdkManagerPackages],
    "Installing Android SDK packages",
    {
      env,
      stdin: LICENSE_INPUT,
      onOutput,
    }
  );

  const installedPackages = [...installPlan.sdkManagerPackages];
  const needsDirectEmulatorInstall =
    installPlan.requiresDirectEmulatorInstall &&
    !toolIsAvailable(toolchainStatus(sdkPath), "emulator");

  if (installPlan.requiresDirectEmulatorInstall) {
    installedPackages.push(EMULATOR_PACKAGE);
  }

  if (needsDirectEmulatorInstall) {
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
      await downloadArchive(repositoryDownloadArchive(archive), zipPath, onOutput);
      await extractArchiveContents(
        runtime.hostOS,
        zipPath,
        extractRoot,
        "Extracting Android emulator",
        onOutput
      );
      const extracted = findExtractedEmulatorRoot(extractRoot);
      installEmulatorPackage(extracted, sdkPath, onOutput);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  return installedPackages;
}

export async function autoSetupAndroidSDK(
  requestedPath: string | null,
  onOutput?: (chunk: string) => void
): Promise<AndroidSDKSetupResult> {
  const runtime = currentHostRuntime();
  const { hostOS } = runtime;
  const sdkPath = requestedPath?.trim() || preferredSDKPath();
  outputLine(onOutput, `Preparing Android SDK in ${sdkPath}`);

  await ensureJavaAvailable(runtime, onOutput);
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
      await downloadArchive(repositoryDownloadArchive(archive), zipPath, onOutput);
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
  fetchLatestEmulatorArchive,
  javaArchitectureCandidates,
  parseRepositoryArchive,
};
