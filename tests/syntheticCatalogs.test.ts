import { describe, expect, it } from "bun:test";
import { j2OrbitsFromCatalog, j2StateAt } from "../src/lib/j2Propagator";
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

describe("Starmind spread", () => {
  const epochMs = Date.UTC(2026, 9, 30);
  const cat = syntheticCatalog("starmind", 100_000, epochMs);
  const orbits = j2OrbitsFromCatalog(cat);

  it("does not lay satellites on an aligned lattice (no stripes)", () => {
    // Aligned slots repeat a handful of mean-anomaly values; random plane
    // phases should fill fine bins almost uniformly.
    const bins = 720;
    const ma = new Uint32Array(bins);
    for (let i = 0; i < cat.count; i++) ma[Math.floor((cat.meanAnomaly[i] / DEG / 360) * bins) % bins]++;
    const mean = cat.count / bins;
    expect(Math.min(...ma)).toBeGreaterThan(mean * 0.6);
    expect(Math.max(...ma)).toBeLessThan(mean * 1.4);
  });

  it("gives every plane its own circular orbit radius", () => {
    // One radius ↔ one plane (node, inclination); different planes never share a radius.
    const planeOf = new Map<number, string>();
    let mismatches = 0;
    for (let i = 0; i < cat.count; i++) {
      if (cat.eccentricity[i] !== 0) mismatches++;
      const key = `${cat.raan[i]},${cat.inclination[i]}`;
      const prev = planeOf.get(orbits.semiMajorAxisKm[i]);
      if (prev === undefined) planeOf.set(orbits.semiMajorAxisKm[i], key);
      else if (prev !== key) mismatches++;
    }
    expect(mismatches).toBe(0);
    const radii = [...planeOf.keys()].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let k = 1; k < radii.length; k++) minGap = Math.min(minGap, radii[k] - radii[k - 1]);
    expect(minGap).toBeGreaterThan(1);
  });

  it("keeps every pair of satellites apart over a day", () => {
    const pos = new Float64Array(cat.count * 3);
    for (const dtMin of [0, 97, 1440]) {
      const t = epochMs + dtMin * 60_000;
      for (let i = 0; i < cat.count; i++) j2StateAt(orbits, i, t, pos, i * 3);
      const cell = 20;
      const grid = new Map<string, number[]>();
      const keyOf = (i: number, dx = 0, dy = 0, dz = 0) =>
        `${Math.floor(pos[i * 3] / cell) + dx},${Math.floor(pos[i * 3 + 1] / cell) + dy},${Math.floor(pos[i * 3 + 2] / cell) + dz}`;
      for (let i = 0; i < cat.count; i++) {
        const k = keyOf(i);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
      let minD = Infinity;
      for (let i = 0; i < cat.count; i++) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(keyOf(i, dx, dy, dz)) ?? []) {
            if (j <= i) continue;
            minD = Math.min(minD, Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]));
          }
        }
      }
      expect(minD).toBeGreaterThan(1);
    }
  });

  it("is reproducible", () => {
    const again = syntheticCatalog("starmind", 100_000, epochMs);
    expect(Array.from(again.raan.subarray(0, 50))).toEqual(Array.from(cat.raan.subarray(0, 50)));
    expect(Array.from(again.meanAnomaly.subarray(0, 50))).toEqual(Array.from(cat.meanAnomaly.subarray(0, 50)));
  });
});
