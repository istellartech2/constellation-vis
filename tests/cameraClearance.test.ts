import { describe, expect, it } from "bun:test";
import {
  ellipsoidRadiusToward,
  freeCameraNear,
  freeCameraZoomSpeed,
  groundClearanceScale,
  heightAboveGlobe,
  rideMinHeight,
} from "../src/lib/cameraClearance";
import { EARTH_FLATTENING } from "../src/lib/astronomy";

const RE_M = 6_378_137;

describe("camera ground clearance", () => {
  it("measures height above the flattened globe (scene +Y = pole)", () => {
    expect(ellipsoidRadiusToward({ x: 2, y: 0, z: 0 })).toBeCloseTo(1, 12);
    expect(ellipsoidRadiusToward({ x: 0, y: 3, z: 0 })).toBeCloseTo(EARTH_FLATTENING, 12);
    expect(heightAboveGlobe({ x: 0, y: 0, z: 1.1 })).toBeCloseTo(0.1, 12);
    // At the pole the surface is ~21 km lower than the equatorial radius.
    expect(heightAboveGlobe({ x: 0, y: 1, z: 0 }) * 6378.137).toBeCloseTo(21.385, 2);
    // 45° latitude direction: between the two radii.
    const r45 = ellipsoidRadiusToward({ x: 1, y: 1, z: 0 });
    expect(r45).toBeLessThan(1);
    expect(r45).toBeGreaterThan(EARTH_FLATTENING);
    expect(heightAboveGlobe({ x: 0.5, y: 0, z: 0 })).toBeCloseTo(-0.5, 12);
  });

  it("pushes a point radially out to the minimum height and leaves others alone", () => {
    const min = 50 / RE_M;
    // Below ground at the equator.
    const p = { x: 0.999, y: 0, z: 0 };
    const k = groundClearanceScale(p, min);
    expect(heightAboveGlobe({ x: p.x * k, y: 0, z: 0 }) * RE_M).toBeCloseTo(50, 6);
    // Inside the globe at the pole.
    const q = { x: 0, y: 0.5, z: 0 };
    const kq = groundClearanceScale(q, min);
    expect(heightAboveGlobe({ x: 0, y: q.y * kq, z: 0 }) * RE_M).toBeCloseTo(50, 6);
    // Direction unchanged (pure scaling), already clear → 1.
    expect(groundClearanceScale({ x: 0, y: 0, z: 3 }, min)).toBe(1);
    expect(groundClearanceScale({ x: 0, y: 0, z: 0 }, min)).toBe(1);
    // Idempotent: applying it twice changes nothing more.
    expect(groundClearanceScale({ x: p.x * k, y: 0, z: 0 }, min)).toBeCloseTo(1, 12);
  });

  it("keeps rides at least 50 m up, more when zoomed out", () => {
    expect(rideMinHeight(100 / RE_M, RE_M) * RE_M).toBeCloseTo(50, 6);
    expect(rideMinHeight(100_000 / RE_M, RE_M) * RE_M).toBeCloseTo(2000, 6);
  });

  it("adapts the free-camera near plane to the height", () => {
    // Default whole-globe view (r ≈ 3): the old fixed 0.1.
    expect(freeCameraNear(2, 3)).toBe(0.1);
    // 60 km up: well inside the height, so the surface below is never clipped.
    const h = 60 / 6378.137;
    const near = freeCameraNear(h, 1 + h);
    expect(near).toBeCloseTo(0.3 * h, 12);
    expect(near).toBeLessThan(h);
    // Never below 1e-6 or above half the height (when that is above 1e-6).
    expect(freeCameraNear(1e-9, 1)).toBe(1e-6);
    expect(freeCameraNear(0.01, 3)).toBeLessThanOrEqual(0.005);
  });

  it("slows the zoom near the surface", () => {
    expect(freeCameraZoomSpeed(2, 3)).toBe(1);
    expect(freeCameraZoomSpeed(0.01, 1.01)).toBeCloseTo(0.03, 6);
    expect(freeCameraZoomSpeed(0.1, 1.1)).toBeCloseTo(0.136, 3);
  });
});
