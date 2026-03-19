import {
  BLUE_MARBLE_EARTH_MODE,
  EARTH_TEXTURE_OPTIONS,
  HIGH_RESOLUTION_EARTH_MODE,
  LAYERED_EARTH_ASSETS,
  isLayeredEarthMode,
  resolveLayeredEarthAssets,
} from "./earthTextures";

describe("earthTextures", () => {
  it("includes the expected selector options", () => {
    expect(EARTH_TEXTURE_OPTIONS.map((option) => option.value)).toEqual([
      "./assets/earth01.webp",
      "./assets/earth02.webp",
      BLUE_MARBLE_EARTH_MODE,
      HIGH_RESOLUTION_EARTH_MODE,
    ]);
  });

  it("defines all required blue marble assets", () => {
    expect(LAYERED_EARTH_ASSETS[BLUE_MARBLE_EARTH_MODE]).toEqual({
      dayMap16k: expect.stringContaining("earth_day_blue_marble_16000.webp"),
      dayMap8k: expect.stringContaining("earth_day_blue_marble_8192.webp"),
      dayMap4k: expect.stringContaining("earth_day_blue_marble_4096.webp"),
      normalMap4k: expect.stringContaining("earth_surface_normal_4096.webp"),
      normalMap2k: expect.stringContaining("earth_surface_normal_2048.webp"),
      oceanMask8k: expect.stringContaining("earth_ocean_mask_8192.webp"),
      oceanMask2k: expect.stringContaining("earth_ocean_mask_2048.webp"),
      lightsMap8k: expect.stringContaining("earth_night_lights_8192.webp"),
      lightsMap2k: expect.stringContaining("earth_night_lights_2048.webp"),
      cloudsMap8k: expect.stringContaining("earth_clouds_8192.webp"),
      cloudsMap2k: expect.stringContaining("earth_clouds_2048.webp"),
    });
  });

  it("defines all required high resolution assets", () => {
    expect(LAYERED_EARTH_ASSETS[HIGH_RESOLUTION_EARTH_MODE]).toEqual({
      dayMap16k: expect.stringContaining("earth_day_natural_16000.webp"),
      dayMap8k: expect.stringContaining("earth_day_natural_8192.webp"),
      dayMap4k: expect.stringContaining("earth_day_natural_4096.webp"),
      normalMap4k: expect.stringContaining("earth_surface_normal_4096.webp"),
      normalMap2k: expect.stringContaining("earth_surface_normal_2048.webp"),
      oceanMask8k: expect.stringContaining("earth_ocean_mask_8192.webp"),
      oceanMask2k: expect.stringContaining("earth_ocean_mask_2048.webp"),
      lightsMap8k: expect.stringContaining("earth_night_lights_8192.webp"),
      lightsMap2k: expect.stringContaining("earth_night_lights_2048.webp"),
      cloudsMap8k: expect.stringContaining("earth_clouds_8192.webp"),
      cloudsMap2k: expect.stringContaining("earth_clouds_2048.webp"),
    });
  });

  it("identifies layered earth modes", () => {
    expect(isLayeredEarthMode(BLUE_MARBLE_EARTH_MODE)).toBe(true);
    expect(isLayeredEarthMode(HIGH_RESOLUTION_EARTH_MODE)).toBe(true);
    expect(isLayeredEarthMode("./assets/earth01.webp")).toBe(false);
  });

  it("resolves texture tiers for both layered modes", () => {
    expect(resolveLayeredEarthAssets(BLUE_MARBLE_EARTH_MODE, 16384).qualityTier).toBe("16k");
    expect(resolveLayeredEarthAssets(BLUE_MARBLE_EARTH_MODE, 8192).qualityTier).toBe("8k");
    expect(resolveLayeredEarthAssets(HIGH_RESOLUTION_EARTH_MODE, 4096).qualityTier).toBe("4k");
  });
});
