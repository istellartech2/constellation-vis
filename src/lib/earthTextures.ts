export const BLUE_MARBLE_EARTH_MODE = "blue-marble" as const;
export const NATURAL_EARTH_MODE = "natural-earth" as const;
export const DARK_MONOCHROME_EARTH_MODE = "dark-monochrome" as const;
export const PAPER_ATLAS_EARTH_MODE = "paper-atlas" as const;

export const DEFAULT_EARTH_MODE = BLUE_MARBLE_EARTH_MODE;

/** Image-based globes, drawn with night lights and atmosphere. */
export type LayeredEarthMode =
  | typeof BLUE_MARBLE_EARTH_MODE
  | typeof NATURAL_EARTH_MODE;

export type MonochromeEarthMode =
  | typeof DARK_MONOCHROME_EARTH_MODE
  | typeof PAPER_ATLAS_EARTH_MODE;

export type EarthTextureMode = LayeredEarthMode | MonochromeEarthMode;

export interface EarthTextureOption {
  label: string;
  value: EarthTextureMode;
}

export const EARTH_TEXTURE_OPTIONS: EarthTextureOption[] = [
  { label: "衛星写真", value: BLUE_MARBLE_EARTH_MODE },
  { label: "地図（彩色）", value: NATURAL_EARTH_MODE },
  { label: "地図（ダーク）", value: DARK_MONOCHROME_EARTH_MODE },
  { label: "地図（ペーパー）", value: PAPER_ATLAS_EARTH_MODE },
];

/**
 * Retired values. The image paths and "high-resolution" were stored by
 * earlier releases; the flat and layered variants of each image are now one
 * mode, since they differed only in lighting effects.
 */
const LEGACY_EARTH_MODES: Record<string, EarthTextureMode> = {
  "./assets/earth01.webp": BLUE_MARBLE_EARTH_MODE,
  "./assets/earth02.webp": NATURAL_EARTH_MODE,
  "high-resolution": NATURAL_EARTH_MODE,
};

const EARTH_MODES = new Set<string>(EARTH_TEXTURE_OPTIONS.map(({ value }) => value));

/** Map a stored or remote value to a current mode, or undefined if unknown. */
export function normalizeEarthTextureMode(value: unknown): EarthTextureMode | undefined {
  if (typeof value !== "string") return undefined;
  if (EARTH_MODES.has(value)) return value as EarthTextureMode;
  return LEGACY_EARTH_MODES[value];
}

/** A texture with an optional higher-resolution replacement. */
export interface TieredTexture {
  low: string;
  high: string;
}

const earthAsset = (name: string) => `./assets/earth/${name}.webp`;

export const EARTH_ASSETS = {
  dayBlueMarble: { low: earthAsset("day-blue-marble-4k"), high: earthAsset("day-blue-marble-8k") },
  dayNatural: { low: earthAsset("day-natural-4k"), high: earthAsset("day-natural-8k") },
  oceanMask: { low: earthAsset("ocean-mask-2k"), high: earthAsset("ocean-mask-8k") },
  nightLights: { low: earthAsset("night-lights-2k"), high: earthAsset("night-lights-8k") },
  // Synthetic noise; a larger image would only be an upscale.
  clouds: earthAsset("clouds-2k"),
  countryBorders: earthAsset("country-borders-4k"),
} as const;

export const LAYERED_EARTH_DAY_MAPS: Record<LayeredEarthMode, TieredTexture> = {
  [BLUE_MARBLE_EARTH_MODE]: EARTH_ASSETS.dayBlueMarble,
  [NATURAL_EARTH_MODE]: EARTH_ASSETS.dayNatural,
};

/** First texture to show, plus the one to swap in once it has downloaded. */
export interface ProgressiveTexture {
  initial: string;
  upgrade?: string;
}

export interface ResolvedLayeredEarthAssets {
  dayMap: ProgressiveTexture;
  oceanMask: ProgressiveTexture;
  lightsMap: ProgressiveTexture;
  cloudsMap: string;
  qualityTier: "8k" | "4k";
}

export function isLayeredEarthMode(mode: EarthTextureMode): mode is LayeredEarthMode {
  return mode === BLUE_MARBLE_EARTH_MODE || mode === NATURAL_EARTH_MODE;
}

export function isMonochromeEarthMode(mode: EarthTextureMode): mode is MonochromeEarthMode {
  return mode === DARK_MONOCHROME_EARTH_MODE || mode === PAPER_ATLAS_EARTH_MODE;
}

/** Start from the small texture and upgrade only when the GPU can hold 8k. */
export function resolveProgressiveTexture(
  texture: TieredTexture,
  maxTextureSize: number,
): ProgressiveTexture {
  return maxTextureSize >= 8192 ? { initial: texture.low, upgrade: texture.high } : { initial: texture.low };
}

export function resolveLayeredEarthAssets(
  mode: LayeredEarthMode,
  maxTextureSize: number,
): ResolvedLayeredEarthAssets {
  return {
    dayMap: resolveProgressiveTexture(LAYERED_EARTH_DAY_MAPS[mode], maxTextureSize),
    oceanMask: resolveProgressiveTexture(EARTH_ASSETS.oceanMask, maxTextureSize),
    lightsMap: resolveProgressiveTexture(EARTH_ASSETS.nightLights, maxTextureSize),
    cloudsMap: EARTH_ASSETS.clouds,
    qualityTier: maxTextureSize >= 8192 ? "8k" : "4k",
  };
}
