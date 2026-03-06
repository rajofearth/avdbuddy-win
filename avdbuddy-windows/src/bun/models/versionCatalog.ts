const API_DISPLAY_NAMES: Record<number, string> = {
  36: "Android 16",
  35: "Android 15",
  34: "Android 14",
  33: "Android 13",
  32: "Android 12L",
  31: "Android 12",
  30: "Android 11",
  29: "Android 10",
  28: "Android 9 Pie",
  27: "Android 8.1 Oreo",
  26: "Android 8.0 Oreo",
  25: "Android 7.1 Nougat",
  24: "Android 7.0 Nougat",
  23: "Android 6.0 Marshmallow",
  22: "Android 5.1 Lollipop",
  21: "Android 5.0 Lollipop",
  19: "Android 4.4 KitKat",
};

export function displayNameForAPI(apiLevel: number): string {
  return API_DISPLAY_NAMES[apiLevel] ?? "Android";
}

export function displayNameForIdentifier(identifier: string): string {
  const apiLevel = apiLevelFromIdentifier(identifier);
  if (apiLevel !== null) {
    return displayNameForAPI(apiLevel);
  }
  if (identifier.startsWith("android-")) {
    const suffix = identifier.slice("android-".length);
    return `Android ${suffix}`;
  }
  return `Android ${identifier}`;
}

export function apiLevelFromIdentifier(identifier: string): number | null {
  if (identifier.startsWith("android-")) {
    const suffix = identifier.slice("android-".length);
    const numericPrefix = suffix.match(/^(\d+)/)?.[1];
    if (numericPrefix) {
      return parseInt(numericPrefix, 10);
    }
  } else {
    const n = parseInt(identifier, 10);
    if (!isNaN(n)) return n;
  }
  return null;
}
