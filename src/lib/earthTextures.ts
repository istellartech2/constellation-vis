export const BLUE_MARBLE_EARTH_MODE = "blue-marble" as const;
export const HIGH_RESOLUTION_EARTH_MODE = "high-resolution" as const;

export type EarthTextureMode =
  | "./assets/earth01.webp"
  | "./assets/earth02.webp"
  | typeof BLUE_MARBLE_EARTH_MODE
  | typeof HIGH_RESOLUTION_EARTH_MODE;

export type LayeredEarthMode =
  | typeof BLUE_MARBLE_EARTH_MODE
  | typeof HIGH_RESOLUTION_EARTH_MODE;

export interface EarthTextureOption {
  label: string;
  value: EarthTextureMode;
}

export interface LayeredEarthAssets {
  dayMap16k: string;
  dayMap8k: string;
  dayMap4k: string;
  normalMap4k: string;
  normalMap2k: string;
  oceanMask8k: string;
  oceanMask2k: string;
  lightsMap8k: string;
  lightsMap2k: string;
  cloudsMap8k: string;
  cloudsMap2k: string;
}

export interface ResolvedLayeredEarthAssets {
  dayMap: string;
  normalMap: string;
  oceanMask: string;
  lightsMap: string;
  cloudsMap: string;
  qualityTier: "16k" | "8k" | "4k";
}

export const EARTH_TEXTURE_OPTIONS: EarthTextureOption[] = [
  { label: "Base", value: "./assets/earth01.webp" },
  { label: "Simple", value: "./assets/earth02.webp" },
  { label: "Blue Marble", value: BLUE_MARBLE_EARTH_MODE },
  { label: "High Resolution", value: HIGH_RESOLUTION_EARTH_MODE },
];

export const LAYERED_EARTH_ASSETS: Record<LayeredEarthMode, LayeredEarthAssets> = {
  [BLUE_MARBLE_EARTH_MODE]: {
    dayMap16k: "./assets/earth_day_blue_marble_16000.webp",
    dayMap8k: "./assets/earth_day_blue_marble_8192.webp",
    dayMap4k: "./assets/earth_day_blue_marble_4096.webp",
    normalMap4k: "./assets/earth_surface_normal_4096.webp",
    normalMap2k: "./assets/earth_surface_normal_2048.webp",
    oceanMask8k: "./assets/earth_ocean_mask_8192.webp",
    oceanMask2k: "./assets/earth_ocean_mask_2048.webp",
    lightsMap8k: "./assets/earth_night_lights_8192.webp",
    lightsMap2k: "./assets/earth_night_lights_2048.webp",
    cloudsMap8k: "./assets/earth_clouds_8192.webp",
    cloudsMap2k: "./assets/earth_clouds_2048.webp",
  },
  [HIGH_RESOLUTION_EARTH_MODE]: {
    dayMap16k: "./assets/earth_day_natural_16000.webp",
    dayMap8k: "./assets/earth_day_natural_8192.webp",
    dayMap4k: "./assets/earth_day_natural_4096.webp",
    normalMap4k: "./assets/earth_surface_normal_4096.webp",
    normalMap2k: "./assets/earth_surface_normal_2048.webp",
    oceanMask8k: "./assets/earth_ocean_mask_8192.webp",
    oceanMask2k: "./assets/earth_ocean_mask_2048.webp",
    lightsMap8k: "./assets/earth_night_lights_8192.webp",
    lightsMap2k: "./assets/earth_night_lights_2048.webp",
    cloudsMap8k: "./assets/earth_clouds_8192.webp",
    cloudsMap2k: "./assets/earth_clouds_2048.webp",
  },
};

export function isLayeredEarthMode(mode: EarthTextureMode): mode is LayeredEarthMode {
  return mode === BLUE_MARBLE_EARTH_MODE || mode === HIGH_RESOLUTION_EARTH_MODE;
}

export function resolveLayeredEarthAssets(
  mode: LayeredEarthMode,
  maxTextureSize: number,
): ResolvedLayeredEarthAssets {
  const assets = LAYERED_EARTH_ASSETS[mode];

  if (maxTextureSize >= 16000) {
    return {
      dayMap: assets.dayMap16k,
      normalMap: assets.normalMap4k,
      oceanMask: assets.oceanMask8k,
      lightsMap: assets.lightsMap8k,
      cloudsMap: assets.cloudsMap8k,
      qualityTier: "16k",
    };
  }

  if (maxTextureSize >= 8192) {
    return {
      dayMap: assets.dayMap8k,
      normalMap: assets.normalMap4k,
      oceanMask: assets.oceanMask8k,
      lightsMap: assets.lightsMap8k,
      cloudsMap: assets.cloudsMap8k,
      qualityTier: "8k",
    };
  }

  return {
    dayMap: assets.dayMap4k,
    normalMap: assets.normalMap2k,
    oceanMask: assets.oceanMask2k,
    lightsMap: assets.lightsMap2k,
    cloudsMap: assets.cloudsMap2k,
    qualityTier: "4k",
  };
}
