import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLUE_MARBLE_EARTH_MODE,
  DARK_MONOCHROME_EARTH_MODE,
  EARTH_ASSETS,
  EARTH_TEXTURE_OPTIONS,
  NATURAL_EARTH_MODE,
  PAPER_ATLAS_EARTH_MODE,
  isLayeredEarthMode,
  isMonochromeEarthMode,
  normalizeEarthTextureMode,
  resolveLayeredEarthAssets,
} from "./earthTextures";

const publicPath = (asset: string) => join(import.meta.dir, "../../public", asset);

describe("earthTextures", () => {
  it("includes the expected selector options", () => {
    expect(EARTH_TEXTURE_OPTIONS.map((option) => option.value)).toEqual([
      BLUE_MARBLE_EARTH_MODE,
      NATURAL_EARTH_MODE,
      DARK_MONOCHROME_EARTH_MODE,
      PAPER_ATLAS_EARTH_MODE,
    ]);
  });

  it("points every asset at a file in public/", () => {
    const paths = Object.values(EARTH_ASSETS).flatMap((asset) =>
      typeof asset === "string" ? [asset] : [asset.low, asset.high],
    );
    for (const path of paths) expect(existsSync(publicPath(path))).toBe(true);
  });

  it("classifies every mode exactly once", () => {
    for (const { value } of EARTH_TEXTURE_OPTIONS) {
      expect(isLayeredEarthMode(value)).toBe(!isMonochromeEarthMode(value));
    }
  });

  it("normalizes legacy and unknown values", () => {
    expect(normalizeEarthTextureMode("./assets/earth01.webp")).toBe(BLUE_MARBLE_EARTH_MODE);
    expect(normalizeEarthTextureMode("./assets/earth02.webp")).toBe(NATURAL_EARTH_MODE);
    expect(normalizeEarthTextureMode("high-resolution")).toBe(NATURAL_EARTH_MODE);
    expect(normalizeEarthTextureMode(BLUE_MARBLE_EARTH_MODE)).toBe(BLUE_MARBLE_EARTH_MODE);
    expect(normalizeEarthTextureMode("https://example.com/earth.webp")).toBeUndefined();
    expect(normalizeEarthTextureMode(42)).toBeUndefined();
  });

  it("starts at 4k and upgrades to 8k only when the GPU allows it", () => {
    const high = resolveLayeredEarthAssets(BLUE_MARBLE_EARTH_MODE, 16384);
    expect(high.qualityTier).toBe("8k");
    expect(high.dayMap).toEqual({
      initial: EARTH_ASSETS.dayBlueMarble.low,
      upgrade: EARTH_ASSETS.dayBlueMarble.high,
    });
    expect(high.cloudsMap).toBe(EARTH_ASSETS.clouds);

    const low = resolveLayeredEarthAssets(NATURAL_EARTH_MODE, 4096);
    expect(low.qualityTier).toBe("4k");
    expect(low.dayMap).toEqual({ initial: EARTH_ASSETS.dayNatural.low });
    expect(low.lightsMap.upgrade).toBeUndefined();
  });

  it("dims the brighter map so both globes read alike under the same sun", () => {
    const photo = resolveLayeredEarthAssets(BLUE_MARBLE_EARTH_MODE, 4096).lighting;
    const map = resolveLayeredEarthAssets(NATURAL_EARTH_MODE, 4096).lighting;
    expect(map.albedo).toBeLessThan(photo.albedo);
    expect(map.glint).toBeLessThan(photo.glint);
    expect(photo.night).toBeGreaterThan(map.night);
  });

  it("prefetches each mode's first images from index.html", () => {
    const html = readFileSync(join(import.meta.dir, "../../index.html"), "utf8");
    const prefetched = (mode: string) => {
      const match = html.match(new RegExp(`"${mode}": \\[([^\\]]*)\\]`));
      return (match?.[1].match(/"[^"]+"/g) ?? []).map((name) => `./assets/earth/${name.slice(1, -1)}.webp`);
    };
    const maxTextureSize = 16384;
    for (const mode of [BLUE_MARBLE_EARTH_MODE, NATURAL_EARTH_MODE] as const) {
      const assets = resolveLayeredEarthAssets(mode, maxTextureSize);
      expect(prefetched(mode).sort()).toEqual(
        [assets.dayMap.initial, assets.oceanMask.initial, assets.lightsMap.initial, assets.reliefMap].sort(),
      );
    }
    for (const mode of [DARK_MONOCHROME_EARTH_MODE, PAPER_ATLAS_EARTH_MODE]) {
      expect(prefetched(mode).sort()).toEqual([EARTH_ASSETS.countryBorders, EARTH_ASSETS.oceanMask.low].sort());
    }
  });
});
