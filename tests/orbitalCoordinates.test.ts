import * as THREE from "three";
import {
  computeLVLHFrame,
  computeSensorDirection,
  computeConeQuaternion,
  computeFovConeQuaternion,
  computeTiltedConeHeight,
  type SensorPointing,
} from "../src/lib/orbitalCoordinates";

describe("orbitalCoordinates", () => {
  describe("computeLVLHFrame", () => {
    it("should return orthogonal unit vectors for circular equatorial orbit", () => {
      // Satellite at (7000, 0, 0) km in ECI, velocity (0, 7.5, 0) km/s
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      const frame = computeLVLHFrame(pos, vel);
      expect(frame).not.toBeNull();

      // Check unit vectors
      expect(frame!.radial.length()).toBeCloseTo(1, 5);
      expect(frame!.alongTrack.length()).toBeCloseTo(1, 5);
      expect(frame!.crossTrack.length()).toBeCloseTo(1, 5);
      expect(frame!.nadir.length()).toBeCloseTo(1, 5);

      // Check orthogonality
      expect(frame!.radial.dot(frame!.alongTrack)).toBeCloseTo(0, 5);
      expect(frame!.radial.dot(frame!.crossTrack)).toBeCloseTo(0, 5);
      expect(frame!.alongTrack.dot(frame!.crossTrack)).toBeCloseTo(0, 5);

      // Nadir is opposite to radial
      expect(frame!.nadir.dot(frame!.radial)).toBeCloseTo(-1, 5);
    });

    it("should handle polar orbit", () => {
      // Polar orbit: satellite at (7000, 0, 0), velocity toward north pole
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 0, z: 7.5 };

      const frame = computeLVLHFrame(pos, vel);
      expect(frame).not.toBeNull();

      // All axes should be unit vectors
      expect(frame!.radial.length()).toBeCloseTo(1, 5);
      expect(frame!.alongTrack.length()).toBeCloseTo(1, 5);
      expect(frame!.crossTrack.length()).toBeCloseTo(1, 5);

      // Check orthogonality
      expect(frame!.radial.dot(frame!.alongTrack)).toBeCloseTo(0, 5);
      expect(frame!.radial.dot(frame!.crossTrack)).toBeCloseTo(0, 5);
      expect(frame!.alongTrack.dot(frame!.crossTrack)).toBeCloseTo(0, 5);
    });

    it("should handle inclined orbit", () => {
      // Inclined orbit (45 deg)
      const pos = { x: 5000, y: 0, z: 5000 };
      const vel = { x: 0, y: 5.3, z: 0 };

      const frame = computeLVLHFrame(pos, vel);
      expect(frame).not.toBeNull();

      // Check orthogonality
      expect(frame!.radial.dot(frame!.alongTrack)).toBeCloseTo(0, 5);
      expect(frame!.radial.dot(frame!.crossTrack)).toBeCloseTo(0, 5);
      expect(frame!.alongTrack.dot(frame!.crossTrack)).toBeCloseTo(0, 5);
    });

    it("should return null for zero position", () => {
      const frame = computeLVLHFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
      expect(frame).toBeNull();
    });

    it("should return null for zero velocity", () => {
      const frame = computeLVLHFrame({ x: 7000, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      expect(frame).toBeNull();
    });

    it("should return null for collinear position and velocity", () => {
      // Velocity in same direction as position (degenerate case)
      const frame = computeLVLHFrame({ x: 7000, y: 0, z: 0 }, { x: 7.5, y: 0, z: 0 });
      expect(frame).toBeNull();
    });
  });

  describe("computeSensorDirection", () => {
    it("should return nadir when no offset", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const pointing: SensorPointing = {
        alongTrackAngleRad: 0,
        crossTrackAngleRad: 0,
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should be exactly nadir
      expect(dir.dot(frame.nadir)).toBeCloseTo(1, 5);
    });

    it("should tilt forward for positive along-track angle", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const angle = Math.PI / 4; // 45 degrees
      const pointing: SensorPointing = {
        alongTrackAngleRad: angle,
        crossTrackAngleRad: 0,
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should have positive component along velocity direction
      expect(dir.dot(frame.alongTrack)).toBeGreaterThan(0);
      // Should still have negative radial component (pointing somewhat toward Earth)
      expect(dir.dot(frame.radial)).toBeLessThan(0);
      // At 45 degrees, the components should be equal in magnitude
      expect(Math.abs(dir.dot(frame.alongTrack))).toBeCloseTo(
        Math.abs(dir.dot(frame.nadir)),
        5
      );
    });

    it("should tilt backward for negative along-track angle", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const pointing: SensorPointing = {
        alongTrackAngleRad: -Math.PI / 6, // -30 degrees
        crossTrackAngleRad: 0,
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should have negative component along velocity direction (tilted backward)
      expect(dir.dot(frame.alongTrack)).toBeLessThan(0);
    });

    it("should tilt left for positive cross-track angle", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const angle = Math.PI / 4; // 45 degrees
      const pointing: SensorPointing = {
        alongTrackAngleRad: 0,
        crossTrackAngleRad: angle,
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should have positive component along cross-track (left)
      expect(dir.dot(frame.crossTrack)).toBeGreaterThan(0);
      // Should still point somewhat toward Earth
      expect(dir.dot(frame.radial)).toBeLessThan(0);
    });

    it("should tilt right for negative cross-track angle", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const pointing: SensorPointing = {
        alongTrackAngleRad: 0,
        crossTrackAngleRad: -Math.PI / 6, // -30 degrees
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should have negative component along cross-track (right)
      expect(dir.dot(frame.crossTrack)).toBeLessThan(0);
    });

    it("should handle combined rotation", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const pointing: SensorPointing = {
        alongTrackAngleRad: Math.PI / 6, // 30 degrees forward
        crossTrackAngleRad: Math.PI / 6, // 30 degrees left
      };
      const dir = computeSensorDirection(frame, pointing);

      // Should have positive components in both directions
      expect(dir.dot(frame.alongTrack)).toBeGreaterThan(0);
      expect(dir.dot(frame.crossTrack)).toBeGreaterThan(0);
      // Result should be a unit vector
      expect(dir.length()).toBeCloseTo(1, 5);
    });

    it("should return unit vector at extreme angles", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const frame = computeLVLHFrame(pos, vel)!;

      const pointing: SensorPointing = {
        alongTrackAngleRad: Math.PI / 3, // 60 degrees
        crossTrackAngleRad: -Math.PI / 3, // -60 degrees
      };
      const dir = computeSensorDirection(frame, pointing);

      expect(dir.length()).toBeCloseTo(1, 5);
    });
  });

  describe("computeConeQuaternion", () => {
    it("should orient cone along nadir for pure nadir direction", () => {
      // Create a pure downward direction (nadir)
      const nadirDir = new THREE.Vector3(0, -1, 0);
      const quat = computeConeQuaternion(nadirDir);

      // Should be identity quaternion (no rotation needed)
      expect(quat.x).toBeCloseTo(0, 5);
      expect(quat.y).toBeCloseTo(0, 5);
      expect(quat.z).toBeCloseTo(0, 5);
      expect(quat.w).toBeCloseTo(1, 5);
    });

    it("should rotate cone for non-nadir direction", () => {
      // Direction at 45 degrees from vertical
      const dir = new THREE.Vector3(1, -1, 0).normalize();
      const quat = computeConeQuaternion(dir);

      // Apply quaternion to DOWN_AXIS and check it matches target
      const rotated = new THREE.Vector3(0, -1, 0).applyQuaternion(quat);
      expect(rotated.dot(dir)).toBeCloseTo(1, 5);
    });
  });

  describe("computeFovConeQuaternion", () => {
    it("should return valid quaternion for typical satellite", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      const quat = computeFovConeQuaternion(pos, vel, 0, 0);
      expect(quat).not.toBeNull();

      // Quaternion should be normalized
      const len = Math.sqrt(
        quat!.x * quat!.x + quat!.y * quat!.y + quat!.z * quat!.z + quat!.w * quat!.w
      );
      expect(len).toBeCloseTo(1, 5);
    });

    it("should return null for degenerate cases", () => {
      const quat = computeFovConeQuaternion(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 7.5, z: 0 },
        0,
        0
      );
      expect(quat).toBeNull();
    });

    it("should handle degree inputs correctly", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      // 45 degrees forward, 30 degrees left
      const quat = computeFovConeQuaternion(pos, vel, 45, 30);
      expect(quat).not.toBeNull();

      // Verify the quaternion by checking the rotated direction
      const rotated = new THREE.Vector3(0, -1, 0).applyQuaternion(quat!);

      // Get the frame for verification
      const frame = computeLVLHFrame(pos, vel)!;

      // Should have positive along-track and cross-track components
      expect(rotated.dot(frame.alongTrack)).toBeGreaterThan(0);
      expect(rotated.dot(frame.crossTrack)).toBeGreaterThan(0);
    });
  });

  describe("computeTiltedConeHeight", () => {
    const EARTH_RADIUS_KM = 6378.137;

    it("should return valid height for nadir-pointing cone (no tilt)", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      const height = computeTiltedConeHeight(pos, vel, 0, 0, 30, EARTH_RADIUS_KM);
      expect(height).not.toBeNull();
      expect(height).toBeGreaterThan(0);

      // For a satellite at 7000 km, altitude is ~622 km
      // With far edge calculation, cone height can be slightly larger than altitude
      // because the far edge travels at an angle
      const altitude = 7000 - EARTH_RADIUS_KM;
      expect(height!).toBeLessThan(altitude * 1.5); // reasonable upper bound
    });

    it("should return height similar to nadir calculation for no tilt", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const halfAngleDeg = 30;

      const tiltedHeight = computeTiltedConeHeight(pos, vel, 0, 0, halfAngleDeg, EARTH_RADIUS_KM);
      expect(tiltedHeight).not.toBeNull();

      // Calculate nadir height for comparison
      const rSat = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
      const halfAngleRad = THREE.MathUtils.degToRad(halfAngleDeg);
      const sinHalfAngle = Math.sin(halfAngleRad);
      const cosHalfAngle = Math.cos(halfAngleRad);
      const sinTerm = rSat * sinHalfAngle;
      const underRoot = EARTH_RADIUS_KM ** 2 - sinTerm ** 2;
      const sqrtTerm = Math.sqrt(underRoot);
      const slantLengthKm = rSat * cosHalfAngle - sqrtTerm;
      const nadirHeight = slantLengthKm * cosHalfAngle;

      // Heights should be reasonably close (within 20% difference)
      // Note: The two calculations use different geometric approaches:
      // - Nadir: tangent-based calculation for cone edge touching Earth
      // - Tilted: ray-sphere intersection along axis
      const relativeDiff = Math.abs(tiltedHeight! - nadirHeight) / nadirHeight;
      expect(relativeDiff).toBeLessThan(0.20);
    });

    it("should return longer height for tilted cone", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      // Use smaller half-angle so that tilt + halfAngle < horizon angle (~65°)
      const halfAngleDeg = 15;

      const nadirHeight = computeTiltedConeHeight(pos, vel, 0, 0, halfAngleDeg, EARTH_RADIUS_KM);
      // 30° tilt + 15° half-angle = 45° from nadir (within horizon)
      const tiltedHeight = computeTiltedConeHeight(pos, vel, 30, 0, halfAngleDeg, EARTH_RADIUS_KM);

      expect(nadirHeight).not.toBeNull();
      expect(tiltedHeight).not.toBeNull();

      // Tilted cone should reach further to intersect Earth
      expect(tiltedHeight!).toBeGreaterThan(nadirHeight!);
    });

    it("should handle cross-track tilt", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      // Use smaller half-angle so that tilt + halfAngle < horizon angle (~65°)
      const halfAngleDeg = 15;

      const nadirHeight = computeTiltedConeHeight(pos, vel, 0, 0, halfAngleDeg, EARTH_RADIUS_KM);
      // 30° tilt + 15° half-angle = 45° from nadir (within horizon)
      const crossTiltedHeight = computeTiltedConeHeight(pos, vel, 0, 30, halfAngleDeg, EARTH_RADIUS_KM);

      expect(nadirHeight).not.toBeNull();
      expect(crossTiltedHeight).not.toBeNull();

      // Cross-track tilted cone should also reach further
      expect(crossTiltedHeight!).toBeGreaterThan(nadirHeight!);
    });

    it("should handle combined tilt", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      // Use smaller half-angle for combined tilt to stay within horizon
      const halfAngleDeg = 10;

      // Combined tilt magnitude = sqrt(20² + 20²) ≈ 28° + 10° half-angle = 38° from nadir
      const combinedHeight = computeTiltedConeHeight(pos, vel, 20, 20, halfAngleDeg, EARTH_RADIUS_KM);
      expect(combinedHeight).not.toBeNull();
      expect(combinedHeight!).toBeGreaterThan(0);
    });

    it("should fall back to axis when far edge misses Earth", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      // Large tilt where far edge misses but axis hits
      // Horizon angle is ~65°, so 50° tilt + 30° half-angle = 80° for far edge (misses)
      // But 50° tilt for axis should still hit Earth
      const height = computeTiltedConeHeight(pos, vel, 50, 0, 30, EARTH_RADIUS_KM);
      expect(height).not.toBeNull();
      expect(height!).toBeGreaterThan(0);
    });

    it("should fall back to near edge when both far edge and axis miss Earth", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      // Very large tilt where far edge and axis miss but near edge still hits
      // ~70° tilt: far edge at 100° misses, axis at 70° barely misses, near edge at 40° hits
      const height = computeTiltedConeHeight(pos, vel, 70, 0, 30, EARTH_RADIUS_KM);
      // Near edge should intersect, so we get a valid height
      expect(height).not.toBeNull();
      expect(height!).toBeGreaterThan(0);
    });

    it("should return null only when entire cone misses Earth", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };

      // Extreme tilt pointing away from Earth - entire cone misses
      const height = computeTiltedConeHeight(pos, vel, 120, 0, 10, EARTH_RADIUS_KM);
      expect(height).toBeNull();
    });

    it("should return null for degenerate position", () => {
      const height = computeTiltedConeHeight(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 7.5, z: 0 },
        0,
        0,
        30,
        EARTH_RADIUS_KM
      );
      expect(height).toBeNull();
    });

    it("should return consistent heights for symmetric tilts", () => {
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { x: 0, y: 7.5, z: 0 };
      const halfAngleDeg = 30;

      const forwardHeight = computeTiltedConeHeight(pos, vel, 30, 0, halfAngleDeg, EARTH_RADIUS_KM);
      const backwardHeight = computeTiltedConeHeight(pos, vel, -30, 0, halfAngleDeg, EARTH_RADIUS_KM);

      expect(forwardHeight).not.toBeNull();
      expect(backwardHeight).not.toBeNull();

      // Symmetric tilts should have the same height (different directions, same distance)
      expect(forwardHeight!).toBeCloseTo(backwardHeight!, 1);
    });
  });
});
