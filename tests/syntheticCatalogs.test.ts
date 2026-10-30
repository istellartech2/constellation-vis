import { describe, expect, it } from "bun:test";
import { j2OrbitsFromCatalog } from "../src/lib/j2Propagator";
import {
  STARMIND_SHELL_ALTITUDES_KM,
  sunRightAscensionDeg,
  sunSynchronousInclinationDeg,
  syntheticCatalog,
} from "../src/lib/syntheticCatalogs";

const DEG = Math.PI / 180;
/** Signed difference a − b wrapped to (−180°, 180°]. */
const wrapDeg = (d: number) => ((d % 360) + 540) % 360 - 180;

describe("sun-synchronous inclination", () => {
  it("matches textbook values", () => {
    expect(sunSynchronousInclinationDeg(550)).toBeCloseTo(97.6, 0);
    expect(sunSynchronousInclinationDeg(800)).toBeCloseTo(98.6, 0);
    expect(sunSynchronousInclinationDeg(2000)).toBeGreaterThan(104);
    expect(sunSynchronousInclinationDeg(2000)).toBeLessThan(106);
  });
});

describe("Starmind estimate", () => {
  const epochMs = Date.UTC(2026, 9, 30);
  const cat = syntheticCatalog("starmind", 31_000, epochMs);

  it("fills every 50 km shell from 500 to 2,000 km", () => {
    expect(cat.count).toBe(31_000);
    const altitudes = new Set<number>();
    const orbits = j2OrbitsFromCatalog(cat);
    for (let i = 0; i < cat.count; i += 997) altitudes.add(Math.round((orbits.semiMajorAxisKm[i] - 6378) / 50) * 50);
    expect(Math.min(...altitudes)).toBe(500);
    expect(Math.max(...altitudes)).toBe(2000);
    expect(STARMIND_SHELL_ALTITUDES_KM).toHaveLength(31);
  });

  it("puts every ascending node near LTAN 18:00 (dawn–dusk)", () => {
    const sunRa = sunRightAscensionDeg(epochMs);
    for (let i = 0; i < cat.count; i += 101) {
      expect(Math.abs(wrapDeg(cat.raan[i] / DEG - sunRa - 90))).toBeLessThan(9);
    }
  });

  it("stays locked to the terminator over a year of J2 precession", () => {
    const orbits = j2OrbitsFromCatalog(cat);
    const t = epochMs + 365.2422 * 86400_000;
    const sunDrift = wrapDeg(sunRightAscensionDeg(t) - sunRightAscensionDeg(epochMs));
    for (let i = 0; i < cat.count; i += 251) {
      const nodeDrift = (orbits.raanDot[i] * (t - epochMs) / 60000) / DEG;
      // Compare after a full year: within a year the true Sun's RA runs up to
      // ~8° ahead of / behind the mean Sun (equation of time), as for any SSO.
      expect(Math.abs(wrapDeg(nodeDrift - sunDrift))).toBeLessThan(0.5);
    }
  });
});
