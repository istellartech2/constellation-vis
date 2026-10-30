import { describe, expect, it } from "bun:test";
import { applyPointStyle, createPointStyleUniforms, MAX_PIXEL_SIZE } from "../src/lib/satellitePointStyle";
import { validateRemoteDisplay } from "../src/lib/remoteDisplay";

describe("satellite point style uniforms", () => {
  it("defaults to world-size dots with no lighting cues", () => {
    const u = createPointStyleUniforms();
    expect(u.uPixelSize.value).toBe(0);
    expect(u.uSunlitShading.value).toBe(0);
    expect(u.uGlint.value).toBe(0);
  });

  it("applies a style in place and clamps the pixel size", () => {
    const u = createPointStyleUniforms();
    const sunDir = u.uSunDir;
    applyPointStyle(u, { pixelSize: 9, sunlitShading: true, glint: true });
    expect(u.uPixelSize.value).toBe(MAX_PIXEL_SIZE);
    expect(u.uSunlitShading.value).toBe(1);
    expect(u.uGlint.value).toBe(1);
    // Materials hold these objects by reference; they must not be replaced.
    expect(u.uSunDir).toBe(sunDir);
  });
});

describe("remote point style fields", () => {
  it("accepts pixel size 0–3 and boolean cues", () => {
    expect(validateRemoteDisplay({ satPixelSize: 2, satSunlitShading: true, satGlint: false }))
      .toEqual({ satPixelSize: 2, satSunlitShading: true, satGlint: false });
    expect(() => validateRemoteDisplay({ satPixelSize: 5 })).toThrow();
    expect(() => validateRemoteDisplay({ satGlint: 1 })).toThrow();
  });
});
