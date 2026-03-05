import type { EmulatorDeviceType } from "../models/types.ts";

function valueForKey(key: string, config: string): string | null {
  const lines = config.split(/\r?\n/);
  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const k = line.substring(0, eqIndex);
    if (k === key) return line.substring(eqIndex + 1);
  }
  return null;
}

export function parseApiLevel(config: string): number | null {
  const patterns = [/target=android-(\d+)/, /image\.sysdir\.1=.*android-(\d+)/];
  for (const pattern of patterns) {
    const match = config.match(pattern);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

export function parseScreenDimensions(
  config: string
): { width: number; height: number } | null {
  const widthMatch = config.match(/^hw\.lcd\.width=(\d+)$/m);
  const heightMatch = config.match(/^hw\.lcd\.height=(\d+)$/m);
  if (!widthMatch?.[1] || !heightMatch?.[1]) return null;
  return {
    width: parseInt(widthMatch[1], 10),
    height: parseInt(heightMatch[1], 10),
  };
}

export function parseDeviceType(config: string): EmulatorDeviceType {
  const hingeSensor = valueForKey("hw.sensor.hinge", config)?.toLowerCase();
  if (hingeSensor === "yes") return "foldable";

  const deviceName = valueForKey("hw.device.name", config)?.toLowerCase();
  if (deviceName?.includes("fold")) return "foldable";

  const tagID = valueForKey("tag.id", config)?.toLowerCase();
  if (tagID?.includes("tv")) return "tv";
  if (tagID?.includes("wear")) return "wearOS";
  if (tagID?.includes("desktop")) return "desktop";
  if (tagID?.includes("automotive")) return "automotive";
  if (tagID?.includes("xr") || tagID?.includes("glasses")) return "xr";

  if (deviceName?.startsWith("tv_")) return "tv";
  if (deviceName?.startsWith("wearos_")) return "wearOS";
  if (deviceName?.startsWith("desktop_")) return "desktop";
  if (deviceName?.startsWith("automotive_")) return "automotive";
  if (deviceName?.startsWith("xr_") || deviceName?.startsWith("ai_glasses_"))
    return "xr";

  const dims = parseScreenDimensions(config);
  if (!dims) return "unknown";
  const ratio =
    Math.max(dims.width, dims.height) / Math.min(dims.width, dims.height);
  return ratio <= 1.7 ? "tablet" : "phone";
}

export function parseColorSeed(config: string): string | null {
  return valueForKey("avdbuddy.color.seed", config);
}

export function parseDeviceName(config: string): string | null {
  return valueForKey("hw.device.name", config);
}

export function parseSkinName(config: string): string | null {
  return valueForKey("skin.name", config);
}

export function parseSkinPath(config: string): string | null {
  return valueForKey("skin.path", config);
}

export function parseShowDeviceFrame(config: string): boolean | null {
  const val = valueForKey("showDeviceFrame", config)?.toLowerCase();
  if (!val) return null;
  if (["yes", "true", "1"].includes(val)) return true;
  if (["no", "false", "0"].includes(val)) return false;
  return null;
}
