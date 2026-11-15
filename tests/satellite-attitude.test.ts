import { describe, it, expect } from "bun:test";
import * as satellite from "satellite.js";
import * as THREE from "three";
import {
  effectiveAttitudeMode,
  prepareAttitudeContext,
  reconcileAttitudeStation,
  rotateBodyToEci,
  satelliteAttitudeEci,
  satelliteAttitudeFromContext,
  sensorBoresightEci,
  solarArrayIncidence,
  type AttitudeTimeContext,
} from "../src/lib/attitude/satelliteAttitude";
import {
  DEFAULT_SATELLITE_ATTITUDE,
  type AttitudeQuaternion,
  type AttitudeVec3,
  type SatelliteAttitudeSettings,
} from "../src/lib/attitude/types";
import {
  boresightPointsAtEarth,
  computeConeHeightForBoresight,
  computeFovConeQuaternion,
  computeSensorDirectionEci,
  computeTiltedConeHeight,
  fovConeQuaternionForAttitude,
} from "../src/lib/orbitalCoordinates";
import { calculateStationAccessData, computeFovBoresightEcf } from "../src/lib/visibility";
import { computeAccessGrid } from "../src/lib/accessGrid";
import { sunVectorECI } from "../src/lib/astronomy";
import type { GroundStation } from "../src/lib/groundStations";
import { parseConstellationToml } from "../src/lib/config";

const DATE = new Date("2026-03-20T12:00:00Z");
const CIRC = { pos: { x: 4000, y: -3500, z: 4200 }, vel: { x: 3.1, y: 6.2, z: -0.4 } };
const ECC = { pos: { x: -9000, y: 12000, z: 3000 }, vel: { x: -3.9, y: -1.2, z: 2.6 } };

const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };

const axes = (q: AttitudeQuaternion) => ({ x: rotateBodyToEci(q, X), y: rotateBodyToEci(q, Y), z: rotateBodyToEci(q, Z) });
const dot = (a: AttitudeVec3, b: AttitudeVec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: AttitudeVec3) => {
  const n = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
const cross = (a: AttitudeVec3, b: AttitudeVec3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const neg = (a: AttitudeVec3) => ({ x: -a.x, y: -a.y, z: -a.z });
function expectVec(a: AttitudeVec3, b: AttitudeVec3, digits = 12) {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
}
/** LVLH +X as the legacy code builds it: W × R̂, W = unit(R̂ × V̂). */
function lvlhX(pos: AttitudeVec3, vel: AttitudeVec3) {
  const r = unit(pos);
  const w = unit(cross(r, unit(vel)));
  return unit(cross(w, r));
}
function ctx(mode: SatelliteAttitudeSettings["mode"], patch: Partial<AttitudeTimeContext> = {}): AttitudeTimeContext {
  return { mode, gmst: 0, sunEci: null, station: null, inertialZ: null, ...patch };
}
function expectOrthonormal(q: AttitudeQuaternion) {
  const a = axes(q);
  expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 12);
  expect(dot(a.x, a.y)).toBeCloseTo(0, 12);
  expectVec(cross(a.z, a.x), a.y);
}

const lvlh = DEFAULT_SATELLITE_ATTITUDE;

describe("地球指向 (lvlh)", () => {
  for (const [name, s] of Object.entries({ circular: CIRC, eccentric: ECC })) {
    it(`matches the legacy sensor direction on the ${name} orbit`, () => {
      const q = satelliteAttitudeEci(s.pos, s.vel, DATE, lvlh, []);
      expectOrthonormal(q);
      const a = axes(q);
      expectVec(a.z, neg(unit(s.pos)));
      expectVec(a.x, lvlhX(s.pos, s.vel));
      for (const [al, cr] of [[0, 0], [15, -20], [-30, 45], [60, 60]]) {
        const legacy = computeSensorDirectionEci(s.pos, s.vel, al, cr)!;
        expectVec(sensorBoresightEci(q, al, cr), legacy);
      }
    });
  }

  it("falls back to celestial north for +X without a usable velocity", () => {
    const q = satelliteAttitudeEci(CIRC.pos, { x: 0, y: 0, z: 0 }, DATE, lvlh, []);
    expectOrthonormal(q);
    expect(dot(axes(q).x, Z)).toBeGreaterThan(0);
  });
});

describe("地球指向＋ヨー制御 (yawSteering)", () => {
  it("keeps nadir and puts the Sun in the X–Z plane (panel axis ⟂ Sun)", () => {
    const sun = unit({ x: 0.3, y: -0.8, z: 0.5 });
    const q = satelliteAttitudeFromContext(CIRC.pos, CIRC.vel, ctx("yawSteering", { sunEci: sun }));
    expectOrthonormal(q);
    const a = axes(q);
    expectVec(a.z, neg(unit(CIRC.pos)));
    expect(dot(a.y, sun)).toBeCloseTo(0, 12);
    // Closest-to-zero-yaw solution: +X on the velocity side.
    expect(dot(a.x, lvlhX(CIRC.pos, CIRC.vel))).toBeGreaterThanOrEqual(0);
  });

  it("chooses the solution nearer zero yaw when the Sun is behind", () => {
    const vx = lvlhX(CIRC.pos, CIRC.vel);
    // Sun mostly against the velocity: the +X = +ŝ⊥ solution would be ~180° yaw.
    const sun = unit({ x: -vx.x + 0.1, y: -vx.y, z: -vx.z + 0.05 });
    const a = axes(satelliteAttitudeFromContext(CIRC.pos, CIRC.vel, ctx("yawSteering", { sunEci: sun })));
    expect(dot(a.x, vx)).toBeGreaterThan(0.9);
    expect(dot(a.y, sun)).toBeCloseTo(0, 12);
  });

  it("is LVLH (zero yaw) when the Sun is along ±Z", () => {
    const ref = satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, lvlh, []);
    for (const sun of [unit(CIRC.pos), neg(unit(CIRC.pos))]) {
      const q = satelliteAttitudeFromContext(CIRC.pos, CIRC.vel, ctx("yawSteering", { sunEci: sun }));
      expect(q).toEqual(ref);
    }
  });
});

describe("太陽指向 (sun)", () => {
  it("points the panel normal (−Z) at the Sun with +X near the velocity", () => {
    const sun = sunVectorECI(DATE);
    const q = satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, { ...lvlh, mode: "sun" }, []);
    expectOrthonormal(q);
    const a = axes(q);
    expectVec(neg(a.z), sun);
    // +X is the projection of the LVLH +X: maximal X·vx among frames with this Z.
    const vx = lvlhX(CIRC.pos, CIRC.vel);
    const proj = unit({ x: vx.x - dot(vx, a.z) * a.z.x, y: vx.y - dot(vx, a.z) * a.z.y, z: vx.z - dot(vx, a.z) * a.z.z });
    expectVec(a.x, proj);
  });

  it("uses the orbit normal (+Y = −orbit normal) when the velocity is along the Sun line", () => {
    const vx = lvlhX(CIRC.pos, CIRC.vel);
    const w = unit(cross(unit(CIRC.pos), unit(CIRC.vel)));
    const a = axes(satelliteAttitudeFromContext(CIRC.pos, CIRC.vel, ctx("sun", { sunEci: vx })));
    expectVec(neg(a.z), vx);
    expectVec(a.y, neg(w));
  });

  it("puts the sensor off the Earth (access goes to ~0)", () => {
    const pos = { x: 7000, y: 0, z: 0 };
    const vel = { x: 0, y: 7.5, z: 0 };
    // Sun on the far side of the satellite from the Earth: +Z (anti-Sun) points at the Earth...
    const qBack = satelliteAttitudeFromContext(pos, vel, ctx("sun", { sunEci: { x: 1, y: 0, z: 0 } }));
    expect(boresightPointsAtEarth(pos, sensorBoresightEci(qBack, 0, 0), 6378.137)).toBe(true);
    // ...but with the Sun behind the Earth the sensor faces space.
    const q = satelliteAttitudeFromContext(pos, vel, ctx("sun", { sunEci: { x: -1, y: 0, z: 0 } }));
    expect(boresightPointsAtEarth(pos, sensorBoresightEci(q, 0, 0), 6378.137)).toBe(false);
  });
});

describe("慣性指向 (inertial)", () => {
  it("points +Z at RA/Dec with +X toward celestial north", () => {
    const settings: SatelliteAttitudeSettings = { mode: "inertial", inertialRaDeg: 83.6, inertialDecDeg: 22 };
    const q = satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, settings, []);
    expectOrthonormal(q);
    const a = axes(q);
    const ra = (83.6 * Math.PI) / 180;
    const dec = (22 * Math.PI) / 180;
    expectVec(a.z, { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) });
    expect(a.x.z).toBeCloseTo(Math.cos(dec), 12);
    // Independent of the orbit state.
    expect(satelliteAttitudeEci(ECC.pos, ECC.vel, DATE, settings, [])).toEqual(q);
  });

  it("uses ECI +X as the roll reference at the celestial poles", () => {
    for (const dec of [90, -90]) {
      const a = axes(satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, { mode: "inertial", inertialRaDeg: 40, inertialDecDeg: dec }, []));
      expectVec(a.z, { x: 0, y: 0, z: Math.sign(dec) });
      expectVec(a.x, X);
    }
  });
});

describe("地上局指向 (station)", () => {
  const station: GroundStation = { name: "Tokyo", latitudeDeg: 35.7, longitudeDeg: 139.7, heightKm: 0.04, minElevationDeg: 10 };
  const settings: SatelliteAttitudeSettings = { ...lvlh, mode: "station", stationName: "Tokyo" };
  const gmst = satellite.gstime(DATE);
  const stEcf = satellite.geodeticToEcf({ latitude: (35.7 * Math.PI) / 180, longitude: (139.7 * Math.PI) / 180, height: 0.04 });
  const stEci = satellite.ecfToEci(stEcf, gmst);
  const up = unit(stEci);
  /** A satellite seen from the station at elevation `elDeg` (azimuth toward ECI north-ish), 700 km slant range. */
  function satAtElevation(elDeg: number) {
    const east = unit(cross(Z, up));
    const north = cross(up, east);
    // Geodetic up differs slightly from geocentric; aim with the geodetic up the law uses.
    const lat = (35.7 * Math.PI) / 180;
    const lon = (139.7 * Math.PI) / 180 + gmst;
    const gUp = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
    const el = (elDeg * Math.PI) / 180;
    const horiz = unit({ x: north.x - dot(north, gUp) * gUp.x, y: north.y - dot(north, gUp) * gUp.y, z: north.z - dot(north, gUp) * gUp.z });
    const dir = { x: Math.cos(el) * horiz.x + Math.sin(el) * gUp.x, y: Math.cos(el) * horiz.y + Math.sin(el) * gUp.y, z: Math.cos(el) * horiz.z + Math.sin(el) * gUp.z };
    return { x: stEci.x + 700 * dir.x, y: stEci.y + 700 * dir.y, z: stEci.z + 700 * dir.z };
  }
  const vel = { x: 0, y: 0, z: 7.5 };

  it("points +Z at the station while it is above its minimum elevation", () => {
    const pos = satAtElevation(30);
    const q = satelliteAttitudeEci(pos, vel, DATE, settings, [station]);
    expectOrthonormal(q);
    expectVec(axes(q).z, unit({ x: stEci.x - pos.x, y: stEci.y - pos.y, z: stEci.z - pos.z }), 9);
  });

  it("switches instantly at the station's own minElevationDeg", () => {
    const above = satAtElevation(10.01);
    const below = satAtElevation(9.99);
    const toStation = (p: AttitudeVec3) => unit({ x: stEci.x - p.x, y: stEci.y - p.y, z: stEci.z - p.z });
    expectVec(axes(satelliteAttitudeEci(above, vel, DATE, settings, [station])).z, toStation(above), 9);
    expect(satelliteAttitudeEci(below, vel, DATE, settings, [station])).toEqual(satelliteAttitudeEci(below, vel, DATE, lvlh, []));
  });

  it("falls back to 地球指向 when the station is missing", () => {
    expect(effectiveAttitudeMode(settings, [])).toBe("lvlh");
    expect(effectiveAttitudeMode({ ...settings, stationName: undefined }, [station])).toBe("lvlh");
    expect(effectiveAttitudeMode(settings, [station])).toBe("station");
    expect(prepareAttitudeContext(DATE, settings, []).mode).toBe("lvlh");
    const pos = satAtElevation(30);
    expect(satelliteAttitudeEci(pos, vel, DATE, settings, [])).toEqual(satelliteAttitudeEci(pos, vel, DATE, lvlh, []));
  });
});

describe("sensorBoresightEci", () => {
  it("tilts forward toward +X then toward −Y", () => {
    const id = { w: 1, x: 0, y: 0, z: 0 };
    expectVec(sensorBoresightEci(id, 90, 0), X);
    expectVec(sensorBoresightEci(id, 0, 90), neg(Y));
    expectVec(sensorBoresightEci(id, 0, 0), Z);
  });
});

describe("solarArrayIncidence", () => {
  const id = { w: 1, x: 0, y: 0, z: 0 };
  it("fixed: the −Z face, clamped at 0", () => {
    expect(solarArrayIncidence(id, neg(Z), "fixed")).toEqual({ cosIncidence: 1, driveAngleRad: 0 });
    expect(solarArrayIncidence(id, Z, "fixed").cosIncidence).toBe(0);
    expect(solarArrayIncidence(id, unit({ x: 1, y: 0, z: -1 }), "fixed").cosIncidence).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("single axis: turns about +Y to the Sun, cos = √(1 − (Y·s)²)", () => {
    const sun = unit({ x: 0.6, y: 0.5, z: 0.4 });
    const r = solarArrayIncidence(id, sun, "singleAxis");
    expect(r.cosIncidence).toBeCloseTo(Math.sqrt(1 - sun.y * sun.y), 12);
    // The panel normal (−Z rotated by driveAngle about +Y, right-handed) faces the Sun's X–Z projection.
    const n = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.driveAngleRad);
    const proj = unit({ x: sun.x, y: 0, z: sun.z });
    expectVec(n, proj);
    expect(solarArrayIncidence(id, Y, "singleAxis")).toEqual({ cosIncidence: 0, driveAngleRad: 0 });
    expect(solarArrayIncidence(id, neg(Z), "singleAxis").driveAngleRad).toBeCloseTo(0, 12);
  });
});

describe("reconcileAttitudeStation", () => {
  const gs: GroundStation = { name: "A", latitudeDeg: 0, longitudeDeg: 0, heightKm: 0, minElevationDeg: 5 };
  it("returns the same object when nothing changes", () => {
    expect(reconcileAttitudeStation(lvlh, [gs])).toBe(lvlh);
    const s: SatelliteAttitudeSettings = { ...lvlh, mode: "station", stationName: "A" };
    expect(reconcileAttitudeStation(s, [gs])).toBe(s);
  });
  it("keeps a missing name in station mode so the UI can warn", () => {
    const s: SatelliteAttitudeSettings = { ...lvlh, mode: "station", stationName: "Gone" };
    expect(reconcileAttitudeStation(s, [gs])).toBe(s);
  });
  it("picks the first station for station mode without a name", () => {
    expect(reconcileAttitudeStation({ ...lvlh, mode: "station" }, [gs]).stationName).toBe("A");
  });
  it("drops a stale name in other modes", () => {
    const r = reconcileAttitudeStation({ ...lvlh, stationName: "Gone" }, [gs]);
    expect("stationName" in r).toBe(false);
  });
});

describe("renderer helpers (orbitalCoordinates)", () => {
  it("地球指向 returns exactly computeFovConeQuaternion (null without velocity)", () => {
    expect(fovConeQuaternionForAttitude(ECC.pos, ECC.vel, DATE, lvlh, [], 15, -20)).toEqual(computeFovConeQuaternion(ECC.pos, ECC.vel, 15, -20));
    expect(fovConeQuaternionForAttitude(ECC.pos, ECC.vel, DATE, undefined, [], 15, -20)).toEqual(computeFovConeQuaternion(ECC.pos, ECC.vel, 15, -20));
    expect(fovConeQuaternionForAttitude(ECC.pos, undefined, DATE, lvlh, [], 15, -20)).toBeNull();
  });

  it("other modes rotate the cone's −Y axis onto the attitude boresight", () => {
    const settings: SatelliteAttitudeSettings = { mode: "inertial", inertialRaDeg: 10, inertialDecDeg: -30 };
    const quat = fovConeQuaternionForAttitude(CIRC.pos, CIRC.vel, DATE, settings, [], 15, -20)!;
    const b = sensorBoresightEci(satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, settings, []), 15, -20);
    const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(quat);
    expectVec(axis, { x: b.x, y: b.z, z: -b.y });
  });

  it("cone height for a boresight matches the LVLH tilted-cone height", () => {
    const d = computeSensorDirectionEci(CIRC.pos, CIRC.vel, 20, 10)!;
    expect(computeConeHeightForBoresight(CIRC.pos, d, 30, 6378.137)).toBeCloseTo(
      computeTiltedConeHeight(CIRC.pos, CIRC.vel, 20, 10, 30, 6378.137)!,
      6,
    );
    expect(boresightPointsAtEarth(CIRC.pos, d, 6378.137)).toBe(true);
    expect(boresightPointsAtEarth(CIRC.pos, unit(CIRC.pos), 6378.137)).toBe(false);
    expect(computeConeHeightForBoresight(CIRC.pos, unit(CIRC.pos), 30, 6378.137)).toBeNull();
  });
});

describe("FOV access with attitude", () => {
  it("computeFovBoresightEcf applies a non-LVLH law", () => {
    const settings: SatelliteAttitudeSettings = { mode: "inertial", inertialRaDeg: 10, inertialDecDeg: -30 };
    const gmst = satellite.gstime(DATE);
    const fov = { halfAngleDeg: 30, alongTrackDeg: 5, crossTrackDeg: 0 };
    const b = computeFovBoresightEcf(CIRC.pos, CIRC.vel, gmst, fov, { settings, stations: [], date: DATE })!;
    const expected = satellite.eciToEcf(sensorBoresightEci(satelliteAttitudeEci(CIRC.pos, CIRC.vel, DATE, settings, []), 5, 0), gmst);
    expectVec(b, expected);
  });

  const sats = parseConstellationToml(`[constellation]
name = "T"
epoch = 2026-03-20T00:00:00Z

[[constellation.shells]]
name = "t"
count = 24
planes = 4
phasing = 1
apogee_altitude = 550
eccentricity = 0.001
inclination = 53.0
raan_range = 360.0
`);
  const stations: GroundStation[] = [
    { name: "Tokyo", latitudeDeg: 35.7, longitudeDeg: 139.7, heightKm: 0, minElevationDeg: 10 },
    { name: "Eq", latitudeDeg: 0, longitudeDeg: 0, heightKm: 0, minElevationDeg: 0 },
  ];
  const fov = { halfAngleDeg: 60, alongTrackDeg: 0, crossTrackDeg: 0 };
  const opts = { durationHours: 6, stepSeconds: 30, fov };
  const total = (c: Uint16Array) => c.reduce((s, v) => s + v, 0);

  it("地球指向 attitude leaves the access grid unchanged", () => {
    const base = computeAccessGrid(sats, stations, DATE, opts);
    const withLvlh = computeAccessGrid(sats, stations, DATE, { ...opts, attitude: { settings: lvlh, stations } });
    expect(Array.from(withLvlh.counts)).toEqual(Array.from(base.counts));
    expect(total(base.counts)).toBeGreaterThan(0);
  });

  it("the grid and the reference visibility path agree under 太陽指向 / 地上局指向, and 太陽指向 cuts access", () => {
    const base = computeAccessGrid(sats, stations, DATE, { ...opts, stepSeconds: 60 });
    for (const settings of [
      { ...lvlh, mode: "sun" as const },
      { ...lvlh, mode: "station" as const, stationName: "Tokyo" },
    ]) {
      const attitude = { settings, stations };
      // 60 s steps: SGP4 at every step (no Hermite interpolation), so both paths see the same states.
      const grid = computeAccessGrid(sats, stations, DATE, { ...opts, stepSeconds: 60, attitude });
      const ref = calculateStationAccessData(sats, stations, DATE, 6, 60, fov, attitude);
      expect(ref.flatMap((s) => s.stations.map((x) => x.visibleCount))).toEqual(Array.from(grid.counts));
      // Only satellites over the day side see the Earth with the anti-Sun face.
      if (settings.mode === "sun") expect(total(grid.counts)).toBeLessThan(total(base.counts) / 2);
      if (settings.mode === "station") expect(total(grid.counts)).not.toEqual(total(base.counts));
    }
  });
});
