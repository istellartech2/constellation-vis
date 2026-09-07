/**
 * The altitude and inclination grids the enumerator searches over.
 *
 * Not in the original Phase 2 file list: `starSizing.ts` and `deltaSizing.ts`
 * both need the same altitude set (and the same repeat-ground-track
 * quantization of it), and having two copies would mean a Star and a Delta
 * candidate could silently be compared at different altitudes.
 */
import {
  earthCentralAngleDeg,
  EARTH_RADIUS_KM,
} from "../constellationPatterns/coverageGeometry";
import {
  solveAltitudeFromInclinationAndRatio,
  suggestRgtRatioFromAltitudeInclination,
} from "../rgt";
import { regionMaxAbsLatitudeDeg, type DesignConstraints } from "./types";

/** Hard cap on the altitude grid: 24 values keep the search a few seconds, not minutes. */
export const MAX_ALTITUDE_VALUES = 24;
/** Hard cap on the inclination grid for Walker Delta. */
export const MAX_INCLINATION_VALUES = 10;
export const INCLINATION_STEP_DEG = 2.5;

export const RGT_WARNING = "RGT quantized altitudes per inclination";

/** Default step: 20 intervals across the range, but never finer than 25 km. */
export function resolveAltitudeStepKm(constraints: DesignConstraints): number {
  const explicit = constraints.altitudeStepKm;
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  const span = Math.max(0, constraints.altitudeMaxKm - constraints.altitudeMinKm);
  return Math.max(25, span / 20);
}

/** Altitudes in ascending order, inclusive of both ends, capped at `MAX_ALTITUDE_VALUES`. */
export function baseAltitudeSetKm(constraints: DesignConstraints): number[] {
  const lo = Math.min(constraints.altitudeMinKm, constraints.altitudeMaxKm);
  const hi = Math.max(constraints.altitudeMinKm, constraints.altitudeMaxKm);
  if (!(hi > lo)) return [lo];
  const step = resolveAltitudeStepKm(constraints);
  const rawCount = Math.floor((hi - lo) / step) + 1;
  const values: number[] = [];
  if (rawCount <= MAX_ALTITUDE_VALUES) {
    for (let k = 0; k < rawCount; k++) values.push(lo + k * step);
    if (values[values.length - 1] < hi - 1e-9) values.push(hi);
    return values.slice(0, MAX_ALTITUDE_VALUES);
  }
  for (let k = 0; k < MAX_ALTITUDE_VALUES; k++) {
    values.push(lo + (k * (hi - lo)) / (MAX_ALTITUDE_VALUES - 1));
  }
  return values;
}

export interface AltitudeSample {
  altitudeKm: number;
  repeatOrbits?: number;
  repeatDays?: number;
}

/**
 * Altitudes for one inclination. With RGT enabled the free altitude grid is
 * *replaced* by the discrete altitudes that actually close a repeat ground
 * track at that inclination — the whole point of the constraint is that the
 * altitude is no longer free, so offering the requested value would be a lie.
 */
export function altitudeSamplesForInclination(
  constraints: DesignConstraints,
  inclinationDeg: number,
  warnings?: string[],
): AltitudeSample[] {
  const base = baseAltitudeSetKm(constraints);
  if (!constraints.rgt?.enabled) return base.map((altitudeKm) => ({ altitudeKm }));

  const lo = Math.min(constraints.altitudeMinKm, constraints.altitudeMaxKm);
  const hi = Math.max(constraints.altitudeMinKm, constraints.altitudeMaxKm);
  const options = {
    minRepeatDays: constraints.rgt.minRepeatDays,
    maxRepeatDays: constraints.rgt.maxRepeatDays,
    maxRepeatOrbits: constraints.rgt.maxRepeatOrbits,
  };

  const seen = new Set<string>();
  const samples: AltitudeSample[] = [];
  for (const guessKm of base) {
    const ratio = suggestRgtRatioFromAltitudeInclination(guessKm, inclinationDeg, 0, options);
    if (!ratio) continue;
    const ratioKey = `${ratio.repeatOrbits}/${ratio.repeatDays}`;
    if (seen.has(ratioKey)) continue;
    seen.add(ratioKey);
    const solved = solveAltitudeFromInclinationAndRatio(
      guessKm,
      inclinationDeg,
      ratio.repeatOrbits,
      ratio.repeatDays,
      0,
      options,
    );
    if (!solved) continue;
    if (solved.altitudeKm < lo - 1e-6 || solved.altitudeKm > hi + 1e-6) continue;
    samples.push({
      altitudeKm: solved.altitudeKm,
      repeatOrbits: ratio.repeatOrbits,
      repeatDays: ratio.repeatDays,
    });
  }

  samples.sort((a, b) => a.altitudeKm - b.altitudeKm);
  if (warnings && !warnings.includes(RGT_WARNING)) warnings.push(RGT_WARNING);
  return samples;
}

export interface InclinationRange {
  minDeg: number;
  maxDeg: number;
}

/** User inclination limits, clamped to the physically meaningful 0..180°. */
export function resolveInclinationRange(constraints: DesignConstraints): InclinationRange {
  const lo = Math.max(0, constraints.inclinationMinDeg ?? 0);
  const hi = Math.min(180, constraints.inclinationMaxDeg ?? 180);
  return { minDeg: Math.min(lo, hi), maxDeg: Math.max(lo, hi) };
}

/**
 * Inclinations to try for Walker Delta.
 *
 * θ is evaluated at the *highest* altitude in the range (the largest footprint,
 * so the most permissive reachability bound) — an inclination excluded here
 * could never work at any altitude in the range, and prefilter P1 re-checks
 * every (h, i) cell individually anyway.
 */
export function deltaInclinationSetDeg(constraints: DesignConstraints): number[] {
  const range = resolveInclinationRange(constraints);
  const maxAbsLat = regionMaxAbsLatitudeDeg(constraints.region);
  const hi = Math.max(constraints.altitudeMinKm, constraints.altitudeMaxKm);
  const thetaDeg = hi > 0 ? earthCentralAngleDeg(hi, constraints.minElevationDeg) : 0;

  let lo = maxAbsLat - thetaDeg;
  let top = maxAbsLat >= 90 ? 90 : Math.min(maxAbsLat + thetaDeg + 10, 90);
  lo = Math.max(lo, range.minDeg);
  top = Math.min(top, range.maxDeg);
  if (!(top >= lo)) return [];

  const raw: number[] = [];
  for (let i = lo; i <= top + 1e-9; i += INCLINATION_STEP_DEG) raw.push(i);
  if (raw.length === 0) raw.push(lo);
  if (raw[raw.length - 1] < top - 1e-9) raw.push(top);
  if (raw.length <= MAX_INCLINATION_VALUES) return raw;

  const spread: number[] = [];
  for (let k = 0; k < MAX_INCLINATION_VALUES; k++) {
    spread.push(lo + (k * (top - lo)) / (MAX_INCLINATION_VALUES - 1));
  }
  return spread;
}

/**
 * Inclination for the Walker Star / Streets-of-Coverage family, or null when the
 * requested range rules the family out. The seam construction only works for a
 * near-polar orbit, so 90° is preferred, then Iridium's 86.4°, then whatever the
 * range allows above 80°.
 */
export function starInclinationDeg(constraints: DesignConstraints): number | null {
  const { minDeg, maxDeg } = resolveInclinationRange(constraints);
  if (maxDeg <= 80) return null;
  if (minDeg <= 90 && maxDeg >= 90) return 90;
  if (minDeg <= 86.4 && maxDeg >= 86.4) return 86.4;
  return Math.min(Math.max(90, minDeg), maxDeg);
}

/** Radius of a circular orbit at `altitudeKm`, for the analytic metrics. */
export function orbitRadiusKm(altitudeKm: number): number {
  return EARTH_RADIUS_KM + altitudeKm;
}
