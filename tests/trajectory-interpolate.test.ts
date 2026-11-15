import { describe, expect, it } from "bun:test";
import { sampleTrajectoryPath, trajectoryStateAt } from "../src/lib/trajectory/interpolate";
import type { TrajectorySample, TrajectoryTrack } from "../src/lib/trajectory/types";

const T0 = Date.UTC(2026, 10, 15, 12);

function makeTrack(samples: TrajectorySample[]): TrajectoryTrack {
  return {
    id: "t",
    name: "t",
    color: "#fff",
    visible: true,
    sourceFrame: "ECEF",
    samples,
    events: [],
    attitudeRules: [],
  };
}

/** Curved, non-uniformly spaced track without velocities. */
function curvedTrack(): TrajectoryTrack {
  const times = [0, 1, 2.5, 3, 5, 8, 9, 12];
  return makeTrack(
    times.map((t) => ({
      timeMs: T0 + t * 1000,
      position: { x: 6500 * Math.cos(t * 0.05), y: 6500 * Math.sin(t * 0.05), z: 10 * t * t },
    })),
  );
}

describe("trajectoryStateAt", () => {
  it("is exact at sample times", () => {
    const track = curvedTrack();
    for (const s of track.samples) {
      const state = trajectoryStateAt(track, s.timeMs)!;
      expect(state.position.x).toBe(s.position.x);
      expect(state.position.y).toBe(s.position.y);
      expect(state.position.z).toBe(s.position.z);
    }
  });

  it("returns null outside the span", () => {
    const track = curvedTrack();
    expect(trajectoryStateAt(track, T0 - 1)).toBeNull();
    expect(trajectoryStateAt(track, T0 + 12_001)).toBeNull();
    expect(trajectoryStateAt(track, Number.NaN)).toBeNull();
  });

  it("is continuous in position and velocity across sample boundaries", () => {
    const track = curvedTrack();
    for (const s of track.samples.slice(1, -1)) {
      const before = trajectoryStateAt(track, s.timeMs - 1e-3)!;
      const after = trajectoryStateAt(track, s.timeMs + 1e-3)!;
      expect(Math.abs(before.position.x - after.position.x)).toBeLessThan(1e-3);
      expect(Math.abs(before.position.z - after.position.z)).toBeLessThan(1e-3);
      expect(Math.abs(before.velocity.y - after.velocity.y)).toBeLessThan(1e-4);
      expect(Math.abs(before.velocity.z - after.velocity.z)).toBeLessThan(1e-4);
    }
  });

  it("reproduces linear motion exactly, with and without sample velocities", () => {
    const v = { x: 1.5, y: -2, z: 0.25 };
    const p0 = { x: 6500, y: 100, z: 200 };
    const times = [0, 3, 4, 10];
    const at = (t: number) => ({ x: p0.x + v.x * t, y: p0.y + v.y * t, z: p0.z + v.z * t });
    for (const withVelocity of [false, true]) {
      const track = makeTrack(
        times.map((t) => ({ timeMs: T0 + t * 1000, position: at(t), ...(withVelocity ? { velocity: v } : {}) })),
      );
      for (const t of [0.5, 2.9, 3.5, 7.25, 10]) {
        const state = trajectoryStateAt(track, T0 + t * 1000)!;
        const expected = at(t);
        expect(state.position.x).toBeCloseTo(expected.x, 9);
        expect(state.position.y).toBeCloseTo(expected.y, 9);
        expect(state.position.z).toBeCloseTo(expected.z, 9);
        expect(state.velocity.x).toBeCloseTo(v.x, 9);
        expect(state.velocity.y).toBeCloseTo(v.y, 9);
        expect(state.velocity.z).toBeCloseTo(v.z, 9);
        expect(state.speedKmS).toBeCloseTo(Math.hypot(v.x, v.y, v.z), 9);
      }
    }
  });

  it("uses sample velocities as tangents", () => {
    const track = makeTrack([
      { timeMs: T0, position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 7, z: 0 } },
      { timeMs: T0 + 60_000, position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 7, z: 0 } },
    ]);
    expect(trajectoryStateAt(track, T0)!.velocity.y).toBeCloseTo(7, 12);
    expect(trajectoryStateAt(track, T0 + 60_000)!.velocity.y).toBeCloseTo(7, 12);
  });

  it("returns WGS84 geodetic coordinates", () => {
    // Point on the equator at 0° lon, 100 km up.
    const track = makeTrack([
      { timeMs: T0, position: { x: 6478.137, y: 0, z: 0 } },
      { timeMs: T0 + 1000, position: { x: 6478.137, y: 0, z: 0 } },
    ]);
    const state = trajectoryStateAt(track, T0 + 500)!;
    expect(state.latDeg).toBeCloseTo(0, 9);
    expect(state.lonDeg).toBeCloseTo(0, 9);
    expect(state.altKm).toBeCloseTo(100, 6);
    expect(state.speedKmS).toBe(0);
  });
});

describe("sampleTrajectoryPath", () => {
  it("includes every sample plus densified points with strictly increasing times", () => {
    const track = curvedTrack();
    const { timesMs, positions } = sampleTrajectoryPath(track, { maxStepMs: 500 });
    expect(positions.length).toBe(timesMs.length * 3);
    expect(timesMs[0]).toBe(T0);
    expect(timesMs[timesMs.length - 1]).toBe(T0 + 12_000);
    for (let i = 1; i < timesMs.length; i += 1) {
      expect(timesMs[i]).toBeGreaterThan(timesMs[i - 1]);
      expect(timesMs[i] - timesMs[i - 1]).toBeLessThanOrEqual(500 + 1e-6);
    }
    for (const s of track.samples) expect(Array.from(timesMs)).toContain(s.timeMs);
    const lastIndex = timesMs.length - 1;
    const last = track.samples[track.samples.length - 1].position;
    expect(positions[lastIndex * 3]).toBe(last.x);
    expect(positions[lastIndex * 3 + 2]).toBe(last.z);
  });

  it("refines curves by shape and leaves straight segments alone", () => {
    // Quarter circle of radius 7000 km sampled every 15° (one sample per 60 s), no velocities.
    const curve: TrajectorySample[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const a = (i * Math.PI) / 12;
      curve.push({ timeMs: T0 + i * 60_000, position: { x: 7000 * Math.cos(a), y: 7000 * Math.sin(a), z: 0 } });
    }
    const curved = sampleTrajectoryPath(makeTrack(curve));
    expect(curved.timesMs.length).toBeGreaterThan(200);
    // Every drawn point lies on the circle within ~a metre (the Hermite curve's own error aside).
    const mid = curved.timesMs.length >> 1;
    const r = Math.hypot(curved.positions[mid * 3], curved.positions[mid * 3 + 1]);
    expect(Math.abs(r - 7000)).toBeLessThan(5);
    const line: TrajectorySample[] = [];
    for (let i = 0; i <= 6; i += 1) line.push({ timeMs: T0 + i * 60_000, position: { x: 7000, y: i * 400, z: 0 } });
    expect(sampleTrajectoryPath(makeTrack(line)).timesMs.length).toBe(7);
  });

  it("keeps every source sample and relaxes the tolerance to fit maxPoints", () => {
    const curve: TrajectorySample[] = [];
    for (let i = 0; i <= 360; i += 1) {
      const a = (i * Math.PI) / 180;
      curve.push({ timeMs: T0 + i * 20_000, position: { x: 6650 * Math.cos(a), y: 6650 * Math.sin(a), z: 0 } });
    }
    const { timesMs } = sampleTrajectoryPath(makeTrack(curve), { maxPoints: 2000 });
    expect(timesMs.length).toBeLessThanOrEqual(2000);
    expect(timesMs.length).toBeGreaterThan(1000);
    const all = new Set(Array.from(timesMs));
    for (const s of curve) expect(all.has(s.timeMs)).toBe(true);
  });

  it("respects maxPoints when densifying", () => {
    const track = curvedTrack();
    const { timesMs } = sampleTrajectoryPath(track, { maxPoints: 20, maxStepMs: 10 });
    expect(timesMs.length).toBeLessThanOrEqual(20);
    expect(timesMs[0]).toBe(T0);
    expect(timesMs[timesMs.length - 1]).toBe(T0 + 12_000);
  });

  it("decimates long tables to maxPoints keeping both endpoints", () => {
    const samples: TrajectorySample[] = [];
    for (let i = 0; i < 1000; i += 1) samples.push({ timeMs: T0 + i * 1000, position: { x: 7000, y: i, z: 0 } });
    const { timesMs, positions } = sampleTrajectoryPath(makeTrack(samples), { maxPoints: 50 });
    expect(timesMs.length).toBe(50);
    expect(timesMs[0]).toBe(T0);
    expect(timesMs[49]).toBe(T0 + 999_000);
    expect(positions[49 * 3 + 1]).toBe(999);
    for (let i = 1; i < timesMs.length; i += 1) expect(timesMs[i]).toBeGreaterThan(timesMs[i - 1]);
  });
});
