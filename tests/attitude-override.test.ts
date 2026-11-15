import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyAttitudeOverride,
  attitudeOverrideFromRecord,
  attitudeOverrideLabel,
  attitudeOverrideTomlLines,
  countAttitudeOverrides,
  resolveSatelliteAttitude,
} from "../src/lib/attitude/resolve";
import { DEFAULT_SATELLITE_ATTITUDE, type SatelliteAttitudeSettings } from "../src/lib/attitude/types";
import { computeAccessGrid } from "../src/lib/accessGrid";
import { calculateStationAccessData, prepareFovAttitudeGroups } from "../src/lib/visibility";
import type { GroundStation } from "../src/lib/groundStations";
import { buildConstellation, parseConstellationToml, parseSatellitesToml } from "../src/lib/tomlParsers";
import {
  parseConstellationConfig as parseEditorConstellation,
  serializeConstellationConfig,
  validateConfig,
} from "../src/lib/constellationSerializer";
import {
  expandSatelliteEditorConfig,
  parseSatelliteEditorConfig,
  serializeSatelliteEditorConfig,
  validateSatelliteEditorConfig,
} from "../src/lib/satelliteEditorSerializer";
import { satellitesToToml } from "../src/utils/celestrakUtils";
import { applyScenarioOperation, commitRemoteScenario, emptyScenario } from "../src/lib/remoteScenario";
import type { SatelliteSpec } from "../src/lib/satellites";

const GLOBAL: SatelliteAttitudeSettings = {
  mode: "station",
  stationName: "Tokyo",
  inertialRaDeg: 10,
  inertialDecDeg: 20,
  eclipseMode: "sun",
  trackStationDuringPass: true,
  maxSlewRateDegS: 2,
};

describe("resolveSatelliteAttitude", () => {
  it("returns the global object itself without an override", () => {
    expect(resolveSatelliteAttitude({}, GLOBAL)).toBe(GLOBAL);
    expect(resolveSatelliteAttitude({ attitude: {} }, GLOBAL)).toBe(GLOBAL);
    expect(resolveSatelliteAttitude(undefined, GLOBAL)).toBe(GLOBAL);
  });

  it("an override with a mode replaces the law; parameters and slew rate inherit", () => {
    expect(applyAttitudeOverride({ mode: "sun" }, GLOBAL)).toEqual({
      mode: "sun",
      stationName: "Tokyo",
      inertialRaDeg: 10,
      inertialDecDeg: 20,
      maxSlewRateDegS: 2,
    });
    expect(applyAttitudeOverride({ mode: "inertial", inertialRaDeg: 100, eclipseMode: "lvlh", maxSlewRateDegS: 0 }, GLOBAL)).toEqual({
      mode: "inertial",
      stationName: "Tokyo",
      inertialRaDeg: 100,
      inertialDecDeg: 20,
      eclipseMode: "lvlh",
      maxSlewRateDegS: 0,
    });
  });

  it("an override without a mode merges field by field (false switches a schedule off)", () => {
    expect(applyAttitudeOverride({ trackStationDuringPass: false, maxSlewRateDegS: 0.5 }, GLOBAL)).toEqual({
      ...GLOBAL,
      trackStationDuringPass: false,
      maxSlewRateDegS: 0.5,
    });
  });

  it("labels and counts overrides by source", () => {
    const sats = [
      { attitude: { mode: "sun" as const }, attitudeSource: "shell" as const },
      { attitude: { mode: "lvlh" as const }, attitudeSource: "satellite" as const },
      {},
      { attitude: {} },
    ];
    expect(countAttitudeOverrides(sats)).toBe(2);
    expect(sats.map(attitudeOverrideLabel)).toEqual(["シェル設定", "衛星設定", null, null]);
  });

  it("the lenient record parser drops unusable values", () => {
    expect(attitudeOverrideFromRecord({ attitude_mode: "bogus", attitude_ra_deg: 400, attitude_slew_deg_s: -1 })).toBeUndefined();
    expect(attitudeOverrideFromRecord({ attitude_track_station: "true", attitude_dec_deg: "-30" })).toEqual({
      trackStationDuringPass: true,
      inertialDecDeg: -30,
    });
  });
});

const SHELL_TOML = `[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "Sun shell"
count = 4
planes = 2
apogee_altitude = 550
inclination = 53
attitude_mode = "sun"
attitude_station = "Tokyo \\"East\\""
attitude_eclipse_mode = "lvlh"
attitude_track_station = true
attitude_slew_deg_s = 1.25

[[constellation.shells]]
name = "Plain"
count = 2
planes = 1
apogee_altitude = 600
inclination = 97
`;

describe("constellation shell attitude TOML", () => {
  it("generated specs carry the shell override (shared object) and plain shells none", () => {
    const { satellites } = buildConstellation(SHELL_TOML, 0);
    expect(satellites).toHaveLength(6);
    const expected = {
      mode: "sun",
      stationName: 'Tokyo "East"',
      eclipseMode: "lvlh",
      trackStationDuringPass: true,
      maxSlewRateDegS: 1.25,
    };
    for (const s of satellites.slice(0, 4)) {
      expect(s.attitude).toEqual(expected);
      expect(s.attitudeSource).toBe("shell");
    }
    expect(satellites[1].attitude).toBe(satellites[0].attitude);
    for (const s of satellites.slice(4)) {
      expect("attitude" in s).toBe(false);
      expect("attitudeSource" in s).toBe(false);
    }
    expect(countAttitudeOverrides(satellites)).toBe(4);
  });

  it("round-trips through the editor serializer", () => {
    const once = serializeConstellationConfig(parseEditorConstellation(SHELL_TOML));
    expect(once).toContain('attitude_station = "Tokyo \\"East\\""');
    expect(once).toContain("attitude_track_station = true");
    expect(once).toContain("attitude_slew_deg_s = 1.25");
    expect(serializeConstellationConfig(parseEditorConstellation(once))).toBe(once);
    expect(parseConstellationToml(once)).toEqual(parseConstellationToml(SHELL_TOML));
  });

  it("files without attitude keys serialize exactly as before", () => {
    const text = readFileSync("public/constellation.toml", "utf8");
    const once = serializeConstellationConfig(parseEditorConstellation(text));
    expect(once).not.toContain("attitude_");
    expect(parseConstellationToml(text).some((s) => "attitude" in s)).toBe(false);
    // Explicit false survives (it switches a global schedule off).
    const off = serializeConstellationConfig(parseEditorConstellation(`${text}\nattitude_track_station = false\n`));
    expect(off).toContain("attitude_track_station = false");
  });

  it("validation reports bad values in Japanese", () => {
    const bad = SHELL_TOML.replace('attitude_mode = "sun"', 'attitude_mode = "spin"\nattitude_ra_deg = 400');
    const errors = validateConfig(parseEditorConstellation(bad)).errors;
    expect(errors.find((e) => e.field === "shell.0.attitude_mode")?.message).toContain("姿勢モード");
    expect(errors.find((e) => e.field === "shell.0.attitude_ra_deg")?.message).toContain("赤経");
    expect(validateConfig(parseEditorConstellation(SHELL_TOML)).isValid).toBe(true);
  });
});

const SAT_TOML = `[[satellites]]
type = "elements"
name = "Chief"
satnum = 910000001
epoch = "2026-10-01T00:00:00Z"
semiMajorAxisKm = 6928.137
eccentricity = 0.001
inclinationDeg = 97.5
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0
attitude_mode = "inertial"
attitude_ra_deg = 83.6
attitude_dec_deg = 22

[[satellites]]
type = "formation"
name = "Train"
chiefSatnum = 910000001
formationMode = "alongTrack"
attitude_mode = "yawSteering"
deputyCount = 2
spacingKm = 10
arrangement = "centered"
direction = "prograde"

[[satellites]]
type = "formation"
name = "Ring"
chiefSatnum = 910000001
formationMode = "gco"
deputyCount = 2
radiusKm = 8
phaseOffsetDeg = 0
rotationDirection = "prograde"
attitude_slew_deg_s = 0.5

[[satellites]]
type = "geo"
name = "Relay"
satnum = 910000005
epoch = "2026-10-01T00:00:00Z"
longitudeDeg = 140
inclinationDeg = 0
attitude_mode = "station"

[[satellites]]
type = "tle"
name = "Plain"
line1 = "1 25544U 98067A   26274.50000000  .00016717  00000-0  10270-3 0  9005"
line2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50000000    09"`;

describe("satellites attitude TOML", () => {
  it("expanded specs carry entry overrides, including every formation deputy", () => {
    const specs = parseSatellitesToml(SAT_TOML);
    expect(specs).toHaveLength(7);
    expect(specs[0].attitude).toEqual({ mode: "inertial", inertialRaDeg: 83.6, inertialDecDeg: 22 });
    expect(specs[0].attitudeSource).toBe("satellite");
    expect(specs.slice(1, 3).map((s) => s.attitude)).toEqual([{ mode: "yawSteering" }, { mode: "yawSteering" }]);
    expect(specs.slice(3, 5).map((s) => s.attitude)).toEqual([{ maxSlewRateDegS: 0.5 }, { maxSlewRateDegS: 0.5 }]);
    expect(specs[5].attitude).toEqual({ mode: "station" });
    expect("attitude" in specs[6]).toBe(false);
    expect(attitudeOverrideLabel(specs[3])).toBe("衛星設定");
  });

  it("round-trips through the editor serializer", () => {
    const once = serializeSatelliteEditorConfig(parseSatelliteEditorConfig(SAT_TOML));
    expect(serializeSatelliteEditorConfig(parseSatelliteEditorConfig(once))).toBe(once);
    expect(parseSatellitesToml(once)).toEqual(parseSatellitesToml(SAT_TOML));
  });

  it("entries without attitude serialize without attitude keys", () => {
    const plain = SAT_TOML.replace(/^attitude_.*$/gm, "");
    const once = serializeSatelliteEditorConfig(parseSatelliteEditorConfig(plain));
    expect(once).not.toContain("attitude_");
    expect(expandSatelliteEditorConfig(parseSatelliteEditorConfig(plain)).some((s) => "attitude" in s)).toBe(false);
  });

  it("satellitesToToml keeps per-satellite overrides", () => {
    const specs = parseSatellitesToml(SAT_TOML);
    const back = parseSatellitesToml(satellitesToToml(specs));
    expect(back.map((s) => s.attitude)).toEqual(specs.map((s) => s.attitude));
  });

  it("validation flags editor-entered values out of range", () => {
    const config = parseSatelliteEditorConfig(SAT_TOML);
    config.entries[0] = { ...config.entries[0], attitude: { mode: "inertial", inertialDecDeg: 120, maxSlewRateDegS: -1 } };
    const errors = validateSatelliteEditorConfig(config).errors;
    expect(errors.map((e) => e.field)).toEqual(["entry.0.attitude_dec_deg", "entry.0.attitude_slew_deg_s"]);
  });

  it("attitudeOverrideTomlLines writes keys in a stable order", () => {
    expect(attitudeOverrideTomlLines({ maxSlewRateDegS: 1, mode: "sun", trackStationDuringPass: false })).toEqual([
      'attitude_mode = "sun"',
      "attitude_track_station = false",
      "attitude_slew_deg_s = 1",
    ]);
  });
});

describe("remote scenario attitude", () => {
  const station = `[[groundstations]]\nname = "Tokyo"\nlatitudeDeg = 35.6\nlongitudeDeg = 139.7\nheightKm = 0\nminElevationDeg = 10`;
  const shell = (extra: string) =>
    `[constellation]\nepoch = 2026-10-03T00:00:00Z\n\n[[constellation.shells]]\nname = "A"\ncount = 2\nplanes = 1\napogee_altitude = 550\ninclination = 53\n${extra}`;

  it("an appended shell's attitude reaches the committed satellites", () => {
    let s = applyScenarioOperation(emptyScenario(), { type: "append", section: "constellation", text: shell('attitude_mode = "sun"\nattitude_track_station = true') });
    s = applyScenarioOperation(s, { type: "append", section: "groundstations", text: station });
    const sats: SatelliteSpec[] = commitRemoteScenario(s).satellites;
    expect(sats.map((x) => x.attitude)).toEqual([
      { mode: "sun", trackStationDuringPass: true },
      { mode: "sun", trackStationDuringPass: true },
    ]);
  });

  it("rejects invalid attitude values", () => {
    expect(() => applyScenarioOperation(emptyScenario(), { type: "append", section: "constellation", text: shell('attitude_mode = "spin"') })).toThrow("姿勢モード");
    expect(() => applyScenarioOperation(emptyScenario(), {
      type: "append",
      section: "satellites",
      text: `[[satellites]]\ntype = "elements"\nsatnum = 910000001\nepoch = "2026-10-01T00:00:00Z"\nsemiMajorAxisKm = 6928\neccentricity = 0\ninclinationDeg = 97\nraanDeg = 0\nargPerigeeDeg = 0\nmeanAnomalyDeg = 0\nattitude_slew_deg_s = -2`,
    })).toThrow("最大レート");
  });
});

describe("analyses use per-satellite resolved attitude", () => {
  const shells = (extra: string) => `[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "a"
count = 12
planes = 3
phasing = 1
apogee_altitude = 550
inclination = 53
${extra}

[[constellation.shells]]
name = "b"
count = 8
planes = 2
apogee_altitude = 700
inclination = 97
`;
  const start = new Date("2025-05-20T00:00:00Z");
  const stations: GroundStation[] = [
    { name: "Tokyo", latitudeDeg: 35.7, longitudeDeg: 139.7, heightKm: 0, minElevationDeg: 10 },
    { name: "Sydney", latitudeDeg: -33.9, longitudeDeg: 151.2, heightKm: 0, minElevationDeg: 5 },
  ];
  const fov = { halfAngleDeg: 50, alongTrackDeg: 0, crossTrackDeg: 0 };
  const lvlh = { settings: DEFAULT_SATELLITE_ATTITUDE, stations };
  const opts = { durationHours: 2, stepSeconds: 30, fov };

  it("plain LVLH everywhere stays on the legacy path (same grid as no attitude)", () => {
    const sats = parseConstellationToml(shells(""));
    expect(prepareFovAttitudeGroups(lvlh, sats)).toBeNull();
    const legacy = computeAccessGrid(sats, stations, start, opts);
    const withAttitude = computeAccessGrid(sats, stations, start, { ...opts, attitude: lvlh });
    expect(Array.from(withAttitude.counts)).toEqual(Array.from(legacy.counts));
  });

  it("a shell override equals the same law set globally for that shell", () => {
    const overridden = parseConstellationToml(shells('attitude_mode = "station"\nattitude_station = "Tokyo"'));
    const plainA = parseConstellationToml(shells("")).slice(0, 12);
    const plainB = parseConstellationToml(shells("")).slice(12);
    const groups = prepareFovAttitudeGroups(lvlh, overridden)!;
    expect(groups.groups).toHaveLength(2);
    expect(Array.from(groups.groupOf.slice(10, 14))).toEqual([0, 0, 1, 1]);

    const grid = computeAccessGrid(overridden, stations, start, { ...opts, attitude: lvlh });
    const station = { settings: { ...DEFAULT_SATELLITE_ATTITUDE, mode: "station" as const, stationName: "Tokyo" }, stations };
    const a = computeAccessGrid(plainA, stations, start, { ...opts, attitude: station });
    const b = computeAccessGrid(plainB, stations, start, opts);
    expect(Array.from(grid.counts)).toEqual(Array.from(a.counts).map((n, i) => n + b.counts[i]));
    // ...and differs from ignoring the override.
    expect(Array.from(grid.counts)).not.toEqual(Array.from(computeAccessGrid(overridden, stations, start, opts).counts));

    // visibility.ts reference path agrees.
    const ref = calculateStationAccessData(overridden, stations, start, 2, 60, fov, lvlh);
    const refA = calculateStationAccessData(plainA, stations, start, 2, 60, fov, station);
    const refB = calculateStationAccessData(plainB, stations, start, 2, 60, fov);
    ref.forEach((sample, i) => sample.stations.forEach((e, gi) =>
      expect(e.visibleCount).toBe(refA[i].stations[gi].visibleCount + refB[i].stations[gi].visibleCount)));
  });

  it("without a FovAttitude overrides are ignored (Earth pointing, e.g. comparison)", () => {
    const overridden = parseConstellationToml(shells('attitude_mode = "sun"'));
    const plain = parseConstellationToml(shells(""));
    expect(Array.from(computeAccessGrid(overridden, stations, start, opts).counts))
      .toEqual(Array.from(computeAccessGrid(plain, stations, start, opts).counts));
  });
});
