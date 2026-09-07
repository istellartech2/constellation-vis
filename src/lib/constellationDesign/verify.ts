/**
 * Stage 2: numeric verification with SGP4.
 *
 * Deliberately free of any Worker/DOM dependency so it is unit-testable and can
 * also be driven from a script. Propagation follows the same discipline as
 * `src/lib/isl/propagate.ts`: `gstime` once per step (not once per satellite),
 * the ECI→ECF rotation inlined into a preallocated buffer, and a failed
 * propagation flagged rather than substituted with a {0,0,0} position.
 *
 * Two independent passes, because they measure different things:
 *  - the *area* pass answers "what fraction of (point, time) pairs meet the fold
 *    requirement", and may use the `T_orb/S` fast window with the longitude
 *    dither, since it is a statistical measure;
 *  - the *gap* pass answers "how long does one fixed point stay uncovered", which
 *    is only meaningful in real, undithered time — so it runs over ~110 fixed
 *    points for 24 h at a 60 s step.
 */
import * as satellite from "satellite.js";
import { toSatrec, type SatelliteSpec } from "../satellites";
import {
  accumulateCoverage,
  accumulateGaps,
  buildGapPointSet,
  buildRegionGrid,
  createKernelSample,
  INVALID_SUB_LATITUDE_RAD,
  type KernelSample,
  type KernelSampler,
} from "./coverageKernel";
import { candidateSatelliteSpecs } from "./geometry";
import type { AnalyticMetrics, CandidateParameters, VerifiedMetrics } from "./types";

const DEG = Math.PI / 180;

export const VERIFY_GRID_STEP_DEG = 2;
export const VERIFY_TIME_STEPS = 32;
export const VERIFY_HIGH_GRID_STEP_DEG = 1;
export const VERIFY_HIGH_TIME_STEPS = 96;
export const GAP_WINDOW_SEC = 86400;
export const GAP_STEP_SEC = 60;

export interface Sgp4Sampler {
  sample: KernelSample;
  sampleAt: KernelSampler;
  satelliteCount: number;
}

/**
 * Builds satrecs once per candidate (they are the expensive part of
 * `satellite.js` setup) and returns a sampler that reuses one buffer for every
 * step.
 */
export function createSgp4Sampler(parameters: CandidateParameters, epoch: Date): Sgp4Sampler {
  return createSgp4SamplerFromSpecs(candidateSatelliteSpecs(parameters, epoch), epoch);
}

/**
 * Same sampler over an arbitrary satellite list. Used by the shell round-trip
 * test, which has to measure the coverage of the satellites
 * `buildConstellation` actually produced rather than of the candidate the
 * optimizer believed it had.
 */
export function createSgp4SamplerFromSpecs(specs: SatelliteSpec[], epoch: Date): Sgp4Sampler {
  const satRecs = specs.map(toSatrec);
  const n = satRecs.length;
  const sample = createKernelSample(n);
  const epochMs = epoch.getTime();
  const scratch = new Date(epochMs);

  const sampleAt: KernelSampler = (_stepIndex, timeSec, out) => {
    scratch.setTime(epochMs + timeSec * 1000);
    const gmst = satellite.gstime(scratch);
    const cosG = Math.cos(gmst);
    const sinG = Math.sin(gmst);
    const pos = out.positionsEcf;
    const subLat = out.subLatRad;
    for (let i = 0; i < n; i++) {
      const pv = satellite.propagate(satRecs[i], scratch);
      const p = pv?.position;
      if (!p || typeof p === "boolean") {
        subLat[i] = INVALID_SUB_LATITUDE_RAD;
        continue;
      }
      const xf = p.x * cosG + p.y * sinG;
      const yf = -p.x * sinG + p.y * cosG;
      const zf = p.z;
      pos[i * 3] = xf;
      pos[i * 3 + 1] = yf;
      pos[i * 3 + 2] = zf;
      const r = Math.sqrt(xf * xf + yf * yf + zf * zf);
      subLat[i] = r > 0 ? Math.asin(Math.max(-1, Math.min(1, zf / r))) : INVALID_SUB_LATITUDE_RAD;
    }
  };

  return { sample, sampleAt, satelliteCount: n };
}

export interface VerifyOptions {
  epoch: Date;
  minElevationDeg: number;
  fold: number;
  latMinDeg: number;
  latMaxDeg: number;
  fidelity?: "standard" | "high";
  /** Overrides derived from `fidelity`; mostly for tests. */
  gridStepDeg?: number;
  timeSteps?: number;
  windowSec?: number;
  ditherLongitude?: boolean;
  /** Outage-gap pass controls. Set `skipGaps` to trade the ~1 s/candidate cost. */
  gapWindowSec?: number;
  gapStepSec?: number;
  skipGaps?: boolean;
}

export interface VerifyFidelitySettings {
  gridStepDeg: number;
  timeSteps: number;
  windowSec: number;
  ditherLongitude: boolean;
}

/**
 * Resolves the sampling settings. `"high"` gives up the fast window entirely
 * (full orbital period, 96 steps, no dither) so a final answer never rests on
 * the dither being statistically adequate.
 */
export function resolveVerifyFidelity(
  parameters: CandidateParameters,
  analytic: AnalyticMetrics,
  opts: VerifyOptions,
): VerifyFidelitySettings {
  const high = opts.fidelity === "high";
  const period = analytic.orbitalPeriodSec;
  const fastWindow = period / Math.max(1, parameters.satsPerPlane);
  const useFast = parameters.kernelFastPath && !high;
  return {
    gridStepDeg: opts.gridStepDeg ?? (high ? VERIFY_HIGH_GRID_STEP_DEG : VERIFY_GRID_STEP_DEG),
    timeSteps: opts.timeSteps ?? (high ? VERIFY_HIGH_TIME_STEPS : VERIFY_TIME_STEPS),
    windowSec: opts.windowSec ?? (useFast ? fastWindow : period),
    ditherLongitude: opts.ditherLongitude ?? useFast,
  };
}

export function verifyCandidate(
  parameters: CandidateParameters,
  analytic: AnalyticMetrics,
  opts: VerifyOptions,
): VerifiedMetrics {
  const settings = resolveVerifyFidelity(parameters, analytic, opts);
  const sampler = createSgp4Sampler(parameters, opts.epoch);
  const grid = buildRegionGrid(opts.latMinDeg, opts.latMaxDeg, settings.gridStepDeg);

  const stats = accumulateCoverage(grid, sampler.sample, sampler.sampleAt, {
    centralAngleRad: analytic.centralAngleDeg * DEG,
    minElevationRad: opts.minElevationDeg * DEG,
    fold: opts.fold,
    predicate: "ellipsoid",
    timeSteps: settings.timeSteps,
    windowSec: settings.windowSec,
    ditherLongitude: settings.ditherLongitude,
  });

  let maxGapSec = 0;
  let meanGapSec = 0;
  let gapCount = 0;
  if (!opts.skipGaps) {
    const gapWindowSec = opts.gapWindowSec ?? GAP_WINDOW_SEC;
    const gapStepSec = opts.gapStepSec ?? GAP_STEP_SEC;
    const points = buildGapPointSet(opts.latMinDeg, opts.latMaxDeg);
    const gaps = accumulateGaps(points, sampler.sample, sampler.sampleAt, {
      minElevationRad: opts.minElevationDeg * DEG,
      fold: opts.fold,
      timeSteps: Math.max(1, Math.round(gapWindowSec / gapStepSec)),
      windowSec: gapWindowSec,
    });
    maxGapSec = gaps.maxGapSec;
    meanGapSec = gaps.meanGapSec;
    gapCount = gaps.gapCount;
  }

  return {
    minFold: stats.minFold,
    meanFold: stats.meanFold,
    foldAvailability: stats.foldAvailability,
    worstLatitudeDeg: stats.worstLatitudeDeg,
    maxGapSec,
    meanGapSec,
    gapCount,
    perLatitude: stats.perLatitude,
    gridStepDeg: settings.gridStepDeg,
    timeSteps: settings.timeSteps,
    windowSec: settings.windowSec,
    ditherApplied: settings.ditherLongitude,
    predicate: "ellipsoid",
    minFoldIsResolutionSensitive: true,
  };
}
