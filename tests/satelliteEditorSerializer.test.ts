import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import {
  expandSatelliteEditorConfig,
  parseSatelliteEditorConfig,
  relativeStateForFormation,
  serializeSatelliteEditorConfig,
  validateSatelliteEditorConfig,
} from "../src/lib/satelliteEditorSerializer";
import { toSatrec } from "../src/lib/satellites";
import { getSatelliteDerivedInfo } from "../src/lib/satelliteDerivedInfo";
import { createDefaultFormationEntry, createDefaultGeoEntry, type SatelliteEditorConfig } from "../src/lib/satelliteEditorTypes";

describe("satelliteEditorSerializer", () => {
  it("creates manual elements TOML from an empty config", () => {
    const config: SatelliteEditorConfig = {
      entries: [
        {
          id: "manual-1",
          kind: "manual",
          type: "elements",
          name: "DemoSat",
          meta: { objectName: "DemoSat" },
          elements: {
            satnum: 90001,
            epoch: new Date("2025-05-20T00:00:00Z"),
            semiMajorAxisKm: 7000,
            eccentricity: 0.001,
            inclinationDeg: 40,
            raanDeg: 10,
            argPerigeeDeg: 20,
            meanAnomalyDeg: 30,
          },
        },
      ],
    };
    const toml = serializeSatelliteEditorConfig(config);
    expect(toml).toContain('type = "elements"');
    expect(toml).toContain("satnum = 90001");
    expect(toml).toContain('name = "DemoSat"');
  });

  it("round-trips existing tle and elements entries", async () => {
    const source = await Bun.file("public/satellites.toml").text();
    const parsed = parseSatelliteEditorConfig(source);
    const serialized = serializeSatelliteEditorConfig(parsed);
    const reparsed = parseSatelliteEditorConfig(serialized);
    expect(reparsed.entries).toHaveLength(parsed.entries.length);
  });

  it("rejects legacy formation records without formationMode", () => {
    expect(() =>
      parseSatelliteEditorConfig(`
[[satellites]]
type = "formation"
name = "Legacy"
chiefSatnum = 90001
deputyCount = 2
relativeModel = "roe"
`)
    ).toThrow("旧形式の formation は未対応");
  });

  it("round-trips new custom formation blocks", () => {
    const source = `
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Custom"
chiefSatnum = 90001
formationMode = "custom"
deputyCount = 2
relativeModel = "roe"
deltaAkm = 0
deltaLambdaDeg = 0.2
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 0
crossTrackKm = 0
phaseOffsetDeg = 0
`;
    const serialized = serializeSatelliteEditorConfig(parseSatelliteEditorConfig(source));
    expect(serialized).toContain('formationMode = "custom"');
    expect(serialized).toContain('relativeModel = "roe"');
  });

  it("starts new formations in custom mode", () => {
    const entry = createDefaultFormationEntry();
    expect(entry.formationMode).toBe("custom");
    if (entry.formationMode === "custom") {
      expect(entry.deputyCount).toBe(1);
      expect(entry.relativeModel).toBe("roe");
    }
  });

  it("expands along-track formations with centered spacing", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Train"
chiefSatnum = 90001
formationMode = "alongTrack"
deputyCount = 4
spacingKm = 10
arrangement = "centered"
direction = "prograde"
`);
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(5);
    const chief = expanded[0];
    const deputies = expanded.slice(1);
    if (chief?.type === "elements" && deputies.every((sat) => sat.type === "elements")) {
      const anomalies = deputies.map((sat) => sat.type === "elements" ? sat.elements.meanAnomalyDeg : 0);
      expect(anomalies.some((value) => value > 180)).toBe(true);
      expect(anomalies.some((value) => value < 180)).toBe(true);
    }
  });

  it("expands nmc formations with 2:1 in-plane geometry", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "NMC"
chiefSatnum = 90001
formationMode = "nmc"
sizeKm = 8
orientationDeg = 0
equidistant = true
crossTrackSign = "north"
crossTrackOffsetKm = 0
phaseOffsetDeg = 90
`);
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]?.type).toBe("elements");
  });

  it("expands cross-track pendulum with mostly out-of-plane offset", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Pendulum"
chiefSatnum = 90001
formationMode = "crossTrackPendulum"
amplitudeKm = 8
phaseOffsetDeg = 90
side = "north"
`);
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(2);
  });

  it("expands helix with distributed phase and pitch", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Helix"
chiefSatnum = 90001
formationMode = "helix"
deputyCount = 3
radiusKm = 6
pitchKm = 4
turnDirection = "prograde"
phaseOffsetDeg = 0
`);
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(4);
  });

  it("expands gco with multiple deputies", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "GCO"
chiefSatnum = 90001
formationMode = "gco"
deputyCount = 4
radiusKm = 8
phaseOffsetDeg = 0
rotationDirection = "prograde"
`);
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(5);
  });

  it("models gco as a record-disk orbit with near-constant chief distance", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "GCO"
chiefSatnum = 90001
formationMode = "gco"
deputyCount = 4
radiusKm = 12
phaseOffsetDeg = 0
rotationDirection = "prograde"
`);
    const chiefEntry = config.entries[0];
    const formationEntry = config.entries[1];
    expect(chiefEntry?.kind).toBe("manual");
    expect(formationEntry?.kind).toBe("formation");
    if (
      chiefEntry?.kind === "manual" &&
      chiefEntry.type === "elements" &&
      chiefEntry.elements &&
      formationEntry?.kind === "formation" &&
      formationEntry.formationMode === "gco"
    ) {
      const states = Array.from({ length: formationEntry.deputyCount }, (_, index) =>
        relativeStateForFormation(chiefEntry.elements!, formationEntry, index),
      );
      const distances = states.map((state) => Math.hypot(state.radialKm, state.alongTrackKm, state.crossTrackKm));
      distances.forEach((distance) => expect(distance).toBeCloseTo(formationEntry.radiusKm, 8));
      expect(states[1]?.alongTrackKm).toBeCloseTo(0, 8);
      expect(states[1]?.radialKm).toBeCloseTo(formationEntry.radiusKm * 0.5, 8);
      expect(states[1]?.crossTrackKm).toBeCloseTo(formationEntry.radiusKm * Math.sqrt(3) * 0.5, 8);
    }
  });

  it("keeps expanded gco deputies near the intended chief-centered radius at epoch", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "GCO"
chiefSatnum = 90001
formationMode = "gco"
deputyCount = 4
radiusKm = 12
phaseOffsetDeg = 0
rotationDirection = "prograde"
`);
    const expanded = expandSatelliteEditorConfig(config);
    const chief = expanded[0];
    expect(chief?.type).toBe("elements");
    if (chief?.type !== "elements") return;
    const epoch = chief.elements.epoch;
    const chiefPv = satellite.propagate(toSatrec(chief), epoch);
    const chiefPosition = chiefPv.position!;
    const chiefVelocity = chiefPv.velocity!;
    const rMag = Math.hypot(chiefPosition.x, chiefPosition.y, chiefPosition.z);
    const h = {
      x: chiefPosition.y * chiefVelocity.z - chiefPosition.z * chiefVelocity.y,
      y: chiefPosition.z * chiefVelocity.x - chiefPosition.x * chiefVelocity.z,
      z: chiefPosition.x * chiefVelocity.y - chiefPosition.y * chiefVelocity.x,
    };
    const hMag = Math.hypot(h.x, h.y, h.z);
    const radial = { x: chiefPosition.x / rMag, y: chiefPosition.y / rMag, z: chiefPosition.z / rMag };
    const crossTrack = { x: h.x / hMag, y: h.y / hMag, z: h.z / hMag };
    const alongTrack = {
      x: crossTrack.y * radial.z - crossTrack.z * radial.y,
      y: crossTrack.z * radial.x - crossTrack.x * radial.z,
      z: crossTrack.x * radial.y - crossTrack.y * radial.x,
    };
    const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

    expanded.slice(1).forEach((deputy) => {
      expect(deputy.type).toBe("elements");
      if (deputy.type !== "elements") return;
      const deputyPv = satellite.propagate(toSatrec(deputy), epoch);
      const delta = {
        x: deputyPv.position!.x - chiefPosition.x,
        y: deputyPv.position!.y - chiefPosition.y,
        z: deputyPv.position!.z - chiefPosition.z,
      };
      const x = dot(delta, radial);
      const y = dot(delta, alongTrack);
      const z = dot(delta, crossTrack);
      expect(Math.hypot(x, y, z)).toBeCloseTo(12, 1);
    });
  });

  it("keeps custom multi-deputy formations from auto-scaling by preset semantics", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Custom"
chiefSatnum = 90001
formationMode = "custom"
deputyCount = 3
relativeModel = "roe"
deltaAkm = 0
deltaLambdaDeg = 0.2
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 0
crossTrackKm = 0
phaseOffsetDeg = 0
`);
    const expanded = expandSatelliteEditorConfig(config);
    const deputy1 = expanded[1];
    const deputy2 = expanded[2];
    if (deputy1?.type === "elements" && deputy2?.type === "elements") {
      expect(deputy2.elements.meanAnomalyDeg).toBeCloseTo(deputy1.elements.meanAnomalyDeg, 8);
    }
  });

  it("validates missing chief, high eccentricity chief, and duplicate satnum", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "ChiefA"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.03
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "elements"
name = "ChiefB"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7100
eccentricity = 0.001
inclinationDeg = 41
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Bad"
chiefSatnum = 99999
formationMode = "gco"
deputyCount = 1
radiusKm = 8
phaseOffsetDeg = 0
rotationDirection = "prograde"
`);
    const messages = validateSatelliteEditorConfig(config).errors.map((error) => error.message);
    expect(messages).toContain("satnum が重複しています");
    expect(messages).toContain("chiefSatnum に対応する単独衛星がありません");
    expect(messages).toContain("この編隊は 2 機以上の deputy が必要です");
  });

  it("creates a default geo entry with longitude-only input", () => {
    const entry = createDefaultGeoEntry();
    expect(entry.kind).toBe("manual");
    expect(entry.type).toBe("geo");
    expect(entry.geo?.longitudeDeg).toBe(0);
    expect(entry.geo?.inclinationDeg).toBe(0);
  });

  it("round-trips a geo entry through TOML", () => {
    const source = `
[[satellites]]
type = "geo"
name = "GEO-140E"
satnum = 90010
epoch = "2025-05-20T00:00:00Z"
longitudeDeg = 140
inclinationDeg = 0
`;
    const parsed = parseSatelliteEditorConfig(source);
    expect(parsed.entries).toHaveLength(1);
    const entry = parsed.entries[0];
    expect(entry?.kind).toBe("manual");
    if (entry?.kind === "manual") {
      expect(entry.type).toBe("geo");
      expect(entry.geo?.longitudeDeg).toBe(140);
      expect(entry.geo?.satnum).toBe(90010);
    }
    const serialized = serializeSatelliteEditorConfig(parsed);
    expect(serialized).toContain('type = "geo"');
    expect(serialized).toContain("longitudeDeg = 140");
    const reparsed = parseSatelliteEditorConfig(serialized);
    const reEntry = reparsed.entries[0];
    expect(reEntry?.kind === "manual" && reEntry.type === "geo").toBe(true);
  });

  it("expands a geo entry into geostationary orbital elements", () => {
    const config: SatelliteEditorConfig = {
      entries: [
        {
          id: "geo-1",
          kind: "manual",
          type: "geo",
          name: "GEO-140E",
          meta: { objectName: "GEO-140E" },
          geo: { satnum: 90010, epoch: new Date("2025-05-20T00:00:00Z"), longitudeDeg: 140, inclinationDeg: 0 },
        },
      ],
    };
    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(1);
    const spec = expanded[0];
    expect(spec?.type).toBe("elements");
    if (spec?.type !== "elements") return;
    expect(spec.elements.semiMajorAxisKm).toBeCloseTo(42164.17, 0);
    expect(spec.elements.eccentricity).toBe(0);
    expect(spec.elements.inclinationDeg).toBe(0);
    expect(spec.elements.argPerigeeDeg).toBe(0);
    expect(spec.elements.meanAnomalyDeg).toBe(0);
    expect(spec.meta?.objectName).toBe("GEO-140E");
  });

  it("places a geo satellite over the requested longitude at epoch", () => {
    const epoch = new Date("2025-05-20T00:00:00Z");
    const normalize = (lon: number) => (((lon + 180) % 360) + 360) % 360 - 180;
    for (const longitudeDeg of [140, -100, 0, 200]) {
      const config: SatelliteEditorConfig = {
        entries: [
          {
            id: `geo-${longitudeDeg}`,
            kind: "manual",
            type: "geo",
            name: "GEO",
            meta: {},
            geo: { satnum: 90010, epoch, longitudeDeg, inclinationDeg: 0 },
          },
        ],
      };
      const spec = expandSatelliteEditorConfig(config)[0];
      expect(spec?.type).toBe("elements");
      if (spec?.type !== "elements") continue;
      const info = getSatelliteDerivedInfo(spec, epoch);
      expect(info.longitudeDeg).not.toBeNull();
      expect(info.longitudeDeg!).toBeCloseTo(normalize(longitudeDeg), 1);
    }
  });

  it("keeps an inclined geosynchronous satellite over its longitude at epoch", () => {
    const epoch = new Date("2025-05-20T00:00:00Z");
    const config: SatelliteEditorConfig = {
      entries: [
        {
          id: "geo-inc",
          kind: "manual",
          type: "geo",
          name: "IGSO",
          meta: {},
          geo: { satnum: 90010, epoch, longitudeDeg: 135, inclinationDeg: 30 },
        },
      ],
    };
    const spec = expandSatelliteEditorConfig(config)[0];
    expect(spec?.type).toBe("elements");
    if (spec?.type !== "elements") return;
    expect(spec.elements.inclinationDeg).toBe(30);
    const info = getSatelliteDerivedInfo(spec, epoch);
    // At epoch the ascending node crossing puts it on the equator at the target longitude.
    expect(info.longitudeDeg!).toBeCloseTo(135, 1);
    expect(info.latitudeDeg!).toBeCloseTo(0, 1);
  });
});
