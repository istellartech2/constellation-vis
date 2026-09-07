import { describe, it, expect } from "bun:test";
import {
  EARTH_RADIUS_KM,
  SPEED_OF_LIGHT_KM_PER_SEC,
  bandAreaFraction,
  capAreaLowerBoundCount,
  coverageCapFraction,
  degToRad,
  designStreetsOfCoverage,
  earthCentralAngleDeg,
  earthCentralAngleRad,
  footprintRadiusKm,
  maxNadirAngleRad,
  nadirLatencyMs,
  oneWayLatencyMs,
  orbitalPeriodSec,
  radToDeg,
  slantRangeAtElevationKm,
  streetHalfWidthRad,
} from "../src/lib/constellationPatterns/coverageGeometry";

describe("earthCentralAngleDeg — reference table", () => {
  const cases: Array<[number, number, number]> = [
    [550, 25, 8.451],
    [550, 10, 14.957],
    [780, 8.2, 19.925],
    [1200, 10, 24.018],
    [20200, 5, 71.169],
  ];
  for (const [altitudeKm, minElevationDeg, expected] of cases) {
    it(`θ(${altitudeKm} km, ${minElevationDeg}°) = ${expected}°`, () => {
      expect(earthCentralAngleDeg(altitudeKm, minElevationDeg)).toBeCloseTo(expected, 3);
    });
  }

  it("satisfies θ + ε + η = 90° at every altitude", () => {
    for (const altitudeKm of [200, 550, 780, 1200, 8000, 20200, 35786]) {
      for (const epsDeg of [0, 5, 8.2, 10, 25, 40]) {
        const epsRad = degToRad(epsDeg);
        const sum =
          earthCentralAngleRad(altitudeKm, epsRad) + epsRad + maxNadirAngleRad(altitudeKm, epsRad);
        expect(radToDeg(sum)).toBeCloseTo(90, 9);
      }
    }
  });

  it("grows with altitude and shrinks with elevation", () => {
    expect(earthCentralAngleDeg(1200, 10)).toBeGreaterThan(earthCentralAngleDeg(550, 10));
    expect(earthCentralAngleDeg(550, 25)).toBeLessThan(earthCentralAngleDeg(550, 10));
  });

  it("clamps a negative elevation to the horizon and rejects a non-positive altitude", () => {
    expect(earthCentralAngleRad(550, -0.2)).toBe(earthCentralAngleRad(550, 0));
    expect(() => earthCentralAngleRad(0, degToRad(10))).toThrow();
    expect(() => earthCentralAngleRad(-100, degToRad(10))).toThrow();
  });
});

describe("footprint, slant range and latency", () => {
  it("gives a 2218 km footprint radius for Iridium's geometry", () => {
    expect(footprintRadiusKm(780, degToRad(8.2))).toBeCloseTo(2218, 0);
  });

  it("gives a 2464.6 km slant range for Iridium's geometry", () => {
    expect(slantRangeAtElevationKm(780, degToRad(8.2))).toBeCloseTo(2464.6, 1);
  });

  it("agrees with the law of cosines on the observer–centre–satellite triangle", () => {
    // The angle at the observer between the local zenith-complement (the local
    // horizontal, at 90° + ε from the outward radius) and the satellite gives
    //   (Re + h)² = Re² + d² + 2·Re·d·sin ε
    for (const altitudeKm of [400, 780, 1200, 20200]) {
      for (const epsDeg of [0, 5, 8.2, 25]) {
        const epsRad = degToRad(epsDeg);
        const d = slantRangeAtElevationKm(altitudeKm, epsRad);
        const lhs = (EARTH_RADIUS_KM + altitudeKm) ** 2;
        const rhs =
          EARTH_RADIUS_KM ** 2 + d * d + 2 * EARTH_RADIUS_KM * d * Math.sin(epsRad);
        expect(rhs / lhs).toBeCloseTo(1, 10);
      }
    }
  });

  it("reduces to the altitude at zenith", () => {
    expect(slantRangeAtElevationKm(780, degToRad(90))).toBeCloseTo(780, 6);
    expect(nadirLatencyMs(780)).toBeCloseTo((780 / SPEED_OF_LIGHT_KM_PER_SEC) * 1000, 12);
  });

  it("converts range to one-way delay", () => {
    expect(oneWayLatencyMs(slantRangeAtElevationKm(780, degToRad(8.2)))).toBeCloseTo(8.221, 3);
    expect(oneWayLatencyMs(299_792.458)).toBeCloseTo(1000, 9);
  });
});

describe("streetHalfWidthRad", () => {
  it("gives 11.527° for Iridium (θ = 19.925°, S = 11)", () => {
    const theta = earthCentralAngleRad(780, degToRad(8.2));
    const c1 = streetHalfWidthRad(theta, 11);
    expect(c1).not.toBeNull();
    expect(radToDeg(c1!)).toBeCloseTo(11.527, 3);
    expect(c1!).toBeLessThan(theta);
  });

  it("is null when the in-plane spacing exceeds the coverage circle", () => {
    const theta = earthCentralAngleRad(780, degToRad(8.2));
    expect(streetHalfWidthRad(theta, 1)).toBeNull();
    expect(streetHalfWidthRad(theta, 2)).toBeNull();
    // θ = 19.925° needs π/S < θ, i.e. S ≥ 10.
    expect(streetHalfWidthRad(theta, 9)).toBeNull();
    expect(streetHalfWidthRad(theta, 10)).not.toBeNull();
  });

  it("is null for a 4-fold street the plane cannot support", () => {
    const theta = earthCentralAngleRad(550, degToRad(25));
    // θ = 8.451° = 0.1475 rad, so even single coverage needs π/S < θ ⟹ S ≥ 22;
    // 4-fold would need S ≥ 86, well past `DEFAULT_MAX_SATS_PER_PLANE`.
    expect(streetHalfWidthRad(theta, 20, 4)).toBeNull();
    expect(streetHalfWidthRad(theta, 20, 1)).toBeNull();
    expect(streetHalfWidthRad(theta, 30, 1)).not.toBeNull();
    expect(streetHalfWidthRad(theta, 30, 4)).toBeNull();
  });

  it("narrows as the required fold rises", () => {
    const theta = earthCentralAngleRad(780, degToRad(8.2));
    const c1 = streetHalfWidthRad(theta, 40, 1)!;
    const c2 = streetHalfWidthRad(theta, 40, 2)!;
    const c3 = streetHalfWidthRad(theta, 40, 3)!;
    expect(c1).toBeGreaterThan(c2);
    expect(c2).toBeGreaterThan(c3);
  });

  it("rejects non-positive inputs", () => {
    expect(streetHalfWidthRad(0.3, 0)).toBeNull();
    expect(streetHalfWidthRad(0.3, 11, 0)).toBeNull();
  });
});

describe("area fractions and the cap-area lower bound", () => {
  it("covers the whole sphere for a 90° cap and a full latitude band", () => {
    expect(coverageCapFraction(Math.PI / 2)).toBeCloseTo(0.5, 12);
    expect(coverageCapFraction(Math.PI)).toBeCloseTo(1, 12);
    expect(bandAreaFraction(-90, 90)).toBeCloseTo(1, 12);
    expect(bandAreaFraction(0, 90)).toBeCloseTo(0.5, 12);
    expect(bandAreaFraction(-60, 60)).toBeCloseTo(Math.sin(degToRad(60)), 12);
  });

  it("is order-insensitive in its latitude arguments", () => {
    expect(bandAreaFraction(60, 30)).toBeCloseTo(bandAreaFraction(30, 60), 15);
  });

  const bounds: Array<[number, number, number]> = [
    [550, 25, 185],
    [550, 10, 60],
    [780, 5, 27],
  ];
  for (const [altitudeKm, minElevationDeg, expected] of bounds) {
    it(`bounds a global 1-fold constellation at ${expected} satellites (${altitudeKm} km / ${minElevationDeg}°)`, () => {
      const theta = earthCentralAngleRad(altitudeKm, degToRad(minElevationDeg));
      expect(capAreaLowerBoundCount(1, theta, 1)).toBe(expected);
    });
  }

  it("scales with fold and shrinks with the region", () => {
    const theta = earthCentralAngleRad(550, degToRad(25));
    expect(capAreaLowerBoundCount(1, theta, 2)).toBe(2 * 185 - 1);
    expect(capAreaLowerBoundCount(bandAreaFraction(-60, 60), theta, 1)).toBeLessThan(185);
  });

  it("is infinite for a degenerate coverage circle", () => {
    expect(capAreaLowerBoundCount(1, 0, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("orbitalPeriodSec", () => {
  it("matches known circular periods", () => {
    expect(orbitalPeriodSec(550)).toBeCloseTo(5739, 0);
    expect(orbitalPeriodSec(780)).toBeCloseTo(6027, 0);
    expect(orbitalPeriodSec(20200)).toBeCloseTo(43122, 0);
  });
});

describe("designStreetsOfCoverage — Iridium reference", () => {
  it("reproduces P = 6, T = 66, Δco = 31.389°, Δseam = 23.054°, ω = 16.364°", () => {
    const design = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      fold: 1,
      targetLatitudeDeg: 0,
      satsPerPlane: 11,
      spacingSafetyFactor: 1,
    });
    expect(design.feasible).toBe(true);
    expect(design.planes).toBe(6);
    expect(design.count).toBe(66);
    expect(design.thetaDeg).toBeCloseTo(19.925, 3);
    expect(design.c1Deg).toBeCloseTo(11.527, 3);
    expect(design.deltaCoDeg).toBeCloseTo(31.389, 3);
    expect(design.deltaSeamDeg).toBeCloseTo(23.054, 3);
    expect(design.omegaDeg).toBeCloseTo(16.3636, 4);
    // λ = 0, n = 1 always needs exactly a half plane of RAAN.
    expect(design.spanDeg).toBeCloseTo(180, 9);
    // (P-1)·Δco + Δseam must tile the span exactly.
    expect((design.planes - 1) * design.deltaCoDeg + design.deltaSeamDeg).toBeCloseTo(180, 9);
  });

  it("needs a seventh plane once the spacing safety factor bites", () => {
    // Documented consequence of the plan's 0.98 default: the achievable span
    // (P-1)(θ+c_n)·0.98 + Δseam no longer reaches 180° at P = 6. This is why
    // the optimizer's own default is 1 — see `constellationDesign/types.ts`.
    const design = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      fold: 1,
      targetLatitudeDeg: 0,
      satsPerPlane: 11,
      spacingSafetyFactor: 0.98,
    });
    expect(design.planes).toBe(7);
    expect(design.count).toBe(77);
    expect(design.deltaSeamDeg).toBeCloseTo(23.054, 3);
    expect(design.deltaCoDeg).toBeCloseTo(26.158, 3);
  });

  it("reports infeasible instead of throwing when a plane cannot form a street", () => {
    const design = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      fold: 1,
      targetLatitudeDeg: 0,
      satsPerPlane: 4,
    });
    expect(design.feasible).toBe(false);
    expect(design.planes).toBe(0);
    expect(design.warnings.some((w) => w.code === "infeasible_coverage")).toBe(true);
  });

  it("needs more planes for a higher target latitude only through the span", () => {
    const equator = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      satsPerPlane: 11,
      targetLatitudeDeg: 0,
      spacingSafetyFactor: 1,
    });
    const midLatitude = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      satsPerPlane: 11,
      targetLatitudeDeg: 45,
      spacingSafetyFactor: 1,
    });
    expect(midLatitude.spanDeg).toBeLessThan(equator.spanDeg);
    expect(midLatitude.planes).toBeLessThanOrEqual(equator.planes);
  });
});
