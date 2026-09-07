/**
 * Turns `CandidateParameters` into concrete per-satellite orbital angles.
 *
 * Not in the original Phase 2 file list, but both `screen.ts` (analytic circular
 * Keplerian) and `verify.ts` (SGP4) need the *same* RAAN and mean-anomaly
 * arrays, and so does the shell round trip: `candidateToShell` →
 * `buildConstellation` must reproduce exactly these satellites, or a verified
 * candidate would stop being the thing the user gets when they add it. Keeping
 * one implementation here is the only way that test can be meaningful.
 *
 * The mean-anomaly expression is copied verbatim from
 * `tomlParsers.ts::generateFromShellsDetailed` (plane-major order, `p` outer):
 *
 *     M(p, j) = (M0 + (360 / T) · (p·F + j·P)) mod 360
 *
 * which equals the Walker convention `u0 = 2π·j/S + 2π·F·p/T` for `T = P·S`.
 */
import type { OrbitalElements, SatelliteSpec } from "../satellites";
import type { CandidateParameters } from "./types";
import { WGS84_A_KM } from "./coverageKernel";

/** Earth gravitational parameter, km³/s². Matches `satellites.ts::elementsToTle`. */
export const MU_KM3_S2 = 398600.4418;

export interface CandidateGeometry {
  /** RAAN of every satellite, degrees, plane-major order. */
  raanDeg: Float64Array;
  /** Mean anomaly at epoch of every satellite, degrees, plane-major order. */
  meanAnomalyDeg: Float64Array;
  /** Plane index of every satellite. */
  planeIndex: Int32Array;
  semiMajorAxisKm: number;
  /** Mean motion, rad/s. */
  meanMotionRadPerSec: number;
  orbitalPeriodSec: number;
  count: number;
}

/** RAAN of plane `p`, degrees. Uniform 360°/P for Delta, `Δco` steps for Star. */
export function planeRaanDeg(parameters: CandidateParameters, p: number): number {
  if (parameters.family === "walkerStar") {
    const spacing = parameters.deltaCoDeg;
    if (spacing !== undefined && Number.isFinite(spacing)) return p * spacing;
    // No Δco means the shell falls back to raan_range/planes, and a Star shell's
    // raan_range default is 180 (see the Phase 1 pattern defaults).
    return (180 * p) / parameters.planes;
  }
  return (360 * p) / parameters.planes;
}

export function candidateGeometry(parameters: CandidateParameters): CandidateGeometry {
  const t = Math.max(1, Math.round(parameters.totalSatellites));
  const p = Math.max(1, Math.round(parameters.planes));
  const perPlane = Math.ceil(t / p);
  const f = parameters.phasingF;

  const raanDeg = new Float64Array(t);
  const meanAnomalyDeg = new Float64Array(t);
  const planeIndex = new Int32Array(t);

  let generated = 0;
  for (let pi = 0; pi < p; pi++) {
    const raan = planeRaanDeg(parameters, pi);
    for (let j = 0; j < perPlane && generated < t; j++) {
      raanDeg[generated] = raan;
      meanAnomalyDeg[generated] = ((360 / t) * (pi * f + j * p)) % 360;
      planeIndex[generated] = pi;
      generated++;
    }
  }

  const semiMajorAxisKm = WGS84_A_KM + parameters.altitudeKm;
  const meanMotionRadPerSec = Math.sqrt(
    MU_KM3_S2 / (semiMajorAxisKm * semiMajorAxisKm * semiMajorAxisKm),
  );

  return {
    raanDeg,
    meanAnomalyDeg,
    planeIndex,
    semiMajorAxisKm,
    meanMotionRadPerSec,
    orbitalPeriodSec: (2 * Math.PI) / meanMotionRadPerSec,
    count: generated,
  };
}

/**
 * Satellite specs for SGP4 verification. `satnum` starts at 1 to mirror the
 * constellation generator's ID range (1-9999 = generated satellites).
 */
export function candidateSatelliteSpecs(
  parameters: CandidateParameters,
  epoch: Date,
): SatelliteSpec[] {
  const geom = candidateGeometry(parameters);
  const specs: SatelliteSpec[] = new Array(geom.count);
  for (let i = 0; i < geom.count; i++) {
    const elements: OrbitalElements = {
      satnum: i + 1,
      epoch,
      semiMajorAxisKm: geom.semiMajorAxisKm,
      eccentricity: 0,
      inclinationDeg: parameters.inclinationDeg,
      raanDeg: geom.raanDeg[i],
      argPerigeeDeg: 0,
      meanAnomalyDeg: geom.meanAnomalyDeg[i],
    };
    specs[i] = { type: "elements", elements };
  }
  return specs;
}
