/**
 * Ground clearance of the 3D camera (pure math, scene units = equatorial
 * Earth radii). The drawn globe is the unit sphere scaled by
 * EARTH_FLATTENING along scene +Y (the polar axis), i.e. an ellipsoid with
 * semi-axes (1, f, 1). The height used here is radial: the distance along the
 * ray from the centre beyond the ellipsoid surface, which is within a
 * fraction of a percent of the geodetic height near the surface and is
 * exactly the direction the camera is pushed back out.
 */
import { EARTH_FLATTENING } from "./astronomy";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Radius of the drawn ellipsoid along the direction of `p` (scene units). */
export function ellipsoidRadiusToward(p: Vec3Like, flattening = EARTH_FLATTENING): number {
  const r = Math.hypot(p.x, p.y, p.z);
  if (!(r > 0)) return 1;
  const ux = p.x / r;
  const uy = p.y / r;
  const uz = p.z / r;
  return 1 / Math.sqrt(ux * ux + uz * uz + (uy * uy) / (flattening * flattening));
}

/** Radial height of `p` above the drawn globe (negative = inside). */
export function heightAboveGlobe(p: Vec3Like, flattening = EARTH_FLATTENING): number {
  return Math.hypot(p.x, p.y, p.z) - ellipsoidRadiusToward(p, flattening);
}

/**
 * Factor to scale `p` (about the Earth's centre) so that it is at least
 * `minHeight` above the globe; 1 when it already is.
 */
export function groundClearanceScale(p: Vec3Like, minHeight: number, flattening = EARTH_FLATTENING): number {
  const r = Math.hypot(p.x, p.y, p.z);
  if (!(r > 0)) return 1;
  const surface = ellipsoidRadiusToward(p, flattening);
  const want = surface + minHeight;
  return r < want ? want / r : 1;
}

/** Minimum camera height while riding: max(50 m, 2 % of the distance to the target). */
export function rideMinHeight(targetDistance: number, metresPerUnit: number): number {
  return Math.max(50 / metresPerUnit, 0.02 * targetDistance);
}

/**
 * Near plane of the free camera from its height `h` above the globe and its
 * distance from the centre `r`: 0.3 h (the surface below is ≥ h away), no
 * smaller than what resolves thin shells at the horizon (≈ (r² − 1)/2000,
 * as for rides) nor larger than half the height, clamped to [1e-6, 0.1].
 * At the default whole-globe distance (r ≈ 3) this is the old fixed 0.1.
 */
export function freeCameraNear(h: number, r: number): number {
  const horizonSq = Math.max(r * r - 1, 0);
  const near = Math.min(Math.max(0.3 * h, horizonSq / 2000), 0.5 * Math.max(h, 0));
  return Math.min(Math.max(near, 1e-6), 0.1);
}

/**
 * Wheel / pinch zoom speed of the free camera: OrbitControls zooms by a
 * fixed fraction of the distance to the centre per step, which near the
 * surface is hundreds of km; scale it by height / distance so a step stays a
 * similar fraction of the height. 1 at the default distance.
 */
export function freeCameraZoomSpeed(h: number, r: number): number {
  if (!(r > 0)) return 1;
  return Math.min(Math.max((1.5 * h) / r, 0.03), 1);
}
