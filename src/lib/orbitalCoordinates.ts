/**
 * LVLH (Local Vertical Local Horizontal) coordinate system utilities
 * for satellite sensor pointing calculations.
 */
import * as THREE from "three";

/**
 * LVLH coordinate frame axes.
 * All vectors are unit vectors in the visualization coordinate system.
 */
export interface LVLHFrame {
  /** Radial direction: Earth center to satellite */
  radial: THREE.Vector3;
  /** Along-track direction: velocity direction (positive = forward) */
  alongTrack: THREE.Vector3;
  /** Cross-track direction: orbital angular momentum direction (positive = left) */
  crossTrack: THREE.Vector3;
  /** Nadir direction: satellite to Earth center (= -radial) */
  nadir: THREE.Vector3;
}

/**
 * Sensor pointing parameters in LVLH coordinates.
 */
export interface SensorPointing {
  /** Along-track angle offset in radians (positive = forward tilt toward velocity) */
  alongTrackAngleRad: number;
  /** Cross-track angle offset in radians (positive = left tilt) */
  crossTrackAngleRad: number;
}

// Reusable objects to avoid allocations in animation loop
const _tmpQuat1 = new THREE.Quaternion();
const _tmpQuat2 = new THREE.Quaternion();
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);

/**
 * Compute the LVLH coordinate frame from satellite position and velocity.
 *
 * Coordinate system (ECI from satellite.js):
 * - X: toward vernal equinox
 * - Y: perpendicular in equatorial plane
 * - Z: toward north pole
 *
 * Visualization coordinate system (Three.js):
 * - X: X_eci
 * - Y: Z_eci (toward north pole)
 * - Z: -Y_eci
 *
 * @param positionECI - Satellite position in ECI frame from satellite.js (km)
 * @param velocityECI - Satellite velocity in ECI frame from satellite.js (km/s)
 * @returns LVLH frame axes as unit vectors, or null if vectors are degenerate
 */
export function computeLVLHFrame(
  positionECI: { x: number; y: number; z: number },
  velocityECI: { x: number; y: number; z: number },
): LVLHFrame | null {
  // Convert from ECI to visualization coordinate system
  // Note: This matches the coordinate transform in visualization.ts
  const radial = new THREE.Vector3(
    positionECI.x,
    positionECI.z, // Z_eci -> Y_scene (north pole direction)
    -positionECI.y, // -Y_eci -> Z_scene
  );

  if (radial.lengthSq() < 1e-10) return null;
  radial.normalize();

  const velocity = new THREE.Vector3(
    velocityECI.x,
    velocityECI.z,
    -velocityECI.y,
  );

  if (velocity.lengthSq() < 1e-10) return null;

  // Along-track is velocity direction
  const alongTrack = velocity.clone().normalize();

  // Cross-track is R x V (orbital angular momentum direction)
  // This gives the "left" direction when looking in the velocity direction
  const crossTrack = new THREE.Vector3().crossVectors(radial, alongTrack);
  if (crossTrack.lengthSq() < 1e-10) return null;
  crossTrack.normalize();

  // Re-orthogonalize along-track for numerical stability
  // S' = W x R (ensures perfect orthogonality)
  alongTrack.crossVectors(crossTrack, radial).normalize();

  // Nadir is opposite to radial (pointing toward Earth center)
  const nadir = radial.clone().negate();

  return {
    radial: radial.clone(),
    alongTrack: alongTrack.clone(),
    crossTrack: crossTrack.clone(),
    nadir: nadir.clone(),
  };
}

/**
 * Compute the sensor pointing direction given LVLH frame and angular offsets.
 *
 * Rotation mechanics:
 * - To tilt nadir toward along-track (forward): rotate around cross-track axis
 * - To tilt nadir toward cross-track (left): rotate around along-track axis (negated)
 *
 * Rotation order:
 * 1. First apply along-track tilt (pitch) - rotate around cross-track axis
 * 2. Then apply cross-track tilt (roll) - rotate around along-track axis
 *
 * Sign convention:
 * - Positive along-track angle: sensor tilts forward (toward velocity direction)
 * - Positive cross-track angle: sensor tilts left (toward orbital angular momentum direction)
 *
 * @param frame - LVLH coordinate frame
 * @param pointing - Sensor pointing parameters (angles in radians)
 * @returns Unit vector in the sensor pointing direction (visualization frame)
 */
export function computeSensorDirection(
  frame: LVLHFrame,
  pointing: SensorPointing,
): THREE.Vector3 {
  // Start with nadir direction (straight down toward Earth)
  const direction = frame.nadir.clone();

  // Apply along-track tilt (pitch): rotate around cross-track (W) axis
  // Positive angle tilts nadir toward velocity (forward)
  // By right-hand rule: W × (-R) points toward S, so negative rotation moves -R toward S
  if (Math.abs(pointing.alongTrackAngleRad) > 1e-10) {
    _tmpQuat1.setFromAxisAngle(frame.crossTrack, -pointing.alongTrackAngleRad);
    direction.applyQuaternion(_tmpQuat1);
  }

  // Apply cross-track tilt (roll): rotate around along-track (S) axis
  // Positive angle tilts nadir toward left (cross-track direction W)
  // By right-hand rule: S × (-R) points toward W, so positive rotation moves -R toward W
  if (Math.abs(pointing.crossTrackAngleRad) > 1e-10) {
    _tmpQuat2.setFromAxisAngle(frame.alongTrack, pointing.crossTrackAngleRad);
    direction.applyQuaternion(_tmpQuat2);
  }

  return direction.normalize();
}

/**
 * Compute the quaternion to orient a cone (with axis along -Y in local coords)
 * to point in the sensor direction.
 *
 * The cone geometry has its axis along the -Y direction (DOWN_AXIS).
 * This function computes the rotation needed to align it with the sensor direction.
 *
 * @param sensorDirection - Target pointing direction (unit vector)
 * @returns Quaternion for cone orientation
 */
export function computeConeQuaternion(
  sensorDirection: THREE.Vector3,
): THREE.Quaternion {
  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(DOWN_AXIS, sensorDirection);
  return quat;
}

/**
 * Compute the sensor direction and cone quaternion in one call.
 * This is a convenience function for the animation loop.
 *
 * @param positionECI - Satellite position in ECI frame (km)
 * @param velocityECI - Satellite velocity in ECI frame (km/s)
 * @param alongTrackDeg - Along-track offset in degrees
 * @param crossTrackDeg - Cross-track offset in degrees
 * @returns Quaternion for cone orientation, or null if computation fails
 */
export function computeFovConeQuaternion(
  positionECI: { x: number; y: number; z: number },
  velocityECI: { x: number; y: number; z: number },
  alongTrackDeg: number,
  crossTrackDeg: number,
): THREE.Quaternion | null {
  const frame = computeLVLHFrame(positionECI, velocityECI);
  if (!frame) return null;

  const pointing: SensorPointing = {
    alongTrackAngleRad: THREE.MathUtils.degToRad(alongTrackDeg),
    crossTrackAngleRad: THREE.MathUtils.degToRad(crossTrackDeg),
  };

  const sensorDir = computeSensorDirection(frame, pointing);
  return computeConeQuaternion(sensorDir);
}

// Reusable vectors for computeTiltedConeHeight to avoid allocations
const _tmpVec1 = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _tmpVec3 = new THREE.Vector3();

/**
 * Helper function to compute ray-sphere intersection distance.
 * Returns the closest positive intersection distance, or null if no intersection.
 */
function raySphereIntersection(
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  sphereRadiusSq: number,
): number | null {
  const pDotD = rayOrigin.dot(rayDir);
  const pLenSq = rayOrigin.lengthSq();

  // Discriminant: (P·d)² - |P|² + R²
  const discriminant = pDotD * pDotD - pLenSq + sphereRadiusSq;

  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = -pDotD - sqrtDisc;
  const t2 = -pDotD + sqrtDisc;

  // Take the smaller positive t (closer intersection)
  if (t1 > 0) {
    return t1;
  } else if (t2 > 0) {
    return t2;
  }
  return null;
}

/** Step size in degrees for scanning from far edge to near edge */
const EDGE_SCAN_STEP_DEG = 5;

/**
 * Compute the cone height for a tilted FOV cone that intersects with Earth.
 *
 * This function scans from the far edge (furthest from Earth) toward the near edge
 * in 5° increments to find where the cone first intersects Earth. This provides
 * a smooth transition when the cone is tilted beyond the horizon.
 *
 * Scan order: far edge (+halfAngle) -> axis (0°) -> near edge (-halfAngle)
 *
 * @param positionECI - Satellite position in ECI frame (km)
 * @param velocityECI - Satellite velocity in ECI frame (km/s)
 * @param alongTrackDeg - Along-track offset in degrees
 * @param crossTrackDeg - Cross-track offset in degrees
 * @param halfAngleDeg - Cone half-angle in degrees
 * @param earthRadiusKm - Earth radius in km
 * @returns Cone height in km, or null if no intersection at all
 */
export function computeTiltedConeHeight(
  positionECI: { x: number; y: number; z: number },
  velocityECI: { x: number; y: number; z: number },
  alongTrackDeg: number,
  crossTrackDeg: number,
  halfAngleDeg: number,
  earthRadiusKm: number,
): number | null {
  const frame = computeLVLHFrame(positionECI, velocityECI);
  if (!frame) return null;

  const pointing: SensorPointing = {
    alongTrackAngleRad: THREE.MathUtils.degToRad(alongTrackDeg),
    crossTrackAngleRad: THREE.MathUtils.degToRad(crossTrackDeg),
  };

  // Get the sensor direction (cone axis) in visualization coordinates
  const sensorDir = computeSensorDirection(frame, pointing);

  // Convert satellite position from ECI to visualization coordinates
  const satPos = new THREE.Vector3(
    positionECI.x,
    positionECI.z, // Z_eci -> Y_scene
    -positionECI.y, // -Y_eci -> Z_scene
  );

  const halfAngleRad = THREE.MathUtils.degToRad(halfAngleDeg);
  const cosHalfAngle = Math.cos(halfAngleRad);
  const rSq = earthRadiusKm * earthRadiusKm;

  // Get the radial direction (from Earth center to satellite = away from Earth)
  const radialDir = _tmpVec1.copy(satPos).normalize();
  const dotRS = radialDir.dot(sensorDir);

  // If sensor is pointing exactly radial (AWAY from Earth), no valid cone
  if (dotRS > 0.9999) {
    return null;
  }

  // Compute perpendicular direction (toward radial from sensor axis)
  let perpDir: THREE.Vector3;
  if (dotRS < -0.9999) {
    // Special case: sensor is pointing exactly nadir
    // Any perpendicular direction works since the cone is symmetric
    perpDir = _tmpVec2.copy(frame.alongTrack);
  } else {
    perpDir = _tmpVec2
      .copy(radialDir)
      .addScaledVector(sensorDir, -dotRS)
      .normalize();
  }

  // Scan from far edge (+halfAngle) to near edge (-halfAngle) in 5° steps
  // offsetDeg: +halfAngle = far edge (toward radial), -halfAngle = near edge (away from radial)
  for (
    let offsetDeg = halfAngleDeg;
    offsetDeg >= -halfAngleDeg;
    offsetDeg -= EDGE_SCAN_STEP_DEG
  ) {
    const offsetRad = THREE.MathUtils.degToRad(offsetDeg);
    const cosOffset = Math.cos(offsetRad);
    const sinOffset = Math.sin(offsetRad);

    // Compute ray direction at this offset from the axis
    // rayDir = cos(offset) * sensorDir + sin(offset) * perpDir
    const rayDir = _tmpVec3
      .copy(sensorDir)
      .multiplyScalar(cosOffset)
      .addScaledVector(perpDir, sinOffset);

    const t = raySphereIntersection(satPos, rayDir, rSq);
    if (t !== null) {
      // Found intersection - convert slant length to axis height
      // For offset = 0 (axis), cosOffset = 1, so height = t
      // For offset != 0, we project the slant onto the axis
      return t * cosOffset;
    }
  }

  // Ensure we check the exact near edge if we haven't hit it
  // (in case halfAngleDeg is not divisible by EDGE_SCAN_STEP_DEG)
  const nearOffsetRad = -halfAngleRad;
  const cosNearOffset = Math.cos(nearOffsetRad);
  const sinNearOffset = Math.sin(nearOffsetRad);
  const nearEdgeDir = _tmpVec3
    .copy(sensorDir)
    .multiplyScalar(cosNearOffset)
    .addScaledVector(perpDir, sinNearOffset);

  const tNear = raySphereIntersection(satPos, nearEdgeDir, rSq);
  if (tNear !== null) {
    return tNear * cosHalfAngle;
  }

  // No part of the cone intersects Earth
  return null;
}
