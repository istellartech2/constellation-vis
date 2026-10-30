import { describe, expect, it } from "bun:test";
import { constants, jday, sunPos } from "satellite.js";
import { earthShadowFraction } from "../src/lib/illumination";
import { sunVectorECI } from "../src/lib/astronomy";
import { isInEarthShadow } from "../src/lib/satelliteDerivedInfo";

const date = new Date("2026-03-20T12:00:00Z");
const sun = sunVectorECI(date);
const lengthXY = Math.hypot(sun.x, sun.y);
const tangent = { x: -sun.y / lengthXY, y: sun.x / lengthXY, z: 0 };

function atAngle(angle: number, radius = 7000) {
  return {
    x: radius * (-sun.x * Math.cos(angle) + tangent.x * Math.sin(angle)),
    y: radius * (-sun.y * Math.cos(angle) + tangent.y * Math.sin(angle)),
    z: radius * -sun.z * Math.cos(angle),
  };
}

describe("library-backed illumination", () => {
  it("keeps rendering and eclipse solar directions consistent", () => {
    const rsun = sunPos(jday(date)).rsun;
    const length = Math.hypot(rsun.x, rsun.y, rsun.z);
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 14);
    expect(sun.x).toBeCloseTo(rsun.x / length, 14);
    expect(sun.z).toBeCloseTo(rsun.z / length, 14);
  });

  it("handles the exact solar and anti-solar axes without NaN across a year", () => {
    for (let day = 0; day < 365; day++) {
      const at = new Date(Date.UTC(2026, 0, day + 1));
      const s = sunVectorECI(at);
      for (const radius of [7000, 42164]) {
        expect(earthShadowFraction({ x: -radius * s.x, y: -radius * s.y, z: -radius * s.z }, at)).toBe(1);
        expect(earthShadowFraction({ x: radius * s.x, y: radius * s.y, z: radius * s.z }, at)).toBe(0);
      }
    }
  });

  it("resolves penumbra continuously at LEO and GEO limbs", () => {
    for (const radius of [7000, 42164]) {
      const limb = Math.asin(constants.earthRadius / radius);
      let previous = 1;
      for (let i = -100; i <= 100; i++) {
        const fraction = earthShadowFraction(atAngle(limb + i * 0.0001, radius), date);
        expect(Number.isFinite(fraction)).toBe(true);
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThanOrEqual(previous + 1e-10);
        previous = fraction;
      }
      expect(previous).toBe(0);
      const middle = earthShadowFraction(atAngle(limb, radius), date);
      expect(middle).toBeGreaterThan(0.49);
      expect(middle).toBeLessThan(0.51);
      expect(isInEarthShadow(atAngle(limb - 0.002, radius), date)).toBe(true);
      expect(isInEarthShadow(atAngle(limb + 0.002, radius), date)).toBe(false);
    }
  });
});
