import { describe, it, expect } from "bun:test";
import {
  accumulateCoverage,
  buildGapPointSet,
  buildRegionGrid,
  createKernelSample,
  INVALID_SUB_LATITUDE_RAD,
  resetCoverageKernelScratch,
} from "../src/lib/constellationDesign/coverageKernel";
import { candidateGeometry } from "../src/lib/constellationDesign/geometry";
import { createAnalyticSampler, runAnalyticCoverage } from "../src/lib/constellationDesign/screen";
import type { CandidateParameters } from "../src/lib/constellationDesign/types";

const DEG = Math.PI / 180;

/**
 * Earth central angle θ, degrees. Pinned as literals rather than recomputed so
 * this spec stays independent of `constellationPatterns/coverageGeometry.ts`
 * (whose own reference table lives in `tests/coverageGeometry.test.ts`).
 */
const THETA = {
  h550e25: 8.4508216592,
  h780e5: 22.4215229844,
  h780e82: 19.9247424701,
  h1200e10: 24.0178639313,
  h20200e5: 71.1687175679,
} as const;

function iridium(overrides: Partial<CandidateParameters> = {}): CandidateParameters {
  return {
    family: "walkerStar",
    totalSatellites: 66,
    planes: 6,
    satsPerPlane: 11,
    phasingF: 3,
    altitudeKm: 780,
    inclinationDeg: 86.4,
    deltaCoDeg: 31.389,
    seamGapDeg: 23.054,
    raanSpanDeg: 180,
    kernelFastPath: true,
    ...overrides,
  };
}

const GPS: CandidateParameters = {
  family: "walkerDelta",
  totalSatellites: 24,
  planes: 3,
  satsPerPlane: 8,
  phasingF: 1,
  altitudeKm: 20200,
  inclinationDeg: 55,
  kernelFastPath: true,
};

const STARLINK_SHELL: CandidateParameters = {
  family: "walkerDelta",
  totalSatellites: 600,
  planes: 20,
  satsPerPlane: 30,
  phasingF: 1,
  altitudeKm: 550,
  inclinationDeg: 53,
  kernelFastPath: true,
};

describe("buildRegionGrid", () => {
  it("builds a near-equal-area grid with ascending rows", () => {
    const grid = buildRegionGrid(-90, 90, 2);
    expect(grid.rowCount).toBe(91);
    // A naive 2° lat/lon grid would be 91 * 180 = 16 380 points; the cos-weighted
    // row widths cut that to ~10 300 without thinning the equator.
    expect(grid.pointCount).toBeGreaterThan(9000);
    expect(grid.pointCount).toBeLessThan(11000);
    for (let r = 1; r < grid.rowCount; r++) {
      expect(grid.rowLatDeg[r]).toBeGreaterThan(grid.rowLatDeg[r - 1]);
      expect(grid.rowLatRad[r]).toBeGreaterThan(grid.rowLatRad[r - 1]);
    }
    expect(grid.rowLatDeg[0]).toBe(-90);
    expect(grid.rowLatDeg[grid.rowCount - 1]).toBe(90);
    // Row offsets must tile the point arrays exactly.
    let expected = 0;
    for (let r = 0; r < grid.rowCount; r++) {
      expect(grid.rowStart[r]).toBe(expected);
      expected += grid.rowLen[r];
    }
    expect(expected).toBe(grid.pointCount);
  });

  it("places every point on the WGS-84 surface with a unit geodetic up", () => {
    const grid = buildRegionGrid(-90, 90, 10);
    for (let i = 0; i < grid.pointCount; i++) {
      const r = Math.hypot(grid.px[i], grid.py[i], grid.pz[i]);
      expect(r).toBeGreaterThan(6356);
      expect(r).toBeLessThan(6379);
      expect(Math.hypot(grid.ux[i], grid.uy[i], grid.uz[i])).toBeCloseTo(1, 12);
      expect(Math.hypot(grid.cx[i], grid.cy[i], grid.cz[i])).toBeCloseTo(1, 12);
    }
  });

  it("returns the same memoized instance for the same spec", () => {
    expect(buildRegionGrid(-90, 90, 4)).toBe(buildRegionGrid(-90, 90, 4));
  });

  it("gives identical results whether the grid and scratch buffers are cold or warm", () => {
    // The memoized grid and the module-level scratch arrays are shared across
    // thousands of candidates; a run must not depend on what ran before it.
    const opts = {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 5,
      timeSteps: 8,
    } as const;
    const warm = runAnalyticCoverage(iridium(), opts);
    resetCoverageKernelScratch();
    const cold = runAnalyticCoverage(iridium(), opts);
    expect(cold.meanFold).toBe(warm.meanFold);
    expect(cold.foldAvailability).toBe(warm.foldAvailability);
    expect(cold.minFold).toBe(warm.minFold);
    expect(cold.testCount).toBe(warm.testCount);
  });

  it("restricts a latitude band and reports rows in geodetic degrees", () => {
    const grid = buildRegionGrid(30, 90, 5);
    expect(grid.rowLatDeg[0]).toBe(30);
    expect(grid.rowLatDeg[grid.rowCount - 1]).toBe(90);
    for (let r = 0; r < grid.rowCount; r++) {
      expect(grid.rowLatDeg[r]).toBeGreaterThanOrEqual(30);
    }
    const stats = runAnalyticCoverage(iridium(), {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      latMinDeg: 30,
      latMaxDeg: 90,
      gridStepDeg: 5,
      timeSteps: 8,
    });
    expect(stats.perLatitude).toHaveLength(grid.rowCount);
    for (let r = 0; r < grid.rowCount; r++) {
      expect(stats.perLatitude[r].latitudeDeg).toBe(grid.rowLatDeg[r]);
    }
    expect(stats.foldAvailability).toBe(1);
  });
});

describe("accumulateCoverage — reference constellations", () => {
  it("reproduces GPS 24/3/1 four-fold coverage at 5° elevation", () => {
    const stats = runAnalyticCoverage(GPS, {
      centralAngleRad: THETA.h20200e5 * DEG,
      minElevationRad: 5 * DEG,
      fold: 4,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 3,
      timeSteps: 32,
    });
    // Expected mean fold for a uniform 24-satellite shell is
    // T * (1 - cos θ)/2 = 24 * 0.33857 = 8.126.
    expect(stats.meanFold).toBeGreaterThan(8.13 - 0.3);
    expect(stats.meanFold).toBeLessThan(8.13 + 0.3);
    expect(stats.minFold).toBeGreaterThanOrEqual(4);
    expect(stats.foldAvailability).toBe(1);
  });

  it("gives Iridium continuous single coverage at 5° and ≥0.999 at 8.2°", () => {
    const at5 = runAnalyticCoverage(iridium(), {
      centralAngleRad: THETA.h780e5 * DEG,
      minElevationRad: 5 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 2,
      timeSteps: 32,
    });
    expect(at5.foldAvailability).toBe(1);
    expect(at5.minFold).toBeGreaterThanOrEqual(1);

    const at82 = runAnalyticCoverage(iridium(), {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 2,
      timeSteps: 32,
    });
    // `minFold` is deliberately not asserted here: it is the minimum over the
    // sampled (point, time) grid, so it flips to 0 as soon as the grid is
    // refined past the design margin (the 1° / 96-step run does exactly that).
    expect(at82.foldAvailability).toBeGreaterThanOrEqual(0.999);
  });

  it("rejects naive uniform 30° plane spacing for the same 66 satellites", () => {
    const uniform = runAnalyticCoverage(iridium({ deltaCoDeg: 30 }), {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 2,
      timeSteps: 32,
    });
    expect(uniform.foldAvailability).toBeLessThan(0.9999);
    expect(uniform.minFold).toBe(0);
  });
});

describe("accumulateCoverage — predicates and sampling", () => {
  it("is pessimistic with the spherical predicate at LEO", () => {
    const configs: Array<[CandidateParameters, number, number]> = [
      [STARLINK_SHELL, 25, THETA.h550e25],
      [iridium(), 8.2, THETA.h780e82],
      [
        {
          family: "walkerDelta",
          totalSatellites: 648,
          planes: 18,
          satsPerPlane: 36,
          phasingF: 1,
          altitudeKm: 1200,
          inclinationDeg: 87.9,
          kernelFastPath: true,
        },
        10,
        THETA.h1200e10,
      ],
    ];
    for (const [parameters, epsDeg, thetaDeg] of configs) {
      const base = {
        centralAngleRad: thetaDeg * DEG,
        minElevationRad: epsDeg * DEG,
        fold: 1,
        latMinDeg: -90,
        latMaxDeg: 90,
        gridStepDeg: 3,
        timeSteps: 8,
      } as const;
      const spherical = runAnalyticCoverage(parameters, { ...base, predicate: "spherical" });
      const ellipsoid = runAnalyticCoverage(parameters, { ...base, predicate: "ellipsoid" });
      // Same analytic positions, so any difference is purely the predicate.
      expect(spherical.meanFold).toBeLessThanOrEqual(ellipsoid.meanFold + 1e-3);
      expect(spherical.foldAvailability).toBeLessThanOrEqual(ellipsoid.foldAvailability + 1e-3);
    }
  });

  it("matches the full-period result from a T_orb/S window", () => {
    const geom = candidateGeometry(STARLINK_SHELL);
    const base = {
      centralAngleRad: THETA.h550e25 * DEG,
      minElevationRad: 25 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 3,
    } as const;
    const fast = runAnalyticCoverage(STARLINK_SHELL, { ...base, timeSteps: 8 });
    const full = runAnalyticCoverage(STARLINK_SHELL, {
      ...base,
      timeSteps: 96,
      windowSec: geom.orbitalPeriodSec,
      ditherLongitude: false,
    });
    expect(Math.abs(fast.meanFold - full.meanFold)).toBeLessThan(0.01);
    expect(Math.abs(fast.foldAvailability - full.foldAvailability)).toBeLessThan(0.005);
  });

  it("tracks the full period with or without the longitude dither, but not identically", () => {
    // The plan predicted the dither would flip Iridium's `minFold` from 1 to 0.
    // It does not on this implementation: over a T_orb/S window the Earth turns
    // only ~2.3°, which a 2° grid already resolves, so the dither's effect is
    // a ~1e-6 shift rather than a new hole. What the fast window does have to
    // earn is agreement with the full period — asserted here for both.
    const parameters = iridium({ deltaCoDeg: 30 });
    const geom = candidateGeometry(parameters);
    const base = {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 2,
    } as const;
    const reference = runAnalyticCoverage(parameters, {
      ...base,
      timeSteps: 384,
      windowSec: geom.orbitalPeriodSec,
      ditherLongitude: false,
    });
    const undithered = runAnalyticCoverage(parameters, {
      ...base,
      timeSteps: 32,
      ditherLongitude: false,
    });
    const dithered = runAnalyticCoverage(parameters, {
      ...base,
      timeSteps: 32,
      ditherLongitude: true,
    });
    expect(undithered.foldAvailability).not.toBe(dithered.foldAvailability);
    expect(Math.abs(undithered.foldAvailability - reference.foldAvailability)).toBeLessThan(1e-4);
    expect(Math.abs(dithered.foldAvailability - reference.foldAvailability)).toBeLessThan(1e-4);
  });

  it("gets identical fold statistics with and without the latitude-band prefilter", () => {
    for (const predicate of ["spherical", "ellipsoid"] as const) {
      const base = {
        centralAngleRad: THETA.h780e82 * DEG,
        minElevationRad: 8.2 * DEG,
        fold: 1,
        latMinDeg: -90,
        latMaxDeg: 90,
        gridStepDeg: 5,
        timeSteps: 4,
        predicate,
      } as const;
      const banded = runAnalyticCoverage(iridium(), base);
      const full = runAnalyticCoverage(iridium(), { ...base, disableBanding: true });
      expect(banded.minFold).toBe(full.minFold);
      expect(banded.meanFold).toBe(full.meanFold);
      expect(banded.foldAvailability).toBe(full.foldAvailability);
      // ...and the prefilter is what makes the kernel affordable.
      expect(banded.testCount).toBeLessThan(full.testCount * 0.5);
    }
  });

  it("handles the degenerate single-satellite shell", () => {
    const one: CandidateParameters = {
      family: "walkerDelta",
      totalSatellites: 1,
      planes: 1,
      satsPerPlane: 1,
      phasingF: 0,
      altitudeKm: 550,
      inclinationDeg: 53,
      kernelFastPath: true,
    };
    const base = {
      centralAngleRad: THETA.h550e25 * DEG,
      minElevationRad: 25 * DEG,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 10,
      timeSteps: 4,
    } as const;
    const single = runAnalyticCoverage(one, { ...base, fold: 1 });
    expect(single.foldAvailability).toBeGreaterThan(0);
    expect(single.foldAvailability).toBeLessThan(0.05);
    const quad = runAnalyticCoverage(one, { ...base, fold: 4 });
    expect(quad.foldAvailability).toBe(0);
    expect(quad.minFold).toBe(0);
  });

  it("drops satellites flagged with the invalid sub-latitude sentinel", () => {
    const grid = buildRegionGrid(-90, 90, 10);
    const sampler = createAnalyticSampler(iridium());
    const sample = createKernelSample(sampler.satelliteCount);
    const opts = {
      centralAngleRad: THETA.h780e82 * DEG,
      minElevationRad: 8.2 * DEG,
      fold: 1,
      predicate: "spherical" as const,
      timeSteps: 4,
      windowSec: sampler.fastWindowSec,
      ditherLongitude: false,
    };
    const good = accumulateCoverage(grid, sample, sampler.sampleAt, opts);
    const allInvalid = accumulateCoverage(
      grid,
      sample,
      (stepIndex, timeSec, out) => {
        sampler.sampleAt(stepIndex, timeSec, out);
        out.subLatRad.fill(INVALID_SUB_LATITUDE_RAD);
      },
      opts,
    );
    expect(good.foldAvailability).toBeGreaterThan(0.9);
    expect(allInvalid.foldAvailability).toBe(0);
    expect(allInvalid.testCount).toBe(0);
  });
});

describe("buildGapPointSet", () => {
  it("covers the region with one row per 5° and three longitudes", () => {
    const set = buildGapPointSet(-90, 90);
    expect(set.count).toBe(37 * 3);
    expect(set.latDeg[0]).toBe(-90);
    expect(set.latDeg[set.count - 1]).toBe(90);
    for (let i = 0; i < set.count; i++) {
      expect(Math.hypot(set.ux[i], set.uy[i], set.uz[i])).toBeCloseTo(1, 12);
    }
  });
});

describe("ellipsoid band margin is an upper bound at low altitude / low elevation", () => {
  it("banded == unbanded for a single satellite at h=350 km, ε=0 (formerly lossy with a 0.5° margin)", () => {
    for (const [h, eps] of [
      [350, 0],
      [300, 3],
      [300, 4],
    ] as const) {
      const theta = Math.acos((6378.137 / (6378.137 + h)) * Math.cos(eps * DEG)) - eps * DEG;
      const one: CandidateParameters = {
        family: "walkerDelta",
        totalSatellites: 1,
        planes: 1,
        satsPerPlane: 1,
        phasingF: 0,
        altitudeKm: h,
        inclinationDeg: 62,
        kernelFastPath: false,
      };
      const base = {
        centralAngleRad: theta,
        minElevationRad: eps * DEG,
        fold: 1,
        latMinDeg: -90,
        latMaxDeg: 90,
        gridStepDeg: 2,
        timeSteps: 12,
        predicate: "ellipsoid",
      } as const;
      const banded = runAnalyticCoverage(one, base);
      const full = runAnalyticCoverage(one, { ...base, disableBanding: true });
      expect(banded.meanFold).toBe(full.meanFold);
      expect(banded.foldAvailability).toBe(full.foldAvailability);
    }
  });
});
