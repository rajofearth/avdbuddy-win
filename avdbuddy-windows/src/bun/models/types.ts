export interface EmulatorInstance {
  id: string;
  name: string;
  apiLevel: number | null;
  deviceType: EmulatorDeviceType;
  colorSeed: string;
  isRunning: boolean;
  isDeleting: boolean;
}

export type EmulatorDeviceType =
  | "phone"
  | "tablet"
  | "foldable"
  | "wearOS"
  | "desktop"
  | "tv"
  | "automotive"
  | "xr"
  | "unknown";

export const deviceTypeLabel: Record<EmulatorDeviceType, string> = {
  phone: "Phone",
  tablet: "Tablet",
  foldable: "Foldable",
  wearOS: "Wear OS",
  desktop: "Desktop",
  tv: "TV",
  automotive: "Automotive",
  xr: "XR",
  unknown: "Unknown",
};

export interface AndroidToolchain {
  sdkPath: string;
  sdkManager: string;
  avdManager: string;
  emulator: string;
  adb: string;
}

export type AndroidTool = "sdkManager" | "avdManager" | "emulator" | "adb";

export const androidToolTitle: Record<AndroidTool, string> = {
  sdkManager: "sdkmanager",
  avdManager: "avdmanager",
  emulator: "emulator",
  adb: "adb",
};

export type ValidationStatus =
  | { kind: "available" }
  | { kind: "missing" }
  | { kind: "unsupported"; message: string };

export interface AndroidToolState {
  tool: AndroidTool;
  path: string;
  validationStatus: ValidationStatus;
}

export interface AndroidToolchainStatus {
  sdkPath: string;
  isStoredOverride: boolean;
  toolStates: AndroidToolState[];
  isConfigured: boolean;
  summary: string;
}

export interface AndroidSDKSetupResult {
  sdkPath: string;
  installedPackages: string[];
  status: AndroidToolchainStatus;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AndroidSystemImage {
  packagePath: string;
  versionIdentifier: string;
  tag: string;
  abi: string;
  description: string;
  isInstalled: boolean;
}

export type SystemImageTag =
  | "default"
  | "googleAPIs"
  | "googlePlay"
  | "androidTV"
  | "googleTV"
  | "wear"
  | "desktop"
  | "automotive"
  | "automotivePlay"
  | "xr"
  | "unsupported";

export type GoogleServicesOption = "none" | "googleAPIs" | "googlePlay";

export type CreateAVDDeviceType =
  | "phone"
  | "foldable"
  | "tablet"
  | "wearOS"
  | "desktop"
  | "tv"
  | "automotive"
  | "xr";

export interface AVDDeviceProfile {
  id: string;
  name: string;
}

export interface AndroidRelease {
  versionIdentifier: string;
  title: string;
  subtitle: string | null;
  images: AndroidSystemImage[];
  isPreview: boolean;
  installedCount: number;
}

export interface AndroidVersionFamily {
  id: string;
  title: string;
  subtitle: string | null;
  releases: AndroidRelease[];
  defaultReleaseIdentifier: string | null;
}

export interface CreateAVDSelection {
  deviceType: CreateAVDDeviceType;
  avdName: string;
  selectedVersionFamilyID: string | null;
  selectedVersionIdentifier: string | null;
  googleServices: GoogleServicesOption;
  architecture: string | null;
  deviceProfile: AVDDeviceProfile;
  ramPreset: string;
  storagePreset: string;
  sdCardPreset: string;
  showDeviceFrame: boolean;
}

export interface CreateAVDResolvedConfiguration {
  packagePath: string;
  avdName: string;
  deviceProfileID: string;
  ramMB: number | null;
  storage: string;
  sdCard: string | null;
  showDeviceFrame: boolean;
  colorSeed: string;
}
