import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { enuAnglesToQuaternion, trajectoryAttitudeAt } from "../src/lib/trajectory/attitude";
import { trajectoryStateAt } from "../src/lib/trajectory/interpolate";
import type { AttitudeRule, BodyQuaternion, TrajectorySample, TrajectoryState, TrajectoryTrack } from "../src/lib/trajectory/types";

const T0 = Date.UTC(2026, 10, 15, 18);
const R = 6378.137;

function makeTrack(samples: TrajectorySample[], attitudeRules: AttitudeRule[] = []): TrajectoryTrack {
  return { id: "t", name: "t", color: "#fff", visible: true, sourceFrame: "ECEF", samples, events: [], attitudeRules };
}

/** Eastward flight along the equator from lon 0 to lon ~0.9°. */
const eastTrack = makeTrack([
  { timeMs: T0, position: { x: R, y: 0, z: 0 } },
  { timeMs: T0 + 100_000, position: { x: R, y: 100, z: 0 } },
]);

function state(position: [number, number, number], velocityKmS: [number, number, number], latDeg = 0, lonDeg = 0): TrajectoryState {
  const [vx, vy, vz] = velocityKmS;
  return {
    timeMs: T0,
    position: { x: position[0], y: position[1], z: position[2] },
    velocity: { x: vx, y: vy, z: vz },
    latDeg,
    lonDeg,
    altKm: 0,
    speedKmS: Math.hypot(vx, vy, vz),
  };
}

function axis(q: BodyQuaternion, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
}
const nose = (q: BodyQuaternion) => axis(q, 1, 0, 0);
const belly = (q: BodyQuaternion) => axis(q, 0, 0, 1);

function expectVec(v: THREE.Vector3, x: number, y: number, z: number, digits = 6) {
  expect(v.x).toBeCloseTo(x, digits);
  expect(v.y).toBeCloseTo(y, digits);
  expect(v.z).toBeCloseTo(z, digits);
}

const EAST_FAST = state([R, 0, 0], [0, 7, 0]);

describe("trajectoryAttitudeAt rules", () => {
  it("vertical at the equator, lon 0 points the nose along ECEF +X", () => {
    const track = { ...eastTrack, attitudeRules: [{ timeMs: T0 - 1, mode: "vertical" as const }] };
    const q = trajectoryAttitudeAt(track, T0, EAST_FAST)!;
    expectVec(nose(q), 1, 0, 0);
    // Belly toward downrange (east) when vertical.
    expectVec(belly(q), 0, 1, 0);
  });

  it("uses the geodetic (not geocentric) normal for vertical", () => {
    const track = { ...eastTrack, attitudeRules: [{ timeMs: T0 - 1, mode: "vertical" as const }] };
    const q = trajectoryAttitudeAt(track, T0, state([4000, 0, 4000], [0, 0, 0], 45, 0))!;
    expectVec(nose(q), Math.SQRT1_2, 0, Math.SQRT1_2);
  });

  it("prograde with eastward velocity points the nose along ECEF +Y, belly down", () => {
    const q = trajectoryAttitudeAt(eastTrack, T0, EAST_FAST)!;
    expectVec(nose(q), 0, 1, 0, 3);
    expectVec(belly(q), -1, 0, 0, 3);
  });

  it("retrograde points the nose against the velocity", () => {
    const track = { ...eastTrack, attitudeRules: [{ timeMs: T0 - 1, mode: "retrograde" as const }] };
    const q = trajectoryAttitudeAt(track, T0, EAST_FAST)!;
    expectVec(nose(q), 0, -1, 0, 3);
  });

  it("aoa 90 with horizontal flight is vertical, belly into the flow", () => {
    const track = { ...eastTrack, attitudeRules: [{ timeMs: T0 - 1, mode: "aoa" as const, aoaDeg: 90 }] };
    const q = trajectoryAttitudeAt(track, T0, EAST_FAST)!;
    expectVec(nose(q), 1, 0, 0);
    expectVec(belly(q), 0, 1, 0);
  });

  it("aoa 70 pitches the nose 70° above the velocity", () => {
    const track = { ...eastTrack, attitudeRules: [{ timeMs: T0 - 1, mode: "aoa" as const, aoaDeg: 70 }] };
    const q = trajectoryAttitudeAt(track, T0, EAST_FAST)!;
    const n = nose(q);
    expect(n.angleTo(new THREE.Vector3(0, 1, 0)) * (180 / Math.PI)).toBeCloseTo(70, 6);
    expect(n.x).toBeGreaterThan(0.9);
  });

  it("stands vertical at low speed in the default (prograde) mode, without NaN at rest", () => {
    const q = trajectoryAttitudeAt(eastTrack, T0, state([R, 0, 0], [0, 0, 0]))!;
    expectVec(nose(q), 1, 0, 0);
    const slow = trajectoryAttitudeAt(eastTrack, T0, state([R, 0, 0], [0, 0.02, 0]))!;
    expectVec(nose(slow), 1, 0, 0);
    const fast = trajectoryAttitudeAt(eastTrack, T0, state([R, 0, 0], [0, 0.2, 0]))!;
    expectVec(nose(fast), 0, 1, 0, 3);
  });

  it("blends a rule change over its transition", () => {
    const rules: AttitudeRule[] = [
      { timeMs: T0, mode: "prograde" },
      { timeMs: T0 + 10_000, mode: "retrograde", transitionS: 10 },
    ];
    const track = { ...eastTrack, attitudeRules: rules };
    const before = nose(trajectoryAttitudeAt(track, T0 + 10_000, EAST_FAST)!);
    const mid = nose(trajectoryAttitudeAt(track, T0 + 15_000, EAST_FAST)!);
    const after = nose(trajectoryAttitudeAt(track, T0 + 20_000, EAST_FAST)!);
    expectVec(before, 0, 1, 0, 3);
    expectVec(after, 0, -1, 0, 3);
    // Halfway through a 180° flip the nose is perpendicular to both ends.
    expect(mid.dot(before)).toBeCloseTo(0, 3);
    expect(Math.abs(mid.y)).toBeLessThan(1e-3);
  });

  it("has no roll jump as the nose pitches through vertical-ish angles", () => {
    // Velocity tilting from vertical (up = +X) toward east (+Y).
    let prev: THREE.Vector3 | null = null;
    for (let deg = 0; deg <= 30; deg += 0.25) {
      const a = (deg * Math.PI) / 180;
      const q = trajectoryAttitudeAt(eastTrack, T0, state([R, 0, 0], [Math.cos(a), Math.sin(a), 0]))!;
      const b = belly(q);
      if (prev) expect(b.angleTo(prev)).toBeLessThan(0.05);
      prev = b;
    }
  });

  it("returns unit quaternions", () => {
    const track = {
      ...eastTrack,
      attitudeRules: [
        { timeMs: T0, mode: "aoa" as const, aoaDeg: 35 },
        { timeMs: T0 + 3000, mode: "retrograde" as const },
      ],
    };
    for (let t = 0; t <= 100_000; t += 1000) {
      const s = trajectoryStateAt(track, T0 + t)!;
      const q = trajectoryAttitudeAt(track, T0 + t, s)!;
      expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 9);
    }
  });
});

describe("tabulated attitude", () => {
  it("slerps between bracketing samples along the shortest path", () => {
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    // Same rotation with flipped sign: slerp must still take the 45° path.
    const track = makeTrack([
      { timeMs: T0, position: { x: R, y: 0, z: 0 }, attitude: { w: qa.w, x: qa.x, y: qa.y, z: qa.z } },
      { timeMs: T0 + 10_000, position: { x: R, y: 10, z: 0 }, attitude: { w: -qb.w, x: -qb.x, y: -qb.y, z: -qb.z } },
    ]);
    const s = trajectoryStateAt(track, T0 + 5000)!;
    const q = trajectoryAttitudeAt(track, T0 + 5000, s)!;
    const n = nose(q);
    expectVec(n, Math.SQRT1_2, Math.SQRT1_2, 0);
    expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 9);
  });
});

describe("enuAnglesToQuaternion", () => {
  it("maps azimuth/elevation to ENU nose, belly down at zero roll", () => {
    const q = new THREE.Quaternion();
    enuAnglesToQuaternion(90, 0, 0, q);
    const n = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const b = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expectVec(n, 1, 0, 0);
    expectVec(b, 0, 0, -1);
    enuAnglesToQuaternion(0, 90, 0, q);
    expectVec(new THREE.Vector3(1, 0, 0).applyQuaternion(q), 0, 0, 1);
    // Vertical: belly toward the azimuth (north).
    expectVec(new THREE.Vector3(0, 0, 1).applyQuaternion(q), 0, 1, 0);
    // Roll +90° about the nose (east, level): belly rotates from down to north.
    enuAnglesToQuaternion(90, 0, 90, q);
    expectVec(new THREE.Vector3(0, 0, 1).applyQuaternion(q), 0, 1, 0);
  });
});
