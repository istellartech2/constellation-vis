import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as satellite from "satellite.js";
import * as THREE from "three";
import {
  parseTrajectoryFile,
  parseUtcTimestamp,
  toTrajectoryTrack,
  TRAJECTORY_PALETTE,
} from "../src/lib/trajectory/parse";
import type { TrajectoryParseResult } from "../src/lib/trajectory/types";

const EPOCH = "2026-11-15T12:00:00Z";
const EPOCH_MS = Date.UTC(2026, 10, 15, 12, 0, 0);
const OMEGA = 7.292115e-5;

function expectOk(result: TrajectoryParseResult) {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result;
}

function expectError(result: TrajectoryParseResult): string {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

function lla(latDeg: number, lonDeg: number, altKm: number) {
  return satellite.geodeticToEcf({
    latitude: (latDeg * Math.PI) / 180,
    longitude: (lonDeg * Math.PI) / 180,
    height: altKm,
  });
}

describe("parseUtcTimestamp", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("treats timestamps without a zone designator as UTC, even in a non-UTC local zone", () => {
    process.env.TZ = "America/New_York";
    // Sanity check that the zone change took effect (naive Date parsing is local).
    expect(new Date("2026-01-01T00:00:00").getTime()).not.toBe(Date.UTC(2026, 0, 1));
    expect(parseUtcTimestamp("2026-01-01T00:00:00")).toBe(Date.UTC(2026, 0, 1));
    expect(parseUtcTimestamp("2026-01-01T00:00:00.250")).toBe(Date.UTC(2026, 0, 1) + 250);
    expect(parseUtcTimestamp("2026-01-01 00:00:00")).toBe(Date.UTC(2026, 0, 1));
  });

  it("honours explicit zones", () => {
    expect(parseUtcTimestamp("2026-01-01T09:00:00+09:00")).toBe(Date.UTC(2026, 0, 1));
    expect(parseUtcTimestamp("2026-01-01T00:00:00Z")).toBe(Date.UTC(2026, 0, 1));
  });

  it("accepts CCSDS day-of-year form", () => {
    expect(parseUtcTimestamp("2026-032T12:00:00")).toBe(Date.UTC(2026, 1, 1, 12));
    expect(parseUtcTimestamp("2026-001T00:00:00.5Z")).toBe(Date.UTC(2026, 0, 1) + 500);
  });

  it("returns NaN for garbage", () => {
    expect(parseUtcTimestamp("yesterday")).toBeNaN();
    expect(parseUtcTimestamp("2026-13-01T00:00:00")).toBeNaN();
  });
});

describe("parseTrajectoryFile – CSV", () => {
  it("parses LLA with relative times, epoch, name and events", () => {
    const csv = [
      "\uFEFF# name: Test rocket",
      `# epoch: ${EPOCH}`,
      "# event: 0, Liftoff",
      "# event: 1.5, Max-Q, with comma",
      "time_s,lat_deg,lon_deg,alt_km",
      "0,25.9969,-97.1546,0.0",
      "",
      "1,26.0,-97.15,1.0",
      "2,26.01,-97.14,3.0",
    ].join("\n");
    const result = expectOk(parseTrajectoryFile(csv, "rocket.csv"));
    expect(result.warnings).toEqual([]);
    const { track } = result;
    expect(track.name).toBe("Test rocket");
    expect(track.sourceFrame).toBe("LLA");
    expect(track.epochMs).toBe(EPOCH_MS);
    expect(track.samples.map((s) => s.timeMs)).toEqual([EPOCH_MS, EPOCH_MS + 1000, EPOCH_MS + 2000]);
    const expected = lla(26.0, -97.15, 1.0);
    expect(track.samples[1].position.x).toBeCloseTo(expected.x, 9);
    expect(track.samples[1].position.y).toBeCloseTo(expected.y, 9);
    expect(track.samples[1].position.z).toBeCloseTo(expected.z, 9);
    expect(track.samples[1].velocity).toBeUndefined();
    expect(track.events).toEqual([
      { timeMs: EPOCH_MS, label: "Liftoff" },
      { timeMs: EPOCH_MS + 1500, label: "Max-Q, with comma" },
    ]);
  });

  it("parses ISO time columns and uses the file name when there is no name header", () => {
    const csv = [
      "# event: 2026-11-15T12:00:01Z, Burn",
      "UTC,Latitude,Longitude,Altitude_km",
      "2026-11-15T12:00:02Z,10,20,100",
      "2026-11-15T12:00:00,10,20.1,100",
    ].join("\r\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "path/to/my-track.csv"));
    expect(track.name).toBe("my-track");
    expect(track.epochMs).toBeUndefined();
    // sorted by time
    expect(track.samples.map((s) => s.timeMs)).toEqual([EPOCH_MS, EPOCH_MS + 2000]);
    expect(track.events).toEqual([{ timeMs: EPOCH_MS + 1000, label: "Burn" }]);
  });

  it("errors on relative times without epoch, falls back to defaultEpochMs with a warning", () => {
    const csv = "t,lat,lon,alt\n0,0,0,0\n10,0,1,0\n";
    expect(expectError(parseTrajectoryFile(csv, "a.csv"))).toContain("epoch");
    const result = expectOk(parseTrajectoryFile(csv, "a.csv", { defaultEpochMs: EPOCH_MS }));
    expect(result.warnings.length).toBe(1);
    expect(result.track.epochMs).toBe(EPOCH_MS);
    expect(result.track.samples[1].timeMs).toBe(EPOCH_MS + 10_000);
  });

  it("ignores unknown columns such as attitude quaternions", () => {
    const csv = [
      `# epoch: ${EPOCH}`,
      "qw,time,qx,lat,q_y,lon,x_quat,alt,stage",
      "1,0,0,10,0,20,0,5,booster",
      "1,1,0,10.1,0,20.1,0,6,booster",
    ].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "q.csv"));
    expect(track.sourceFrame).toBe("LLA");
    const expected = lla(10.1, 20.1, 6);
    expect(track.samples[1].position.x).toBeCloseTo(expected.x, 9);
  });

  it("converts metre units and accepts whitespace separators", () => {
    const csv = [
      `# epoch: ${EPOCH}`,
      "# frame: ECEF",
      "t_s  x_m  y_m  z_m  vx_m_s  vy_m_s  vz_m_s",
      "0    7000000  0  0  0  7500  0",
      "10   7000000  75000  0  0  7500  0",
    ].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "m.txt"));
    expect(track.sourceFrame).toBe("ECEF");
    expect(track.samples[0].position).toEqual({ x: 7000, y: 0, z: 0 });
    expect(track.samples[1].velocity).toEqual({ x: 0, y: 7.5, z: 0 });
  });

  it("converts metre altitude and tab separators", () => {
    const csv = `# epoch: ${EPOCH}\ntime\tlat\tlon\talt_m\n0\t0\t0\t1000\n1\t0\t0\t2000\n`;
    const { track } = expectOk(parseTrajectoryFile(csv, "t.tsv"));
    expect(Math.hypot(track.samples[0].position.x, track.samples[0].position.y)).toBeCloseTo(6379.137, 6);
  });

  it("loads Cartesian columns without a frame header as ECEF with a warning", () => {
    const csv = `# epoch: ${EPOCH}\nt,x,y,z\n0,7000,0,0\n1,7000,1,0\n`;
    const result = expectOk(parseTrajectoryFile(csv, "c.csv"));
    expect(result.track.sourceFrame).toBe("ECEF");
    expect(result.warnings.length).toBe(1);
  });

  it("reports the physical line number of a bad numeric row", () => {
    const csv = [
      `# epoch: ${EPOCH}`, // 1
      "# a comment", // 2
      "", // 3
      "time_s,lat,lon,alt", // 4
      "0,0,0,0", // 5
      "", // 6
      "1,0,abc,0", // 7
    ].join("\n");
    expect(expectError(parseTrajectoryFile(csv, "bad.csv"))).toBe("7行目: 数値として読めない値があります");
  });

  it("drops duplicate times with a warning and requires two samples", () => {
    const csv = `# epoch: ${EPOCH}\nt,lat,lon,alt\n0,0,0,0\n0,1,1,1\n5,0,1,0\n`;
    const result = expectOk(parseTrajectoryFile(csv, "d.csv"));
    expect(result.track.samples.length).toBe(2);
    expect(result.warnings.length).toBe(1);
    expect(expectError(parseTrajectoryFile(`# epoch: ${EPOCH}\nt,lat,lon,alt\n0,0,0,0\n`, "one.csv"))).toContain("2 件");
  });

  it("converts ECI CSV input to ECEF", () => {
    const csv = `# frame: ECI\nutc,x,y,z\n2026-11-15T12:00:00Z,7000,0,0\n2026-11-15T12:01:00Z,7000,100,0\n`;
    const { track } = expectOk(parseTrajectoryFile(csv, "eci.csv"));
    const gmst = satellite.gstime(new Date(EPOCH_MS));
    const ecef = satellite.eciToEcf({ x: 7000, y: 0, z: 0 }, gmst);
    expect(track.sourceFrame).toBe("ECI");
    expect(track.samples[0].position.x).toBeCloseTo(ecef.x, 9);
    expect(track.samples[0].position.y).toBeCloseTo(ecef.y, 9);
  });
});

describe("parseTrajectoryFile – CCSDS OEM", () => {
  const oem = (refFrame: string, lines: string[], extraMeta: string[] = []) =>
    [
      "CCSDS_OEM_VERS = 2.0",
      "CREATION_DATE = 2026-11-01T00:00:00",
      "ORIGINATOR = TEST",
      "",
      "META_START",
      "OBJECT_NAME = TESTSAT",
      "OBJECT_ID = 2026-001A",
      "CENTER_NAME = EARTH",
      `REF_FRAME = ${refFrame}`,
      "TIME_SYSTEM = UTC",
      "START_TIME = 2026-02-01T12:00:00",
      "STOP_TIME = 2026-02-01T12:02:00",
      ...extraMeta,
      "META_STOP",
      "COMMENT synthetic test data",
      ...lines,
    ].join("\n");

  it("reads ITRF states as ECEF and treats epochs without Z as UTC", () => {
    const text = oem("ITRF2000", [
      "2026-02-01T12:00:00 7000 0 0 0 7.5 0",
      "2026-02-01T12:01:00.000 6990 450 0 -0.1 7.5 0",
      "COVARIANCE_START",
      "EPOCH = 2026-02-01T12:00:00",
      "COV_REF_FRAME = RTN",
      "1.0",
      "0.1 1.0",
      "COVARIANCE_STOP",
    ]);
    const result = expectOk(parseTrajectoryFile(text, "sat.oem"));
    expect(result.warnings).toEqual([]);
    const { track } = result;
    expect(track.name).toBe("TESTSAT");
    expect(track.sourceFrame).toBe("ECEF");
    expect(track.samples.length).toBe(2);
    expect(track.samples[0].timeMs).toBe(Date.UTC(2026, 1, 1, 12));
    expect(track.samples[0].position).toEqual({ x: 7000, y: 0, z: 0 });
    expect(track.samples[0].velocity).toEqual({ x: 0, y: 7.5, z: 0 });
  });

  it("accepts day-of-year epochs", () => {
    const text = oem("ITRF-93", ["2026-032T12:00:00 7000 0 0 0 7.5 0", "2026-032T12:01:00 6990 450 0 -0.1 7.5 0 0 0 0"]);
    const { track } = expectOk(parseTrajectoryFile(text, "doy.oem"));
    expect(track.samples[0].timeMs).toBe(Date.UTC(2026, 1, 1, 12));
    expect(track.samples[1].timeMs).toBe(Date.UTC(2026, 1, 1, 12, 1));
  });

  it("rotates EME2000 states into ECEF with the Earth-rotation velocity term", () => {
    const t = Date.UTC(2026, 1, 1, 12);
    const gmst = satellite.gstime(new Date(t));
    // Equatorial point at the ECEF x axis, expressed in ECI, with zero inertial velocity.
    const r = 6378.137;
    const eci = { x: r * Math.cos(gmst), y: r * Math.sin(gmst), z: 0 };
    const text = oem("EME2000", [
      `2026-02-01T12:00:00 ${eci.x} ${eci.y} 0 0 0 0`,
      "2026-02-01T12:01:00 7000 0 0 0 7.5 0",
    ]);
    const result = expectOk(parseTrajectoryFile(text, "eci.oem"));
    expect(result.track.sourceFrame).toBe("ECI");
    expect(result.warnings.length).toBe(1);
    const s = result.track.samples[0];
    expect(s.position.x).toBeCloseTo(r, 6);
    expect(s.position.y).toBeCloseTo(0, 6);
    const v = s.velocity!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(OMEGA * r, 6);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(0.465, 3);
    // A point fixed in inertial space drifts westward (−y at the +x axis) in ECEF.
    expect(v.y).toBeCloseTo(-OMEGA * r, 9);
    expect(v.x).toBeCloseTo(0, 9);
  });

  it("concatenates segments in time order", () => {
    const seg2 = [
      "META_START",
      "OBJECT_NAME = TESTSAT",
      "CENTER_NAME = EARTH",
      "REF_FRAME = ITRF",
      "TIME_SYSTEM = UTC",
      "META_STOP",
      "2026-02-01T11:59:00 7000 -450 0 0.1 7.5 0",
    ];
    const text = oem("ITRF", ["2026-02-01T12:00:00 7000 0 0 0 7.5 0", ...seg2]);
    const { track } = expectOk(parseTrajectoryFile(text, "multi.oem"));
    expect(track.samples.map((s) => s.timeMs)).toEqual([Date.UTC(2026, 1, 1, 11, 59), Date.UTC(2026, 1, 1, 12)]);
  });

  it("warns for non-UTC time systems and rejects unknown frames", () => {
    const tai = oem("ITRF", ["2026-02-01T12:00:00 7000 0 0 0 7.5 0", "2026-02-01T12:01:00 7000 1 0 0 7.5 0"]).replace(
      "TIME_SYSTEM = UTC",
      "TIME_SYSTEM = TAI",
    );
    expect(expectOk(parseTrajectoryFile(tai, "tai.oem")).warnings.some((w) => w.includes("TAI"))).toBe(true);
    const bad = oem("MARSIAU", ["2026-02-01T12:00:00 7000 0 0 0 7.5 0"]);
    expect(expectError(parseTrajectoryFile(bad, "bad.oem"))).toContain("REF_FRAME");
  });
});

describe("toTrajectoryTrack", () => {
  it("assigns palette colours by index and unique ids", () => {
    const { track } = expectOk(parseTrajectoryFile(`# epoch: ${EPOCH}\nt,lat,lon,alt\n0,0,0,0\n1,0,0,1\n`, "a.csv"));
    const a = toTrajectoryTrack(track, 0);
    const b = toTrajectoryTrack(track, 0);
    const c = toTrajectoryTrack(track, TRAJECTORY_PALETTE.length + 1);
    expect(a.visible).toBe(true);
    expect(a.color).toBe(TRAJECTORY_PALETTE[0]);
    expect(c.color).toBe(TRAJECTORY_PALETTE[1]);
    expect(a.id).not.toBe(b.id);
    expect(a.samples).toBe(track.samples);
    expect(a.attitudeRules).toEqual([]);
    expect(a.model).toBeUndefined();
  });

  it("defaults missing attitudeRules to an empty list", () => {
    const { track } = expectOk(parseTrajectoryFile(`# epoch: ${EPOCH}\nt,lat,lon,alt\n0,0,0,0\n1,0,0,1\n`, "a.csv"));
    const { attitudeRules: _omit, ...rest } = track;
    void _omit;
    expect(toTrajectoryTrack(rest as typeof track, 0).attitudeRules).toEqual([]);
  });
});

describe("sample CSVs", () => {
  for (const file of ["trajectory-sample-booster.csv", "trajectory-sample-ship.csv"]) {
    it(`parses docs/examples/${file}`, () => {
      const text = readFileSync(join(import.meta.dir, "..", "docs", "examples", file), "utf8");
      const result = expectOk(parseTrajectoryFile(text, file));
      expect(result.warnings).toEqual([]);
      expect(result.track.sourceFrame).toBe("LLA");
      expect(result.track.epochMs).toBe(Date.UTC(2026, 10, 15, 18));
      expect(result.track.samples.length).toBeGreaterThan(100);
      expect(result.track.model).toMatch(/^starship-v3-(booster|ship)$/);
      expect(result.track.attitudeRules.length).toBeGreaterThanOrEqual(2);
      expect(result.track.attitudeRules[0]).toEqual({ timeMs: Date.UTC(2026, 10, 15, 18), mode: "prograde" });
      expect(result.track.events.length).toBeGreaterThanOrEqual(3);
      expect(result.track.name).toContain("Synthetic");
    });
  }
});

function rotate(q: { w: number; x: number; y: number; z: number }, v: [number, number, number]) {
  return new THREE.Vector3(...v).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
}

describe("model and attitude headers", () => {
  it("reads model and attitude rules (relative and ISO times, options), sorted", () => {
    const csv = [
      `# epoch: ${EPOCH}`,
      "# model: starship-v3-ship",
      "# attitude: 100, aoa, aoa=70, transition=30",
      "# attitude: 0, prograde",
      "# attitude: 2026-11-15T12:00:50Z, Retrograde",
      "# attitude: 5, sideways",
      "# attitude: 6, aoa",
      "t,lat,lon,alt",
      "0,0,0,0",
      "1,0,0,1",
    ].join("\n");
    const result = expectOk(parseTrajectoryFile(csv, "a.csv"));
    expect(result.track.model).toBe("starship-v3-ship");
    expect(result.track.attitudeRules).toEqual([
      { timeMs: EPOCH_MS, mode: "prograde" },
      { timeMs: EPOCH_MS + 50_000, mode: "retrograde" },
      { timeMs: EPOCH_MS + 100_000, mode: "aoa", aoaDeg: 70, transitionS: 30 },
    ]);
    expect(result.warnings.length).toBe(2);
    expect(result.warnings[0]).toContain("6行目");
  });

  it("reads ECEF quaternion columns as body → ECEF", () => {
    const h = Math.SQRT1_2;
    const csv = [`# epoch: ${EPOCH}`, "# attitude_frame: ECEF", "t,lat,lon,alt,qw,qx,qy,qz", `0,0,0,0,${h},0,0,${h}`, `1,0,0,1,1,0,0,0`].join("\n");
    const result = expectOk(parseTrajectoryFile(csv, "q.csv"));
    expect(result.warnings).toEqual([]);
    const nose = rotate(result.track.samples[0].attitude!, [1, 0, 0]);
    expect(nose.y).toBeCloseTo(1, 9);
    expect(result.track.samples[1].attitude!.w).toBeCloseTo(1, 12);
  });

  it("converts ENU quaternions (q0 scalar first) with each sample's own lat/lon", () => {
    // Identity in ENU at lat 0 / lon 90: body X = east = ECEF −X, body Z = up = ECEF +Y.
    const csv = [`# epoch: ${EPOCH}`, "# attitude_frame: ENU", "t,lat,lon,alt,q0,q1,q2,q3", "0,0,90,0,2,0,0,0", "1,0,90,1,1,0,0,0"].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "q.csv"));
    const q = track.samples[0].attitude!;
    expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 12);
    const nose = rotate(q, [1, 0, 0]);
    const zAxis = rotate(q, [0, 0, 1]);
    expect(nose.x).toBeCloseTo(-1, 6);
    expect(zAxis.y).toBeCloseTo(1, 6);
  });

  it("rotates ECI quaternions by GMST", () => {
    const csv = [`# epoch: ${EPOCH}`, "# attitude_frame: ECI", "t,lat,lon,alt,qw,qx,qy,qz", "0,0,0,0,1,0,0,0", "1,0,0,1,1,0,0,0"].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "q.csv"));
    const g = satellite.gstime(new Date(EPOCH_MS));
    const nose = rotate(track.samples[0].attitude!, [1, 0, 0]);
    // ECI +X in ECEF: (cos g, −sin g, 0)
    expect(nose.x).toBeCloseTo(Math.cos(g), 6);
    expect(nose.y).toBeCloseTo(-Math.sin(g), 6);
  });

  it("warns and assumes ECEF when quaternions have no attitude_frame", () => {
    const csv = [`# epoch: ${EPOCH}`, "t,lat,lon,alt,qw,qx,qy,qz", "0,0,0,0,1,0,0,0", "1,0,0,1,1,0,0,0"].join("\n");
    const result = expectOk(parseTrajectoryFile(csv, "q.csv"));
    expect(result.warnings.some((w) => w.includes("attitude_frame"))).toBe(true);
  });

  it("reads rocket-style azimuth / elevation / roll columns in local ENU", () => {
    const csv = [
      `# epoch: ${EPOCH}`,
      "t,lat,lon,alt,att_azimuth_deg,att_elevation_deg,att_roll_deg",
      "0,0,0,0,0,90,0",
      "1,0,0,1,90,0,0",
      "2,0,0,2,90,0,90",
    ].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "a.csv"));
    // Vertical at lat 0 / lon 0: nose = ECEF +X, belly toward azimuth 0 (north = +Z).
    expect(rotate(track.samples[0].attitude!, [1, 0, 0]).x).toBeCloseTo(1, 6);
    expect(rotate(track.samples[0].attitude!, [0, 0, 1]).z).toBeCloseTo(1, 6);
    // Level, east: nose +Y, belly down (−X).
    expect(rotate(track.samples[1].attitude!, [1, 0, 0]).y).toBeCloseTo(1, 6);
    expect(rotate(track.samples[1].attitude!, [0, 0, 1]).x).toBeCloseTo(-1, 6);
    // Roll +90: belly to north (+Z).
    expect(rotate(track.samples[2].attitude!, [0, 0, 1]).z).toBeCloseTo(1, 6);
  });

  it("accepts pitch_deg / heading_deg aliases without roll", () => {
    const csv = [`# epoch: ${EPOCH}`, "t,lat,lon,alt,heading_deg,pitch_deg", "0,0,0,0,90,0", "1,0,0,1,90,0"].join("\n");
    const { track } = expectOk(parseTrajectoryFile(csv, "a.csv"));
    expect(rotate(track.samples[0].attitude!, [1, 0, 0]).y).toBeCloseTo(1, 6);
  });

  it("rejects an unknown attitude_frame and a non-numeric quaternion", () => {
    expect(expectError(parseTrajectoryFile(`# attitude_frame: LVLH\n# epoch: ${EPOCH}\nt,lat,lon,alt\n0,0,0,0\n1,0,0,1\n`, "a.csv"))).toContain(
      "1行目",
    );
    const bad = [`# epoch: ${EPOCH}`, "# attitude_frame: ECEF", "t,lat,lon,alt,qw,qx,qy,qz", "0,0,0,0,1,0,0,0", "1,0,0,1,x,0,0,0"].join("\n");
    expect(expectError(parseTrajectoryFile(bad, "a.csv"))).toContain("5行目");
  });
});

describe("mount header", () => {
  it("parses an upper-stage stacking offset in T+ seconds", () => {
    const text = [
      "# epoch: 2026-11-15T18:00:00Z",
      "# mount: 160, 72.3",
      "time_s,lat_deg,lon_deg,alt_km",
      "0,26,-97,0",
      "10,26,-97,1",
    ].join("\n");
    const result = parseTrajectoryFile(text, "ship.csv");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.track.mount).toEqual({ untilMs: Date.parse("2026-11-15T18:02:40Z"), offsetM: 72.3 });
  });

  it("warns and ignores a malformed mount", () => {
    const text = ["# epoch: 2026-11-15T18:00:00Z", "# mount: 160", "time_s,lat_deg,lon_deg,alt_km", "0,26,-97,0", "10,26,-97,1"].join("\n");
    const result = parseTrajectoryFile(text, "ship.csv");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.track.mount).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("mount"))).toBe(true);
  });
});
