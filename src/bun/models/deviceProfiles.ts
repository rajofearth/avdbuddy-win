import type { AVDDeviceProfile, CreateAVDDeviceType } from "./types.ts";

export function getProfileOptions(
  deviceType: CreateAVDDeviceType
): AVDDeviceProfile[] {
  switch (deviceType) {
    case "phone":
      return [
        { id: "pixel_9", name: "Pixel 9" },
        { id: "pixel_9a", name: "Pixel 9a" },
        { id: "pixel_9_pro", name: "Pixel 9 Pro" },
        { id: "pixel_9_pro_xl", name: "Pixel 9 Pro XL" },
      ];
    case "foldable":
      return [
        { id: "pixel_9_pro_fold", name: "Pixel 9 Pro Fold" },
        { id: "pixel_fold", name: "Pixel Fold" },
      ];
    case "tablet":
      return [{ id: "pixel_tablet", name: "Pixel Tablet" }];
    case "wearOS":
      return [
        { id: "wearos_large_round", name: "Large Round" },
        { id: "wearos_rect", name: "Rectangular" },
        { id: "wearos_square", name: "Square" },
      ];
    case "desktop":
      return [
        { id: "desktop_small", name: "Small Desktop" },
        { id: "desktop_medium", name: "Medium Desktop" },
        { id: "desktop_large", name: "Large Desktop" },
      ];
    case "tv":
      return [
        { id: "tv_1080p", name: "TV 1080p" },
        { id: "tv_4k", name: "TV 4K" },
        { id: "tv_720p", name: "TV 720p" },
      ];
    case "automotive":
      return [
        { id: "automotive_1080p_landscape", name: "1080p Landscape" },
        { id: "automotive_1024p_landscape", name: "1024p Landscape" },
        {
          id: "automotive_1408p_landscape_with_google_apis",
          name: "1408p Landscape",
        },
        { id: "automotive_distant_display", name: "Distant Display" },
        { id: "automotive_large_portrait", name: "Large Portrait" },
        { id: "automotive_portrait", name: "Portrait" },
        { id: "automotive_ultrawide", name: "Ultrawide" },
      ];
    case "xr":
      return [
        { id: "xr_headset_device", name: "XR Headset" },
        { id: "xr_glasses_device", name: "XR Glasses" },
      ];
  }
}

const NAME_FIRST_WORDS = [
  "Amber", "Atlas", "Axiom", "Cinder", "Cobalt", "Comet", "Cosmic", "Drift",
  "Ember", "Fable", "Flare", "Glacier", "Halo", "Indigo", "Ion", "Juniper",
  "Lumen", "Mist", "Nova", "Orbit", "Quartz", "Rocket", "Solar", "Sprout",
  "Velvet",
];

const NAME_SECOND_WORDS = [
  "Bloom", "Brook", "Cloud", "Cove", "Dawn", "Echo", "Field", "Flare",
  "Grove", "Harbor", "Horizon", "Meadow", "Moon", "Pine", "Ripple", "River",
  "Shadow", "Sky", "Spring", "Star", "Stone", "Trail", "Vale", "Wave", "Wind",
];

export function randomSuggestedName(): string {
  const first =
    NAME_FIRST_WORDS[Math.floor(Math.random() * NAME_FIRST_WORDS.length)] ??
    "Nova";
  let second =
    NAME_SECOND_WORDS[Math.floor(Math.random() * NAME_SECOND_WORDS.length)] ??
    "Harbor";
  if (second === first) {
    second = NAME_SECOND_WORDS.find((w) => w !== first) ?? "Harbor";
  }
  return `${first}_${second}`;
}

export const RAM_PRESETS = [
  { id: "recommended", label: "Default", megabytes: null },
  { id: "gb2", label: "2 GB", megabytes: 2048 },
  { id: "gb4", label: "4 GB", megabytes: 4096 },
  { id: "gb8", label: "8 GB", megabytes: 8192 },
] as const;

export const STORAGE_PRESETS = [
  { id: "gb8", label: "8 GB", configValue: "8GB" },
  { id: "gb16", label: "16 GB", configValue: "16GB" },
  { id: "gb32", label: "32 GB", configValue: "32GB" },
  { id: "gb64", label: "64 GB", configValue: "64GB" },
] as const;

export const SD_CARD_PRESETS = [
  { id: "none", label: "None", avdManagerValue: null },
  { id: "gb2", label: "2 GB", avdManagerValue: "2048M" },
  { id: "gb4", label: "4 GB", avdManagerValue: "4096M" },
  { id: "gb8", label: "8 GB", avdManagerValue: "8192M" },
] as const;

export const GOOGLE_SERVICES_OPTIONS = [
  { id: "none", label: "No Google services" },
  { id: "googleAPIs", label: "Google APIs" },
  { id: "googlePlay", label: "Google Play" },
] as const;
