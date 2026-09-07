/**
 * Assembles the pattern-independent half of `ShellDerived`.
 *
 * Kept separate from `derived.ts` (which only dispatches through the registry)
 * so each pattern module can build its own derived record without importing
 * the registry — that would be a cycle.
 */

import { suggestRgtRatioFromAltitudeInclination } from "../rgt";
import { EARTH_RADIUS_KM, periodMinFromSemiMajorAxis } from "./orbit";
import type { DerivedRgt, ShellDerivedCommon, ShellOrbit, ShellWarning } from "./types";

export interface CommonDerivedInput {
  totalSats: number;
  planes: number;
  planeSizes: number[];
  orbit: ShellOrbit;
  raanSpacingDeg: number;
  inPlaneSpacingDeg: number;
  interPlaneOffsetDeg: number;
  warnings?: ShellWarning[];
}

function nearestRgt(orbit: ShellOrbit): DerivedRgt | null {
  const suggestion = suggestRgtRatioFromAltitudeInclination(
    orbit.semiMajorAxisKm - EARTH_RADIUS_KM,
    orbit.inclinationDeg,
    orbit.eccentricity,
  );
  if (!suggestion) return null;
  return {
    repeatOrbits: suggestion.repeatOrbits,
    repeatDays: suggestion.repeatDays,
    ratio: suggestion.ratio,
    error: suggestion.error,
  };
}

export function buildCommonDerived(input: CommonDerivedInput): ShellDerivedCommon {
  const { orbit } = input;
  const a = orbit.semiMajorAxisKm;
  return {
    totalSats: input.totalSats,
    planes: input.planes,
    satsPerPlane: input.planes > 0 ? input.totalSats / input.planes : 0,
    planeSizes: input.planeSizes,
    semiMajorAxisKm: a,
    eccentricity: orbit.eccentricity,
    inclinationDeg: orbit.inclinationDeg,
    perigeeAltitudeKm: a * (1 - orbit.eccentricity) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: a * (1 + orbit.eccentricity) - EARTH_RADIUS_KM,
    periodMin: periodMinFromSemiMajorAxis(a),
    raanSpacingDeg: input.raanSpacingDeg,
    inPlaneSpacingDeg: input.inPlaneSpacingDeg,
    interPlaneOffsetDeg: input.interPlaneOffsetDeg,
    rgt: nearestRgt(orbit),
    warnings: input.warnings ?? [],
  };
}
