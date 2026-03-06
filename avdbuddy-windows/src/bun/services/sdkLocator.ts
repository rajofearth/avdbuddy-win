import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  AndroidToolchain,
  AndroidToolchainStatus,
  AndroidToolState,
  AndroidTool,
  ValidationStatus,
} from "../models/types.ts";

const ALL_TOOLS: AndroidTool[] = ["sdkManager", "avdManager", "emulator", "adb"];

let storedSdkPath: string | null = null;

export function getStoredSDKPath(): string | null {
  return storedSdkPath;
}

export function setStoredSDKPath(path: string | null): void {
  const trimmed = path?.trim();
  storedSdkPath = trimmed && trimmed.length > 0 ? trimmed : null;
}

export function platformDefaultSDKPaths(
  platform: NodeJS.Platform,
  home: string
): string[] {
  if (platform === "win32") {
    return [join(home, "AppData", "Local", "Android", "Sdk")];
  }
  if (platform === "linux") {
    return [
      join(home, "Android", "Sdk"),
      join(home, "Android", "sdk"),
    ];
  }
  return [join(home, "Library", "Android", "sdk")];
}

export function defaultSDKPath(): string {
  const sdkRoot = process.env["ANDROID_SDK_ROOT"];
  if (sdkRoot && sdkRoot.length > 0) return sdkRoot;
  const androidHome = process.env["ANDROID_HOME"];
  if (androidHome && androidHome.length > 0) return androidHome;
  const home = homedir();
  return platformDefaultSDKPaths(process.platform, home)[0]!;
}

function candidateSDKPaths(): string[] {
  const home = homedir();
  const platform = process.platform;

  const candidates: (string | undefined)[] = [
    process.env["ANDROID_SDK_ROOT"],
    process.env["ANDROID_HOME"],
  ];

  candidates.push(...platformDefaultSDKPaths(platform, home));

  const unique: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    if (trimmed.length === 0) continue;
    if (!unique.includes(trimmed)) unique.push(trimmed);
  }
  return unique;
}

function isExecutable(path: string): boolean {
  try {
    const stat = Bun.file(path);
    return existsSync(path) && stat.size > 0;
  } catch {
    return existsSync(path);
  }
}

function cmdlineToolBinary(binaryName: string, sdkPath: string): string {
  const ext = process.platform === "win32" ? ".bat" : "";
  const latestPath = join(
    sdkPath,
    "cmdline-tools",
    "latest",
    "bin",
    binaryName + ext
  );
  if (isExecutable(latestPath)) return latestPath;

  const cmdlineToolsRoot = join(sdkPath, "cmdline-tools");
  try {
    const { readdirSync } = require("fs");
    const children: string[] = readdirSync(cmdlineToolsRoot);
    const sorted = children
      .map((c: string) => join(cmdlineToolsRoot, c))
      .filter((p: string) => {
        try {
          const { statSync } = require("fs");
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();

    for (const dir of sorted) {
      const candidate = join(dir, "bin", binaryName + ext);
      if (isExecutable(candidate)) return candidate;
    }
  } catch {
    // cmdline-tools directory doesn't exist
  }

  const legacyPath = join(sdkPath, "tools", "bin", binaryName + ext);
  if (isExecutable(legacyPath)) return legacyPath;

  return latestPath;
}

export function resolveToolchain(sdkPath: string): AndroidToolchain {
  const ext = process.platform === "win32" ? ".exe" : "";
  return {
    sdkPath,
    sdkManager: cmdlineToolBinary("sdkmanager", sdkPath),
    avdManager: cmdlineToolBinary("avdmanager", sdkPath),
    emulator: join(sdkPath, "emulator", "emulator" + ext),
    adb: join(sdkPath, "platform-tools", "adb" + ext),
  };
}

function isLegacyToolsBinary(path: string, sdkPath: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const normalizedSdk = sdkPath.replace(/\\/g, "/");
  return normalized.startsWith(`${normalizedSdk}/tools/bin/`);
}

function validationStatus(
  tool: AndroidTool,
  path: string,
  sdkPath: string
): ValidationStatus {
  if (!isExecutable(path)) {
    return { kind: "missing" };
  }
  if (
    (tool === "sdkManager" || tool === "avdManager") &&
    isLegacyToolsBinary(path, sdkPath)
  ) {
    return {
      kind: "unsupported",
      message: "Invalid binary. AvdBuddy requires cmdline-tools.",
    };
  }
  return { kind: "available" };
}

export function toolchainStatus(sdkPath?: string): AndroidToolchainStatus {
  const effectivePath =
    sdkPath?.trim() || storedSdkPath || autodetectedSDKPath() || defaultSDKPath();
  const toolchain = resolveToolchain(effectivePath);
  const isOverride = storedSdkPath === effectivePath;

  const toolStates: AndroidToolState[] = ALL_TOOLS.map((tool) => {
    const path = toolchain[tool === "sdkManager" ? "sdkManager" : tool === "avdManager" ? "avdManager" : tool];
    return {
      tool,
      path,
      validationStatus: validationStatus(tool, path, effectivePath),
    };
  });

  const isConfigured = toolStates.every(
    (s) => s.validationStatus.kind === "available"
  );
  const missing = toolStates.filter((s) => s.validationStatus.kind === "missing");
  const unsupported = toolStates.filter(
    (s) => s.validationStatus.kind === "unsupported"
  );

  let summary = "Android SDK ready.";
  if (!isConfigured) {
    if (unsupported.length > 0) {
      const names = unsupported.map((s) => s.tool).join(", ");
      if (missing.length === 0) {
        summary = `Deprecated ${names} found under tools/bin. Install Android Command-line Tools.`;
      } else {
        const missingNames = missing.map((s) => s.tool).join(", ");
        summary = `Deprecated ${names} found under tools/bin. Missing ${missingNames}. Install Android Command-line Tools.`;
      }
    } else if (missing.length > 0) {
      const names = missing.map((s) => s.tool).join(", ");
      summary = `Missing ${names}.`;
    } else {
      summary = "Android SDK setup is incomplete.";
    }
  }

  return {
    sdkPath: effectivePath,
    isStoredOverride: isOverride,
    toolStates,
    isConfigured,
    summary,
  };
}

export function autodetectedSDKPath(): string | null {
  const candidates = candidateSDKPaths();
  const configured = candidates.find((c) => {
    const status = toolchainStatus(c);
    return status.isConfigured;
  });
  if (configured) return configured;
  const existing = candidates.find((c) => existsSync(c));
  if (existing) return existing;
  return candidates[0] ?? null;
}

export function preferredSDKPath(): string {
  return storedSdkPath || autodetectedSDKPath() || defaultSDKPath();
}
