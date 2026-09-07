/**
 * Stage 1b: coarse numeric screening.
 *
 * Candidates arrive from the analytic sizing stage in the thousands, so the
 * screen has to cost single-digit milliseconds: a 5° grid (~1 650 points),
 * 8 dithered time steps, the spherical predicate, and circular Keplerian
 * positions instead of SGP4. It is used only to *order* candidates and to find
 * the smallest `T` worth verifying — never to report coverage to the user.
 *
 * The spherical predicate is pessimistic relative to the WGS-84 elevation
 * predicate at LEO, and the coarse grid is optimistic about small holes, so the
 * gate applied to `foldAvailability` here is relaxed by
 * `SCREEN_THRESHOLD_MARGIN` (see `enumerate.ts`).
 */
import {
  accumulateCoverage,
  createKernelSample,
  buildRegionGrid,
  INVALID_SUB_LATITUDE_RAD,
  type CoverageStats,
  type KernelSample,
  type KernelSampler,
} from "./coverageKernel";
import { candidateGeometry } from "./geometry";
import type { CandidateParameters, ScreenMetrics } from "./types";

/** Earth rotation rate, rad/s. Matches `linkGeometry.ts::EARTH_ROTATION_RAD_PER_SEC`. */
export const EARTH_ROTATION_RAD_PER_SEC = 7.29211514670698e-5;

const DEG = Math.PI / 180;

export const SCREEN_GRID_STEP_DEG = 5;
export const SCREEN_TIME_STEPS = 8;

/**
 * A reusable analytic sampler: circular Keplerian motion in ECI, rotated into
 * ECF by the Earth rotation angle accumulated over the sample window.
 *
 * The absolute GMST at t = 0 is irrelevant for a statistical coverage measure
 * (the grid is rotationally symmetric in longitude to within its own spacing),
 * so it is taken as zero. Verification uses real GMST via SGP4.
 */
export interface AnalyticSampler {
  sample: KernelSample;
  sampleAt: KernelSampler;
  orbitalPeriodSec: number;
  /** `T_orb / S` — the fast-path window length. */
  fastWindowSec: number;
  satelliteCount: number;
}

export function createAnalyticSampler(parameters: CandidateParameters): AnalyticSampler {
  const geom = candidateGeometry(parameters);
  const n = geom.count;
  const a = geom.semiMajorAxisKm;
  const incRad = parameters.inclinationDeg * DEG;
  const cosInc = Math.cos(incRad);
  const sinInc = Math.sin(incRad);

  const cosRaan = new Float64Array(n);
  const sinRaan = new Float64Array(n);
  const u0Rad = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const raan = geom.raanDeg[i] * DEG;
    cosRaan[i] = Math.cos(raan);
    sinRaan[i] = Math.sin(raan);
    // Circular orbit with argp = 0: argument of latitude equals mean anomaly.
    u0Rad[i] = geom.meanAnomalyDeg[i] * DEG;
  }

  const sample = createKernelSample(n);
  const meanMotion = geom.meanMotionRadPerSec;

  const sampleAt: KernelSampler = (_stepIndex, timeSec, out) => {
    const g = EARTH_ROTATION_RAD_PER_SEC * timeSec;
    const cosG = Math.cos(g);
    const sinG = Math.sin(g);
    const pos = out.positionsEcf;
    const subLat = out.subLatRad;
    for (let i = 0; i < n; i++) {
      const u = u0Rad[i] + meanMotion * timeSec;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);
      const xEci = a * (cosRaan[i] * cosU - sinRaan[i] * sinU * cosInc);
      const yEci = a * (sinRaan[i] * cosU + cosRaan[i] * sinU * cosInc);
      const zEci = a * (sinU * sinInc);
      pos[i * 3] = xEci * cosG + yEci * sinG;
      pos[i * 3 + 1] = -xEci * sinG + yEci * cosG;
      pos[i * 3 + 2] = zEci;
      const sz = sinU * sinInc;
      subLat[i] = Number.isFinite(sz) ? Math.asin(Math.max(-1, Math.min(1, sz))) : INVALID_SUB_LATITUDE_RAD;
    }
  };

  return {
    sample,
    sampleAt,
    orbitalPeriodSec: geom.orbitalPeriodSec,
    fastWindowSec: geom.orbitalPeriodSec / Math.max(1, parameters.satsPerPlane),
    satelliteCount: n,
  };
}

export interface ScreenOptions {
  centralAngleRad: number;
  minElevationRad: number;
  fold: number;
  latMinDeg: number;
  latMaxDeg: number;
  gridStepDeg?: number;
  timeSteps?: number;
  predicate?: "spherical" | "ellipsoid";
  /** Overrides the automatic fast-path window. */
  windowSec?: number;
  /** Overrides the automatic dither decision. */
  ditherLongitude?: boolean;
  disableBanding?: boolean;
}

/**
 * Runs the coverage kernel over one candidate with the given fidelity. Shared by
 * `screenCandidate` and by the tests that compare predicates or window lengths
 * on identical analytic positions.
 */
export function runAnalyticCoverage(
  parameters: CandidateParameters,
  opts: ScreenOptions,
): CoverageStats {
  const sampler = createAnalyticSampler(parameters);
  const grid = buildRegionGrid(
    opts.latMinDeg,
    opts.latMaxDeg,
    opts.gridStepDeg ?? SCREEN_GRID_STEP_DEG,
  );
  const useFastPath = parameters.kernelFastPath;
  const windowSec = opts.windowSec ?? (useFastPath ? sampler.fastWindowSec : sampler.orbitalPeriodSec);
  return accumulateCoverage(grid, sampler.sample, sampler.sampleAt, {
    centralAngleRad: opts.centralAngleRad,
    minElevationRad: opts.minElevationRad,
    fold: opts.fold,
    predicate: opts.predicate ?? "spherical",
    timeSteps: opts.timeSteps ?? SCREEN_TIME_STEPS,
    windowSec,
    ditherLongitude: opts.ditherLongitude ?? useFastPath,
    disableBanding: opts.disableBanding,
  });
}

export function screenCandidate(
  parameters: CandidateParameters,
  opts: ScreenOptions,
): ScreenMetrics {
  const stats = runAnalyticCoverage(parameters, opts);
  return {
    minFold: stats.minFold,
    meanFold: stats.meanFold,
    foldAvailability: stats.foldAvailability,
    testCount: stats.testCount,
  };
}
