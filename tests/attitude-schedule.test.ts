import { describe, it, expect } from "bun:test";
import * as satellite from "satellite.js";
import {
  attitudeStateProviderFromSatrec,
  hasAttitudeSchedule,
  isPlainLvlhAttitude,
  isPlainLvlhContext,
  prepareAttitudeContext,
  quaternionAngle,
  reconcileAttitudeStation,
  rotateBodyToEci,
  satelliteAttitudeEci,
  satelliteAttitudeFromContext,
  satelliteAttitudeStateFromContext,
  type AttitudeStateProvider,
} from "../src/lib/attitude/satelliteAttitude";
import { activeAttitudeLabel, attitudeScheduleSummary, sanitizeSatelliteAttitude, validateSatelliteAttitude } from "../src/lib/attitude/settings";
import { DEFAULT_SATELLITE_ATTITUDE, type AttitudeVec3, type SatelliteAttitudeSettings } from "../src/lib/attitude/types";
import { isInEarthShadow } from "../src/lib/satelliteDerivedInfo";
import { sunVectorECI } from "../src/lib/astronomy";
import type { GroundStation } from "../src/lib/groundStations";

const TLE: [string, string] = [
  "1 25544U 98067A   24001.50000000  .00000000  00000-0  00000-0 0  9991",
  "2 25544  51.6400 120.0000 0005000  90.0000  10.0000 15.50000000    04",
];
const REC = satellite.twoline2satrec(TLE[0], TLE[1]);
const STATE_AT: AttitudeStateProvider = attitudeStateProviderFromSatrec(REC);
const T0 = Date.UTC(2024, 0, 1, 12, 0, 0);
const lvlh = DEFAULT_SATELLITE_ATTITUDE;
const Z = { x: 0, y: 0, z: 1 };

function stateAt(ms: number) {
  const s = STATE_AT(ms);
  if (!s) throw new Error("propagation failed");
  return s;
}
function attitudeAt(ms: number, settings: SatelliteAttitudeSettings, stations: readonly GroundStation[] = [], withSlew = true) {
  const s = stateAt(ms);
  return satelliteAttitudeStateFromContext(
    s.position,
    s.velocity,
    prepareAttitudeContext(new Date(ms), settings, stations),
    withSlew ? STATE_AT : undefined,
  );
}
/** Instant (no slew) single-law attitude of `mode` at `ms`. */
function lawAt(ms: number, mode: SatelliteAttitudeSettings["mode"]) {
  const s = stateAt(ms);
  return satelliteAttitudeEci(s.position, s.velocity, new Date(ms), { ...lvlh, mode }, []);
}
/** First shadow entry after `from` to 1 ms, with the app's own shadow test. */
function shadowEntry(from: number): number {
  let lo = from;
  while (isInEarthShadow(stateAt(lo).position, new Date(lo))) lo += 60_000;
  let hi = lo;
  while (!isInEarthShadow(stateAt(hi).position, new Date(hi))) {
    lo = hi;
    hi += 60_000;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (isInEarthShadow(stateAt(mid).position, new Date(mid))) hi = mid;
    else lo = mid;
  }
  return hi;
}
const deg = (rad: number) => (rad * 180) / Math.PI;

describe("運用スケジュール: priority", () => {
  // Satellite on the anti-Sun line (umbra) straight above a station.
  const date = new Date(T0);
  const sun = sunVectorECI(date);
  const n = Math.hypot(sun.x, sun.y, sun.z);
  const pos: AttitudeVec3 = { x: (-sun.x / n) * 7000, y: (-sun.y / n) * 7000, z: (-sun.z / n) * 7000 };
  const vel: AttitudeVec3 = { x: -pos.y / 1000, y: pos.x / 1000, z: 1 };
  const geo = satellite.eciToGeodetic(pos, satellite.gstime(date));
  const station: GroundStation = {
    name: "Below",
    latitudeDeg: satellite.degreesLat(geo.latitude),
    longitudeDeg: satellite.degreesLong(geo.longitude),
    heightKm: 0,
    minElevationDeg: 10,
  };
  const far: AttitudeVec3 = { x: -pos.x, y: -pos.y, z: -pos.z };
  const state = (p: AttitudeVec3, settings: SatelliteAttitudeSettings) =>
    satelliteAttitudeStateFromContext(p, vel, prepareAttitudeContext(date, settings, [station]));

  it("station pass beats eclipse beats the base mode", () => {
    expect(isInEarthShadow(pos, date)).toBe(true);
    const all: SatelliteAttitudeSettings = { ...lvlh, mode: "sun", eclipseMode: "inertial", trackStationDuringPass: true, stationName: "Below" };
    const pass = state(pos, all);
    expect(pass.reason).toBe("pass");
    expect(pass.mode).toBe("station");
    // Straight overhead: +Z at (geodetic ≈) nadir.
    const z = rotateBodyToEci(pass.q, Z);
    expect(z.x * pos.x + z.y * pos.y + z.z * pos.z).toBeLessThan(-6999.9);

    const eclipse = state(pos, { ...all, trackStationDuringPass: false });
    expect(eclipse.reason).toBe("eclipse");
    expect(eclipse.mode).toBe("inertial");
    expect(eclipse.q).toEqual(satelliteAttitudeEci(pos, vel, date, { ...lvlh, mode: "inertial" }, []));

    // Sunlit and the station below the horizon: the base mode.
    expect(isInEarthShadow(far, date)).toBe(false);
    const base = state(far, all);
    expect(base.reason).toBe("base");
    expect(base.q).toEqual(satelliteAttitudeEci(far, vel, date, { ...lvlh, mode: "sun" }, []));
  });

  it("pass beats eclipse even when the base mode is 地上局指向", () => {
    const s: SatelliteAttitudeSettings = { ...lvlh, mode: "station", stationName: "Below", eclipseMode: "sun", trackStationDuringPass: true };
    expect(state(pos, s).reason).toBe("pass");
    // Without the flag the eclipse mode wins over base 地上局指向.
    expect(state(pos, { ...s, trackStationDuringPass: false }).reason).toBe("eclipse");
  });

  it("labels the active mode and why", () => {
    expect(activeAttitudeLabel({ mode: "station", reason: "pass", slew: null })).toBe("地上局指向（通過中）");
    expect(activeAttitudeLabel({ mode: "lvlh", reason: "eclipse", slew: null })).toBe("地球指向（日陰）");
    expect(activeAttitudeLabel({ mode: "lvlh", reason: "base", slew: { toMode: "sun" } })).toBe("切替中 → 太陽指向");
    expect(activeAttitudeLabel({ mode: "yawSteering", reason: "base", slew: null })).toBe("ヨー制御");
  });

  it("ignores pass tracking when the station is missing", () => {
    const s: SatelliteAttitudeSettings = { ...lvlh, trackStationDuringPass: true, stationName: "Gone" };
    expect(hasAttitudeSchedule(s, [station])).toBe(false);
    expect(isPlainLvlhAttitude(s, [station])).toBe(true);
    expect(isPlainLvlhAttitude({ ...s, stationName: "Below" }, [station])).toBe(false);
  });
});

describe("運用スケジュール: eclipse switch (instant)", () => {
  const settings: SatelliteAttitudeSettings = { ...lvlh, eclipseMode: "sun" };
  const te = shadowEntry(T0);

  it("switches at the app's shadow boundary", () => {
    const before = attitudeAt(te - 50, settings);
    const after = attitudeAt(te + 50, settings);
    expect(before.reason).toBe("base");
    expect(before.q).toEqual(lawAt(te - 50, "lvlh"));
    expect(after.reason).toBe("eclipse");
    expect(after.q).toEqual(lawAt(te + 50, "sun"));
    expect(after.slew).toBeNull();
  });

  it("lvlh base with an eclipse mode is not the plain LVLH path", () => {
    expect(isPlainLvlhAttitude(settings, [])).toBe(false);
    expect(isPlainLvlhContext(prepareAttitudeContext(new Date(te), settings, []))).toBe(false);
    // Eclipse mode equal to the base is a no-op.
    expect(isPlainLvlhAttitude({ ...lvlh, eclipseMode: "lvlh" }, [])).toBe(true);
  });
});

describe("運用スケジュール: slew limit", () => {
  const rate = 1;
  const settings: SatelliteAttitudeSettings = { ...lvlh, eclipseMode: "sun", maxSlewRateDegS: rate };
  const te = shadowEntry(T0);
  const angleDeg = deg(quaternionAngle(lawAt(te, "lvlh"), lawAt(te, "sun")));
  const durationMs = (angleDeg / rate) * 1000;

  it("finds the switch time to ~0.1 s and the duration from the angle", () => {
    const s = attitudeAt(te + 5_000, settings);
    expect(s.slew).not.toBeNull();
    expect(Math.abs(s.slew!.switchMs - te)).toBeLessThan(150);
    expect(s.slew!.angleDeg).toBeCloseTo(angleDeg, 0);
    expect(s.slew!.fromMode).toBe("lvlh");
    expect(s.slew!.toMode).toBe("sun");
    expect(5 + s.slew!.remainingS).toBeCloseTo(durationMs / 1000, 0);
  });

  it("is halfway between the two laws at the midpoint", () => {
    const ms = Math.round(te + durationMs / 2);
    const s = attitudeAt(ms, settings);
    expect(s.slew!.progress).toBeCloseTo(0.5, 2);
    const a = quaternionAngle(s.q, lawAt(ms, "lvlh"));
    const b = quaternionAngle(s.q, lawAt(ms, "sun"));
    const total = quaternionAngle(lawAt(ms, "lvlh"), lawAt(ms, "sun"));
    expect(a + b).toBeCloseTo(total, 6);
    expect(a / total).toBeCloseTo(0.5, 2);
  });

  it("ends on the new law and starts from the old one", () => {
    const end = attitudeAt(Math.round(te + durationMs + 1_000), settings);
    expect(end.slew).toBeNull();
    expect(end.q).toEqual(lawAt(Math.round(te + durationMs + 1_000), "sun"));
    const start = attitudeAt(te + 200, settings);
    expect(deg(quaternionAngle(start.q, lawAt(te + 200, "lvlh")))).toBeLessThan(0.5);
    const before = attitudeAt(te - 1_000, settings);
    expect(before.q).toEqual(lawAt(te - 1_000, "lvlh"));
  });

  it("is a pure function of time (scrubbing is exact)", () => {
    const times = [te + 30_000, te - 20_000, te + 3_000, te + 30_000, te + 3_000];
    const seen = new Map<number, unknown>();
    for (const ms of times) {
      const q = attitudeAt(ms, settings).q;
      if (seen.has(ms)) expect(q).toEqual(seen.get(ms) as typeof q);
      else seen.set(ms, { ...q });
    }
    // A shared context (as in a frame loop) gives the same as a fresh one.
    const ms = te + 12_345;
    const ctx = prepareAttitudeContext(new Date(ms), settings, []);
    const s = stateAt(ms);
    const shared1 = satelliteAttitudeFromContext(s.position, s.velocity, ctx, undefined, STATE_AT);
    const shared2 = satelliteAttitudeFromContext(s.position, s.velocity, ctx, undefined, STATE_AT);
    expect(shared1).toEqual(shared2);
    expect(shared1).toEqual(attitudeAt(ms, settings).q);
  });

  it("without a state provider switches are instant", () => {
    expect(attitudeAt(te + 5_000, settings, [], false).q).toEqual(lawAt(te + 5_000, "sun"));
  });

  it("turns the yaw-steering flip about body +Z", () => {
    const yaw: SatelliteAttitudeSettings = { ...lvlh, mode: "yawSteering", maxSlewRateDegS: rate };
    // Find a flip: the instant law's +X reverses between two 10 s samples.
    const x = (ms: number) => rotateBodyToEci(attitudeAt(ms, yaw, [], false).q, { x: 1, y: 0, z: 0 });
    let flip = -1;
    for (let ms = T0; ms < T0 + 6_000_000; ms += 10_000) {
      const a = x(ms);
      const b = x(ms + 10_000);
      if (a.x * b.x + a.y * b.y + a.z * b.z < -0.5) {
        flip = ms + 10_000;
        break;
      }
    }
    expect(flip).toBeGreaterThan(0);
    const ms = flip + 60_000;
    const s = attitudeAt(ms, yaw);
    expect(s.slew).not.toBeNull();
    expect(s.slew!.angleDeg).toBeCloseTo(180, 6);
    // Still nadir-pointing mid-flip.
    const st = stateAt(ms);
    const r = Math.hypot(st.position.x, st.position.y, st.position.z);
    const z = rotateBodyToEci(s.q, Z);
    expect((z.x * st.position.x + z.y * st.position.y + z.z * st.position.z) / r).toBeCloseTo(-1, 9);
  });
});

describe("運用スケジュール: no scheduling keeps the single-law path", () => {
  const ms = T0 + 1_234_567;
  const s = stateAt(ms);
  for (const mode of ["lvlh", "sun", "inertial"] as const) {
    it(`${mode}: a slew rate alone changes nothing`, () => {
      const plain: SatelliteAttitudeSettings = { ...lvlh, mode, inertialRaDeg: 30, inertialDecDeg: 10 };
      const ctx = prepareAttitudeContext(new Date(ms), { ...plain, maxSlewRateDegS: 2 }, []);
      expect(ctx.schedule).toBeNull();
      expect(satelliteAttitudeFromContext(s.position, s.velocity, ctx, undefined, STATE_AT)).toEqual(
        satelliteAttitudeEci(s.position, s.velocity, new Date(ms), plain, []),
      );
    });
  }
  it("plain settings have no schedule", () => {
    expect(prepareAttitudeContext(new Date(ms), lvlh, []).schedule).toBeNull();
    expect(isPlainLvlhAttitude(lvlh, [])).toBe(true);
    expect(hasAttitudeSchedule({ ...lvlh, mode: "yawSteering", maxSlewRateDegS: 1 }, [])).toBe(true);
  });
});

describe("運用スケジュール: settings", () => {
  const gs: GroundStation = { name: "A", latitudeDeg: 0, longitudeDeg: 0, heightKm: 0, minElevationDeg: 5 };
  it("reconcile keeps / fills the station for pass tracking and eclipse 地上局指向", () => {
    const s: SatelliteAttitudeSettings = { ...lvlh, trackStationDuringPass: true, stationName: "Gone" };
    expect(reconcileAttitudeStation(s, [gs])).toBe(s);
    expect(reconcileAttitudeStation({ ...lvlh, trackStationDuringPass: true }, [gs]).stationName).toBe("A");
    expect(reconcileAttitudeStation({ ...lvlh, eclipseMode: "station" }, [gs]).stationName).toBe("A");
  });

  it("validates and omits unset schedule fields", () => {
    expect(validateSatelliteAttitude({ mode: "sun", trackStationDuringPass: false, maxSlewRateDegS: 0 })).toEqual({
      mode: "sun",
      inertialRaDeg: 0,
      inertialDecDeg: 0,
    });
    expect(validateSatelliteAttitude({ mode: "sun", eclipseMode: "lvlh", trackStationDuringPass: true, maxSlewRateDegS: 1.5 })).toEqual({
      mode: "sun",
      inertialRaDeg: 0,
      inertialDecDeg: 0,
      eclipseMode: "lvlh",
      trackStationDuringPass: true,
      maxSlewRateDegS: 1.5,
    });
    expect(() => validateSatelliteAttitude({ mode: "sun", eclipseMode: "spin" })).toThrow("eclipseMode");
    expect(() => validateSatelliteAttitude({ mode: "sun", trackStationDuringPass: "yes" })).toThrow("trackStationDuringPass");
    expect(() => validateSatelliteAttitude({ mode: "sun", maxSlewRateDegS: -1 })).toThrow("maxSlewRateDegS");
    expect(() => validateSatelliteAttitude({ mode: "sun", maxSlewRateDegS: 500 })).toThrow("maxSlewRateDegS");
  });

  it("stored views drop only the damaged schedule field", () => {
    expect(sanitizeSatelliteAttitude({ mode: "sun", eclipseMode: "lvlh", maxSlewRateDegS: -3 })).toEqual({
      mode: "sun",
      inertialRaDeg: 0,
      inertialDecDeg: 0,
      eclipseMode: "lvlh",
    });
    expect(sanitizeSatelliteAttitude({ mode: "spin", eclipseMode: "lvlh" })).toBeNull();
  });

  it("summarises the schedule in one line", () => {
    expect(attitudeScheduleSummary({ ...lvlh, mode: "sun", trackStationDuringPass: true, eclipseMode: "lvlh", maxSlewRateDegS: 1 })).toBe(
      "基本: 太陽指向 · 地上局通過中: 地上局指向 · 日陰: 地球指向 · 最大 1.0°/s",
    );
    expect(attitudeScheduleSummary(lvlh)).toBe("基本: 地球指向 · 切替なし");
  });
});
