import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";
import type { ValidationStatus } from "../models/types.ts";

export const MINIMUM_JAVA_FEATURE_VERSION = 17;

export interface ResolvedJavaRuntime {
  executable: string;
  home: string | null;
  displayPath: string;
  featureVersion: number | null;
  validationStatus: ValidationStatus;
}

function decodeOutput(output: Uint8Array | null | undefined): string {
  if (!output) return "";
  return new TextDecoder().decode(output);
}

export function managedJavaHome(home = homedir()): string {
  return join(home, ".avdbuddy", "java", "current");
}

export function managedJavaRoot(home = homedir()): string {
  return join(home, ".avdbuddy", "java");
}

export function javaBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "java.exe" : "java";
}

export function javaExecutablePath(
  javaHome: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(javaHome, "bin", javaBinaryName(platform));
}

export function parseJavaFeatureVersion(output: string): number | null {
  const quoted = output.match(/version "([^"]+)"/i)?.[1]?.trim();
  const value =
    quoted ??
    output.match(/\bopenjdk\s+(\d+(?:\.\d+)?)/i)?.[1]?.trim() ??
    output.match(/\bjava\s+(\d+(?:\.\d+)?)/i)?.[1]?.trim();

  if (!value) return null;
  if (value.startsWith("1.")) {
    const legacy = Number(value.split(".")[1] ?? "");
    return Number.isFinite(legacy) ? legacy : null;
  }

  const feature = Number(value.split(/[._+-]/)[0] ?? "");
  return Number.isFinite(feature) ? feature : null;
}

export function javaEnvironment(
  javaHome: string | null
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!javaHome) return env;

  const binDir = join(javaHome, "bin");
  env["JAVA_HOME"] = javaHome;
  env["PATH"] = env["PATH"] ? `${binDir}${delimiter}${env["PATH"]}` : binDir;
  return env;
}

function inspectJavaCandidate(
  executable: string,
  displayPath: string,
  home: string | null
): ResolvedJavaRuntime | null {
  try {
    const result = Bun.spawnSync([executable, "-version"], {
      env: javaEnvironment(home),
      stdout: "pipe",
      stderr: "pipe",
    });
    const combined = `${decodeOutput(result.stdout)}\n${decodeOutput(result.stderr)}`.trim();
    const featureVersion = parseJavaFeatureVersion(combined);

    if (result.exitCode !== 0) {
      return {
        executable,
        home,
        displayPath,
        featureVersion,
        validationStatus: { kind: "missing" },
      };
    }

    if (featureVersion === null) {
      return {
        executable,
        home,
        displayPath,
        featureVersion,
        validationStatus: {
          kind: "unsupported",
          message: "Installed Java could not be identified. Java 17 or newer is required.",
        },
      };
    }

    if (featureVersion < MINIMUM_JAVA_FEATURE_VERSION) {
      return {
        executable,
        home,
        displayPath,
        featureVersion,
        validationStatus: {
          kind: "unsupported",
          message: `Java ${featureVersion} found. Java ${MINIMUM_JAVA_FEATURE_VERSION} or newer is required.`,
        },
      };
    }

    return {
      executable,
      home,
      displayPath,
      featureVersion,
      validationStatus: { kind: "available" },
    };
  } catch {
    return null;
  }
}

export function resolveJavaRuntime(): ResolvedJavaRuntime {
  const envHome = process.env["JAVA_HOME"]?.trim();
  if (envHome) {
    const executable = javaExecutablePath(envHome);
    if (existsSync(executable)) {
      return (
        inspectJavaCandidate(executable, executable, envHome) ?? {
          executable,
          home: envHome,
          displayPath: executable,
          featureVersion: null,
          validationStatus: { kind: "missing" },
        }
      );
    }
  }

  const managedHome = managedJavaHome();
  const managedExecutable = javaExecutablePath(managedHome);
  if (existsSync(managedExecutable)) {
    return (
      inspectJavaCandidate(managedExecutable, managedExecutable, managedHome) ?? {
        executable: managedExecutable,
        home: managedHome,
        displayPath: managedExecutable,
        featureVersion: null,
        validationStatus: { kind: "missing" },
      }
    );
  }

  const pathCandidate = inspectJavaCandidate("java", "java", null);
  if (pathCandidate) return pathCandidate;

  return {
    executable: "java",
    home: envHome ?? null,
    displayPath: envHome ? javaExecutablePath(envHome) : "java",
    featureVersion: null,
    validationStatus: { kind: "missing" },
  };
}

export const __javaRuntimeTestUtils = {
  parseJavaFeatureVersion,
};
