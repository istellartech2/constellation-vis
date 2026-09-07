/**
 * The only place that turns a `PlanePlan[]` into `SatelliteSpec`s.
 *
 * Satellites are laid out **plane-major** (plane 0's satellites first, in
 * mean-anomaly order as the pattern produced them, then plane 1, ...) because
 * `gridPatternIslCandidates` derives the +Grid topology from that index order.
 */

import type { OrbitalElements, SatelliteSpec } from "../satellites";
import type { PlanePlan, SatelliteGeometry, ShellOrbit } from "./types";

/**
 * Folds an angle into [0, 360).
 *
 * Deliberately NOT `((x % 360) + 360) % 360`: for a value already in [0, 360)
 * that idiom is not bit-stable (`(0.1 + 360) % 360 !== 0.1` in IEEE-754),
 * which would perturb the elements of every existing TOML file. `%` is an
 * exact fmod, so a non-negative input in range passes through untouched.
 */
export function normalizeAngleDeg(deg: number): number {
  let r = deg % 360;
  if (r < 0) r += 360;
  return r;
}

export interface EmittedShell {
  satellites: SatelliteSpec[];
  planeSizes: number[];
  /** First unused satellite number, for the next shell. */
  nextSatnum: number;
}

/**
 * Builds `SatelliteSpec`s for one shell.
 *
 * The `elements` object literal must keep its key order (satnum, epoch,
 * semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPerigeeDeg,
 * meanAnomalyDeg): `scripts/generate-satellites.ts` serializes it with
 * `Object.entries`, so reordering keys rewrites `satellites.generated.ts`.
 */
export function emitShell(
  plans: readonly PlanePlan[],
  orbit: ShellOrbit,
  epoch: Date,
  satnumStart: number,
): EmittedShell {
  const satellites: SatelliteSpec[] = [];
  const planeSizes: number[] = [];
  let satnum = satnumStart;

  for (const plane of plans) {
    const raanDeg = normalizeAngleDeg(plane.raanDeg);
    planeSizes.push(plane.meanAnomaliesDeg.length);
    for (const meanAnomalyDeg of plane.meanAnomaliesDeg) {
      const elements: OrbitalElements = {
        satnum: satnum++,
        epoch,
        semiMajorAxisKm: orbit.semiMajorAxisKm,
        eccentricity: orbit.eccentricity,
        inclinationDeg: orbit.inclinationDeg,
        raanDeg,
        argPerigeeDeg: normalizeAngleDeg(orbit.argPerigeeDeg),
        meanAnomalyDeg: normalizeAngleDeg(meanAnomalyDeg),
      };
      satellites.push({ type: "elements", elements });
    }
  }

  return { satellites, planeSizes, nextSatnum: satnum };
}

/** Pure geometry view of a plan (no epoch, no catalog numbers). */
export function planGeometry(
  plans: readonly PlanePlan[],
  orbit: ShellOrbit,
): SatelliteGeometry[] {
  const out: SatelliteGeometry[] = [];
  for (const plane of plans) {
    const raanDeg = normalizeAngleDeg(plane.raanDeg);
    for (const meanAnomalyDeg of plane.meanAnomaliesDeg) {
      out.push({
        raanDeg,
        meanAnomalyDeg: normalizeAngleDeg(meanAnomalyDeg),
        argPerigeeDeg: normalizeAngleDeg(orbit.argPerigeeDeg),
        semiMajorAxisKm: orbit.semiMajorAxisKm,
        eccentricity: orbit.eccentricity,
        inclinationDeg: orbit.inclinationDeg,
      });
    }
  }
  return out;
}

/**
 * The satellites-per-plane layout `gridPatternIslCandidates` assumes when a
 * shell reports no explicit `planeSizes` (greedy `ceil(count/planes)` fill).
 * Used to decide whether `planeSizes` carries information worth persisting.
 */
export function greedyPlaneSizes(count: number, planes: number): number[] {
  if (planes <= 0 || count <= 0) return [];
  const perPlane = Math.ceil(count / planes);
  const sizes: number[] = [];
  let offset = 0;
  for (let p = 0; p < planes; p++) {
    const size = Math.max(0, Math.min(perPlane, count - offset));
    sizes.push(size);
    offset += size;
  }
  return sizes;
}

export function sameSizes(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
