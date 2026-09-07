/**
 * Pure spherical-coverage geometry, shared by the streets-of-coverage pattern
 * generator and (Phase 2) the mission-design optimizer. Everything works in
 * radians internally; the `*Deg` helpers convert at the boundary.
 *
 * Streets-of-coverage sizing follows
 *   G. Beech, S. Cornara, M. Bello Mora, G. Janin,
 *   "A Study of Three Satellite Constellation Design Algorithms",
 *   14th International Symposium on Space Flight Dynamics (ISSFD), 1999,
 * equations (1), (5), (6), (7).
 */

import { EARTH_RADIUS_KM, MU_KM3_S2 } from "./orbit";
import type { ShellWarning, StreetsOfCoverageDesign } from "./types";

/**
 * Same value as `linkGeometry.ts::SPEED_OF_LIGHT_KM_PER_SEC`, redeclared here
 * on purpose: `linkGeometry` pulls in `visibility.ts`, which imports Three.js,
 * and this module sits on the TOML parsing path used by Workers, the CLI and
 * `scripts/generate-satellites.ts`. Keep the two literals in sync.
 */
export const SPEED_OF_LIGHT_KM_PER_SEC = 299_792.458;

export { EARTH_RADIUS_KM };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function degToRad(deg: number): number {
  return deg * DEG;
}

export function radToDeg(rad: number): number {
  return rad * RAD;
}

function clampAcos(x: number): number {
  return Math.acos(Math.min(1, Math.max(-1, x)));
}

function clampAsin(x: number): number {
  return Math.asin(Math.min(1, Math.max(-1, x)));
}

/**
 * Earth central angle θ of the coverage circle (eq. 1):
 *   θ = acos( Re/(Re+h) · cos ε ) − ε
 * Negative elevations are clamped to 0 (a satellite below the horizon covers
 * nothing useful); a non-positive altitude has no coverage circle at all.
 */
export function earthCentralAngleRad(altitudeKm: number, minElevationRad: number): number {
  if (!(altitudeKm > 0)) {
    throw new Error(`earthCentralAngleRad: altitude must be positive (got ${altitudeKm})`);
  }
  const eps = Math.max(0, minElevationRad);
  return clampAcos((EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) * Math.cos(eps)) - eps;
}

export function earthCentralAngleDeg(altitudeKm: number, minElevationDeg: number): number {
  return radToDeg(earthCentralAngleRad(altitudeKm, degToRad(minElevationDeg)));
}

/** Half-cone angle η at the satellite; θ + ε + η = 90°. */
export function maxNadirAngleRad(altitudeKm: number, minElevationRad: number): number {
  const eps = Math.max(0, minElevationRad);
  return Math.PI / 2 - eps - earthCentralAngleRad(altitudeKm, eps);
}

/** Ground-range radius of the coverage circle (km, spherical Earth). */
export function footprintRadiusKm(altitudeKm: number, minElevationRad: number): number {
  return EARTH_RADIUS_KM * earthCentralAngleRad(altitudeKm, minElevationRad);
}

/** Slant range to a satellite seen at exactly `minElevationRad` (km). */
export function slantRangeAtElevationKm(altitudeKm: number, minElevationRad: number): number {
  const eps = Math.max(0, minElevationRad);
  const sinEps = Math.sin(eps);
  return (
    Math.sqrt(
      EARTH_RADIUS_KM * EARTH_RADIUS_KM * sinEps * sinEps +
        altitudeKm * altitudeKm +
        2 * EARTH_RADIUS_KM * altitudeKm,
    ) -
    EARTH_RADIUS_KM * sinEps
  );
}

/** One-way propagation delay for a range in km (ms). */
export function oneWayLatencyMs(rangeKm: number): number {
  return (rangeKm / SPEED_OF_LIGHT_KM_PER_SEC) * 1000;
}

/** One-way delay straight up to the satellite (ms). */
export function nadirLatencyMs(altitudeKm: number): number {
  return oneWayLatencyMs(altitudeKm);
}

/** Fraction of the sphere covered by one spherical cap of half-angle θ. */
export function coverageCapFraction(thetaRad: number): number {
  return (1 - Math.cos(thetaRad)) / 2;
}

/** Fraction of the sphere between two latitudes. */
export function bandAreaFraction(latMinDeg: number, latMaxDeg: number): number {
  const lo = Math.min(latMinDeg, latMaxDeg);
  const hi = Math.max(latMinDeg, latMaxDeg);
  return (Math.sin(degToRad(hi)) - Math.sin(degToRad(lo))) / 2;
}

/**
 * Area-based lower bound on the satellite count needed to cover
 * `regionAreaFraction` of the sphere `fold` times over. Necessary, never
 * sufficient — caps overlap and the region is not tiled perfectly.
 */
export function capAreaLowerBoundCount(
  regionAreaFraction: number,
  thetaRad: number,
  fold: number = 1,
): number {
  const cap = coverageCapFraction(thetaRad);
  if (!(cap > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil((fold * regionAreaFraction) / cap);
}

/**
 * Half-width of the continuous "street of coverage" swept by a plane of `S`
 * evenly spaced satellites (eq. 5):
 *   cos c = cos θ / cos(m·π/S)
 * Returns null when the geometry is infeasible — the satellites are too far
 * apart along the plane for their caps to overlap at all.
 */
export function streetHalfWidthRad(thetaRad: number, satsPerPlane: number, fold: number = 1): number | null {
  if (!(satsPerPlane > 0) || !(fold > 0)) return null;
  const halfSpacing = (fold * Math.PI) / satsPerPlane;
  if (halfSpacing >= thetaRad) return null;
  const cosC = Math.cos(thetaRad) / Math.cos(halfSpacing);
  if (!(cosC > 0)) return null;
  return clampAcos(cosC);
}

/** Keplerian period (s) at altitude `altitudeKm` above a spherical Earth. */
export function orbitalPeriodSec(altitudeKm: number): number {
  const a = EARTH_RADIUS_KM + altitudeKm;
  return 2 * Math.PI * Math.sqrt(a ** 3 / MU_KM3_S2);
}

export interface StreetsOfCoverageInput {
  altitudeKm: number;
  minElevationDeg: number;
  /** n-fold coverage. 1 = single coverage. */
  fold?: number;
  /** λ_n — highest latitude that must stay covered; 0 = global. */
  targetLatitudeDeg?: number;
  /** S — satellites per plane. */
  satsPerPlane: number;
  /**
   * Shrinks the usable co-rotating spacing. 1 reproduces the textbook
   * (and Iridium) numbers; the optimizer passes < 1 for margin.
   */
  spacingSafetyFactor?: number;
}

/** Upper bound on the plane-count search — a runaway P is a bad design, not a solution. */
const MAX_PLANES = 200;

/**
 * Streets-of-coverage sizing.
 *
 * For P co-rotating planes plus one counter-rotating seam, the RAAN span that
 * must be filled is (eq. 6)
 *   span = 2P·asin[ cos λ_n · cos((P − n)π/(2P)) ]
 * and P planes can fill it when (eq. 7)
 *   (P − 1)(θ + c_n)·safety + (c₁ + c_n) ≥ span.
 * The smallest such P ≥ n is chosen; then
 *   Δseam = c₁ + c_n,  Δco = (span − Δseam)/(P − 1)
 *   ω     = asin(sin λ_n/cos θ) − asin[(sin λ_n/cos θ)·cos(nπ/S)] + π/S
 *
 * Reference case (Iridium): h = 780 km, ε = 8.2°, n = 1, λ = 0, S = 11 gives
 * θ = 19.925°, c₁ = 11.527°, P = 6, T = 66, Δco = 31.389°, Δseam = 23.054°,
 * ω = 16.364°.
 */
export function designStreetsOfCoverage(input: StreetsOfCoverageInput): StreetsOfCoverageDesign {
  const fold = Math.max(1, Math.trunc(input.fold ?? 1));
  const satsPerPlane = Math.max(1, Math.trunc(input.satsPerPlane));
  const safety = input.spacingSafetyFactor ?? 1;
  const latRad = degToRad(input.targetLatitudeDeg ?? 0);
  const warnings: ShellWarning[] = [];

  if (fold > 1) {
    warnings.push({
      code: "fold_approximation",
      message: `${fold} 重カバレッジの寸法計算は近似です(面内 ${fold} 重のストリート半幅を用い、面間の重なりは考慮していません)。数値検証で確認してください。`,
    });
  }

  if (!(input.altitudeKm > 0) || !Number.isFinite(input.altitudeKm)) {
    // Never throw from a design-method entry point: the editor, serializer and
    // CLI all reach this with whatever the user has typed so far.
    return {
      feasible: false,
      thetaDeg: Number.NaN,
      c1Deg: Number.NaN,
      cnDeg: Number.NaN,
      planes: 0,
      count: 0,
      spanDeg: Number.NaN,
      requiredSpanDeg: Number.NaN,
      achievedSpanDeg: Number.NaN,
      deltaCoDeg: Number.NaN,
      deltaSeamDeg: Number.NaN,
      omegaDeg: Number.NaN,
      satsPerPlane,
      foldRequested: fold,
      warnings: [
        ...warnings,
        { code: "infeasible_coverage", message: `高度 ${input.altitudeKm} km は正の値である必要があります。` },
      ],
    };
  }

  const theta = earthCentralAngleRad(input.altitudeKm, degToRad(input.minElevationDeg));
  const c1 = streetHalfWidthRad(theta, satsPerPlane, 1);
  const cn = streetHalfWidthRad(theta, satsPerPlane, fold);

  const infeasible = (reason: string): StreetsOfCoverageDesign => ({
    feasible: false,
    thetaDeg: radToDeg(theta),
    c1Deg: c1 === null ? Number.NaN : radToDeg(c1),
    cnDeg: cn === null ? Number.NaN : radToDeg(cn),
    planes: 0,
    count: 0,
    spanDeg: Number.NaN,
    requiredSpanDeg: Number.NaN,
    achievedSpanDeg: Number.NaN,
    deltaCoDeg: Number.NaN,
    deltaSeamDeg: Number.NaN,
    omegaDeg: Number.NaN,
    satsPerPlane,
    foldRequested: fold,
    warnings: [...warnings, { code: "infeasible_coverage", message: reason }],
  });

  if (c1 === null || cn === null) {
    return infeasible(
      `高度 ${input.altitudeKm} km / 仰角 ${input.minElevationDeg}° では 1 面 ${satsPerPlane} 機の被覆円が面内でつながりません(θ = ${radToDeg(theta).toFixed(3)}°)。衛星数を増やすか高度を上げてください。`,
    );
  }

  const deltaSeam = c1 + cn;
  const requiredSpan = (planes: number) =>
    2 * planes * clampAsin(Math.cos(latRad) * Math.cos(((planes - fold) * Math.PI) / (2 * planes)));
  const achievableSpan = (planes: number) => (planes - 1) * (theta + cn) * safety + deltaSeam;

  let planes = 0;
  for (let p = Math.max(1, fold); p <= MAX_PLANES; p++) {
    if (achievableSpan(p) >= requiredSpan(p)) {
      planes = p;
      break;
    }
  }

  if (planes === 0) {
    return infeasible(
      `高度 ${input.altitudeKm} km / 仰角 ${input.minElevationDeg}° / 1 面 ${satsPerPlane} 機では ${MAX_PLANES} 面以内で ${fold} 重カバレッジが成立しません。`,
    );
  }

  const span = requiredSpan(planes);
  // P = 1 has no co-rotating gap to fill; the single plane plus its seam is
  // the whole constellation.
  const deltaCo = planes > 1 ? (span - deltaSeam) / (planes - 1) : 0;
  const sinRatio = Math.sin(latRad) / Math.cos(theta);
  const omega =
    clampAsin(sinRatio) -
    clampAsin(sinRatio * Math.cos((fold * Math.PI) / satsPerPlane)) +
    Math.PI / satsPerPlane;

  return {
    feasible: true,
    thetaDeg: radToDeg(theta),
    c1Deg: radToDeg(c1),
    cnDeg: radToDeg(cn),
    planes,
    count: planes * satsPerPlane,
    spanDeg: radToDeg(span),
    requiredSpanDeg: radToDeg(span),
    achievedSpanDeg: radToDeg(achievableSpan(planes)),
    deltaCoDeg: radToDeg(deltaCo),
    deltaSeamDeg: radToDeg(deltaSeam),
    omegaDeg: radToDeg(omega),
    satsPerPlane,
    foldRequested: fold,
    warnings,
  };
}
