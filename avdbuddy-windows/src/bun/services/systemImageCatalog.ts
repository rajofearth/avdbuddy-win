import type {
  AndroidSystemImage,
  SystemImageTag,
  CreateAVDDeviceType,
  GoogleServicesOption,
  AndroidRelease,
  AndroidVersionFamily,
  CreateAVDSelection,
  CreateAVDResolvedConfiguration,
} from "../models/types.ts";
import {
  apiLevelFromIdentifier,
  displayNameForAPI,
  displayNameForIdentifier,
} from "../models/versionCatalog.ts";

function normalizeTag(rawTag: string): SystemImageTag {
  if (rawTag === "default") return "default";
  if (rawTag.startsWith("google_apis_playstore")) return "googlePlay";
  if (rawTag === "google_apis") return "googleAPIs";
  if (rawTag === "android-tv") return "androidTV";
  if (rawTag === "google-tv") return "googleTV";
  if (rawTag.includes("wear")) return "wear";
  if (rawTag === "android-desktop") return "desktop";
  if (rawTag === "android-automotive") return "automotive";
  if (
    rawTag === "android-automotive-playstore" ||
    rawTag === "android-automotive-distant-display-playstore"
  )
    return "automotivePlay";
  if (rawTag === "google-xr") return "xr";
  return "unsupported";
}

function deviceCompatibility(tag: SystemImageTag): Set<CreateAVDDeviceType> {
  switch (tag) {
    case "androidTV":
    case "googleTV":
      return new Set(["tv"]);
    case "wear":
      return new Set(["wearOS"]);
    case "desktop":
      return new Set(["desktop"]);
    case "automotive":
    case "automotivePlay":
      return new Set(["automotive"]);
    case "xr":
      return new Set(["xr"]);
    default:
      return new Set(["phone", "foldable", "tablet"]);
  }
}

function googleServicesOption(tag: SystemImageTag): GoogleServicesOption | null {
  switch (tag) {
    case "default":
    case "desktop":
    case "androidTV":
    case "wear":
      return "none";
    case "googleAPIs":
    case "automotive":
      return "googleAPIs";
    case "googlePlay":
    case "googleTV":
    case "automotivePlay":
    case "xr":
      return "googlePlay";
    case "unsupported":
      return null;
  }
}

function architectureDisplayName(abi: string): string {
  switch (abi) {
    case "arm64-v8a":
      return "arm64";
    case "x86_64":
      return "x86_64";
    case "x86":
      return "x86";
    case "armeabi-v7a":
      return "armv7";
    default:
      return abi;
  }
}

function tagPriority(tag: SystemImageTag): number {
  const map: Record<SystemImageTag, number> = {
    googlePlay: 0,
    googleAPIs: 1,
    automotivePlay: 2,
    xr: 3,
    default: 4,
    googleTV: 5,
    androidTV: 6,
    wear: 7,
    desktop: 8,
    automotive: 9,
    unsupported: 10,
  };
  return map[tag] ?? 11;
}

function architecturePriority(arch: string): number {
  switch (arch) {
    case "arm64":
      return 0;
    case "x86_64":
      return 1;
    case "x86":
      return 2;
    case "armv7":
      return 3;
    default:
      return 4;
  }
}

function imageSort(a: AndroidSystemImage, b: AndroidSystemImage): number {
  if (a.isInstalled !== b.isInstalled) return a.isInstalled ? -1 : 1;
  const tagA = normalizeTag(a.tag);
  const tagB = normalizeTag(b.tag);
  if (tagA !== tagB) return tagPriority(tagA) - tagPriority(tagB);
  return (
    architecturePriority(architectureDisplayName(a.abi)) -
    architecturePriority(architectureDisplayName(b.abi))
  );
}

export function parseSdkManagerOutput(output: string): AndroidSystemImage[] {
  const lines = output.split(/\r?\n/);
  let section: "installed" | "available" | null = null;
  const installedPackages = new Set<string>();
  const availablePackages = new Set<string>();
  const descriptions: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "Installed packages:") {
      section = "installed";
      continue;
    }
    if (trimmed === "Available Packages:") {
      section = "available";
      continue;
    }
    if (!section || !trimmed.startsWith("system-images;")) continue;

    const columns = trimmed.split("|").map((c) => c.trim());
    const packagePath = columns[0];
    if (!packagePath?.startsWith("system-images;")) continue;

    const description = columns.length > 2 ? (columns[2] ?? "") : "";
    descriptions[packagePath] = description;

    if (section === "installed") installedPackages.add(packagePath);
    else availablePackages.add(packagePath);
  }

  const allPackages = new Set([...installedPackages, ...availablePackages]);
  const images: AndroidSystemImage[] = [];

  for (const pkg of allPackages) {
    const parts = pkg.split(";");
    if (parts.length !== 4 || parts[0] !== "system-images") continue;
    images.push({
      packagePath: pkg,
      versionIdentifier: parts[1]!,
      tag: parts[2]!,
      abi: parts[3]!,
      description: descriptions[pkg] ?? "",
      isInstalled: installedPackages.has(pkg),
    });
  }

  return images;
}

function releaseTitle(versionIdentifier: string): string {
  if (apiLevelFromIdentifier(versionIdentifier) !== null) {
    if (versionIdentifier.includes("-ext")) {
      const extIdx = versionIdentifier.lastIndexOf("ext");
      const extValue = versionIdentifier.slice(extIdx + 3);
      return `Extension ${extValue}`;
    }
    if (versionIdentifier.includes(".")) {
      return versionIdentifier.slice("android-".length);
    }
    return "Base release";
  }
  if (versionIdentifier.startsWith("android-")) {
    return versionIdentifier.slice("android-".length);
  }
  return versionIdentifier;
}

function releaseSubtitle(versionIdentifier: string): string | null {
  const apiLevel = apiLevelFromIdentifier(versionIdentifier);
  if (apiLevel !== null) {
    if (versionIdentifier.includes("-ext")) {
      const extIdx = versionIdentifier.lastIndexOf("ext");
      const extValue = versionIdentifier.slice(extIdx + 3);
      return `API ${apiLevel} Extension ${extValue}`;
    }
    return `API ${apiLevel}`;
  }
  if (versionIdentifier.startsWith("android-")) {
    return versionIdentifier.slice("android-".length);
  }
  return versionIdentifier;
}

function familyID(release: AndroidRelease): string {
  const api = apiLevelFromIdentifier(release.versionIdentifier);
  if (api !== null) return `api-${api}`;
  return release.versionIdentifier;
}

export function versionFamilies(
  images: AndroidSystemImage[],
  deviceType: CreateAVDDeviceType
): AndroidVersionFamily[] {
  const compatible = images.filter((img) =>
    deviceCompatibility(normalizeTag(img.tag)).has(deviceType)
  );

  const byIdentifier: Record<string, AndroidSystemImage[]> = {};
  for (const img of compatible) {
    const key = img.versionIdentifier;
    if (!byIdentifier[key]) byIdentifier[key] = [];
    byIdentifier[key]!.push(img);
  }

  const releases: AndroidRelease[] = Object.values(byIdentifier).map(
    (imgs) => {
      const sorted = [...imgs].sort(imageSort);
      const vid = imgs[0]!.versionIdentifier;
      return {
        versionIdentifier: vid,
        title: releaseTitle(vid),
        subtitle: releaseSubtitle(vid),
        images: sorted,
        isPreview: imgs.some((i) => /[a-zA-Z]/.test(i.versionIdentifier)),
        installedCount: imgs.filter((i) => i.isInstalled).length,
      };
    }
  );

  releases.sort((a, b) => {
    const aApi = apiLevelFromIdentifier(a.versionIdentifier) ?? -1;
    const bApi = apiLevelFromIdentifier(b.versionIdentifier) ?? -1;
    if (aApi !== bApi) return bApi - aApi;
    if (a.isPreview !== b.isPreview) return a.isPreview ? 1 : -1;
    return b.versionIdentifier.localeCompare(a.versionIdentifier);
  });

  const grouped: Record<string, AndroidRelease[]> = {};
  for (const rel of releases) {
    const fid = familyID(rel);
    if (!grouped[fid]) grouped[fid] = [];
    grouped[fid]!.push(rel);
  }

  const families: AndroidVersionFamily[] = Object.entries(grouped).map(
    ([fid, rels]) => {
      let title: string;
      let subtitle: string | null;
      if (fid.startsWith("api-")) {
        const apiLevel = parseInt(fid.slice(4), 10);
        title = displayNameForAPI(apiLevel);
        subtitle = `API ${apiLevel}`;
      } else {
        title = rels[0]?.title ?? "Android";
        subtitle = rels[0]?.subtitle ?? null;
      }
      return {
        id: fid,
        title,
        subtitle,
        releases: rels,
        defaultReleaseIdentifier: rels[0]?.versionIdentifier ?? null,
      };
    }
  );

  families.sort((a, b) => {
    const aMax = Math.max(
      ...a.releases.map(
        (r) => apiLevelFromIdentifier(r.versionIdentifier) ?? -1
      )
    );
    const bMax = Math.max(
      ...b.releases.map(
        (r) => apiLevelFromIdentifier(r.versionIdentifier) ?? -1
      )
    );
    if (aMax !== bMax) return bMax - aMax;
    return b.id.localeCompare(a.id);
  });

  return families;
}

export function availableGoogleServiceOptions(
  release: AndroidRelease | null,
  deviceType: CreateAVDDeviceType
): GoogleServicesOption[] {
  if (!release) return [];
  const options = new Set(
    release.images
      .map((i) => googleServicesOption(normalizeTag(i.tag)))
      .filter((o): o is GoogleServicesOption => o !== null)
  );

  const order: Record<CreateAVDDeviceType, GoogleServicesOption[]> = {
    wearOS: ["none"],
    desktop: ["none"],
    tv: ["none", "googlePlay"],
    automotive: ["googleAPIs", "googlePlay"],
    xr: ["googlePlay"],
    phone: ["none", "googleAPIs", "googlePlay"],
    foldable: ["none", "googleAPIs", "googlePlay"],
    tablet: ["none", "googleAPIs", "googlePlay"],
  };

  return (order[deviceType] ?? []).filter((o) => options.has(o));
}

export function availableArchitectures(
  release: AndroidRelease | null,
  deviceType: CreateAVDDeviceType,
  googleServices: GoogleServicesOption
): string[] {
  if (!release) return [];
  const archs = new Set(
    release.images
      .filter(
        (i) =>
          deviceCompatibility(normalizeTag(i.tag)).has(deviceType) &&
          googleServicesOption(normalizeTag(i.tag)) === googleServices
      )
      .map((i) => architectureDisplayName(i.abi))
  );
  return [...archs].sort(
    (a, b) => architecturePriority(a) - architecturePriority(b)
  );
}

export function resolveConfiguration(
  selection: CreateAVDSelection,
  images: AndroidSystemImage[]
): CreateAVDResolvedConfiguration | null {
  if (!selection.selectedVersionIdentifier) return null;

  const matching = images.filter(
    (i) =>
      i.versionIdentifier === selection.selectedVersionIdentifier &&
      deviceCompatibility(normalizeTag(i.tag)).has(selection.deviceType) &&
      googleServicesOption(normalizeTag(i.tag)) === selection.googleServices
  );

  const filteredByArch = selection.architecture
    ? matching.filter(
        (i) => architectureDisplayName(i.abi) === selection.architecture
      )
    : matching;

  const resolved = (filteredByArch.length > 0 ? filteredByArch : matching)
    .sort(imageSort)[0];
  if (!resolved) return null;

  const ramMap: Record<string, number | null> = {
    recommended: null,
    gb2: 2048,
    gb4: 4096,
    gb8: 8192,
  };
  const storageMap: Record<string, string> = {
    gb8: "8GB",
    gb16: "16GB",
    gb32: "32GB",
    gb64: "64GB",
  };
  const sdCardMap: Record<string, string | null> = {
    none: null,
    gb2: "2048M",
    gb4: "4096M",
    gb8: "8192M",
  };

  return {
    packagePath: resolved.packagePath,
    avdName: selection.avdName,
    deviceProfileID: selection.deviceProfile.id,
    ramMB: ramMap[selection.ramPreset] ?? null,
    storage: storageMap[selection.storagePreset] ?? "16GB",
    sdCard: sdCardMap[selection.sdCardPreset] ?? null,
    showDeviceFrame: selection.showDeviceFrame,
    colorSeed: fallbackColorSeed(selection.avdName),
  };
}

function fallbackColorSeed(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
