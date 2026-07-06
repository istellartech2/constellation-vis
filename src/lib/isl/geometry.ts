/** Geometric predicates for ISL/GSL edge existence. Pure math — no Three.js dependency. */
import * as satellite from "satellite.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Equatorial Earth radius in km (used as a safe-side bound for line-of-sight tests). */
export const EARTH_RADIUS_EQUATOR_KM = 6378.137;

export function linkDistanceKm(a: Vec3, b: Vec3): number {
  return Math.sqrt(linkDistanceSqKm2(a, b));
}

/** Squared distance in km^2 — avoids sqrt for early-rejection checks (§1.7.1). */
export function linkDistanceSqKm2(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Line-of-sight between two ECI positions: the segment a–b must not pass within
 * (earthRadiusKm + losMarginKm) of the ECI origin. Uses a clamped closest-point
 * parameter so it correctly handles the segment (not the infinite line).
 */
export function hasLineOfSight(
  a: Vec3,
  b: Vec3,
  losMarginKm: number,
  earthRadiusKm: number = EARTH_RADIUS_EQUATOR_KM,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dd = dx * dx + dy * dy + dz * dz;

  let t = dd === 0 ? 0 : -(a.x * dx + a.y * dy + a.z * dz) / dd;
  t = Math.min(1, Math.max(0, t));

  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const pz = a.z + t * dz;
  const dMinSq = px * px + py * py + pz * pz;

  const limit = earthRadiusKm + losMarginKm;
  return dMinSq > limit * limit;
}

/**
 * Elevation angle (radians) of a satellite as seen from a ground observer, both
 * expressed in the ECF frame at the same instant. GSL existence uses elevation only
 * (§1.2.1) — visibilityMode / maxOffNadirDeg from GroundStation are intentionally unused.
 */
export function elevationRad(
  observer: { longitude: number; latitude: number; height: number },
  satelliteEcf: Vec3,
): number {
  const look = satellite.ecfToLookAngles(observer, satelliteEcf as satellite.EcfVec3<number>);
  return look.elevation;
}

export interface GeodeticObserver {
  longitude: number;
  latitude: number;
  height: number;
}

/**
 * Convert an {@link IslEndpoint}-shaped lat/lon/height (degrees, degrees, km)
 * into the radians-based observer shape `satellite.js` expects. Shared by
 * `graph.ts`, `stability.ts` and `visualization.ts` — previously
 * reimplemented independently in all three.
 *
 * Accepts an optional `target` to mutate in place (avoids an allocation in
 * visualization.ts's per-frame call); defaults to allocating a fresh
 * object for the (non-hot-path) graph/stability call sites.
 */
export function endpointObserver(
  endpoint: { longitudeDeg: number; latitudeDeg: number; heightKm: number },
  target: GeodeticObserver = { longitude: 0, latitude: 0, height: 0 },
): GeodeticObserver {
  target.longitude = satellite.degreesToRadians(endpoint.longitudeDeg);
  target.latitude = satellite.degreesToRadians(endpoint.latitudeDeg);
  target.height = endpoint.heightKm;
  return target;
}

/** ECI position [km] of a geodetic observer at the given GMST. */
export function endpointEci(observer: GeodeticObserver, gmst: number): Vec3 {
  const ecf = satellite.geodeticToEcf(observer);
  return satellite.ecfToEci(ecf, gmst) as Vec3;
}

export const DEFAULT_REMAINING_LINK_TIME_HORIZON_S = 300;
export const DEFAULT_REMAINING_LINK_TIME_STEP_S = 10;
/** Binary-search refinement iterations; 20 halvings of a 10 s step resolves to sub-millisecond precision. */
const REMAINING_LINK_TIME_REFINEMENT_ITERATIONS = 20;

/**
 * Predict how much longer (seconds) an edge's existence condition will keep
 * holding, starting from t=0 (§1.5.2). `existsAt(dtSeconds)` must
 * evaluate the edge's existence condition (LoS+range for ISL, elevation+range
 * for GSL) at time t+dtSeconds — the caller supplies it via a closure so this
 * function stays position/propagation-agnostic.
 *
 * Coarsely samples every `stepS` seconds out to `horizonS`, then binary-searches
 * the bracketing interval once a sample fails, per the design's stated method.
 * Returns `horizonS` (unrefined) if the edge never breaks within the horizon,
 * and 0 if it doesn't even hold at t=0.
 */
export function remainingLinkTime(
  existsAt: (dtSeconds: number) => boolean,
  horizonS: number = DEFAULT_REMAINING_LINK_TIME_HORIZON_S,
  stepS: number = DEFAULT_REMAINING_LINK_TIME_STEP_S,
): number {
  if (!existsAt(0)) return 0;

  let t = 0;
  while (t < horizonS) {
    const next = Math.min(t + stepS, horizonS);
    if (!existsAt(next)) {
      let lo = t;
      let hi = next;
      for (let i = 0; i < REMAINING_LINK_TIME_REFINEMENT_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (existsAt(mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    }
    t = next;
  }
  return horizonS;
}
