import { describe, expect, it } from "bun:test";
import {
  applyFormationPreset,
  expandSatelliteEditorConfig,
  parseSatelliteEditorConfig,
  serializeSatelliteEditorConfig,
  validateSatelliteEditorConfig,
} from "../src/lib/satelliteEditorSerializer";
import { createDefaultFormationEntry, type SatelliteEditorConfig } from "../src/lib/satelliteEditorTypes";

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
    const source = await Bun.file("/Users/ist/Documents/git/constellation-vis/public/satellites.toml").text();

    const parsed = parseSatelliteEditorConfig(source);
    expect(parsed.entries).toHaveLength(3);

    const serialized = serializeSatelliteEditorConfig(parsed);
    const reparsed = parseSatelliteEditorConfig(serialized);

    expect(reparsed.entries).toHaveLength(3);
    expect(reparsed.entries[0]?.kind).toBe("manual");
    expect(reparsed.entries[1]?.kind).toBe("manual");
    expect(reparsed.entries[2]?.kind).toBe("manual");
  });

  it("preserves entry order when entries are reordered and serialized", () => {
    const config = parseSatelliteEditorConfig(`
[[satellites]]
type = "elements"
name = "A"
satnum = 90001
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 40
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "elements"
name = "B"
satnum = 90002
epoch = "2025-05-20T00:00:00Z"
semiMajorAxisKm = 7100
eccentricity = 0.001
inclinationDeg = 41
raanDeg = 2
argPerigeeDeg = 1
meanAnomalyDeg = 3
`);

    const reordered: SatelliteEditorConfig = {
      entries: [config.entries[1]!, config.entries[0]!],
    };

    const serialized = serializeSatelliteEditorConfig(reordered);
    expect(serialized.indexOf('name = "B"')).toBeLessThan(serialized.indexOf('name = "A"'));
  });

  it("round-trips formation blocks", () => {
    const formationToml = `
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
deputyCount = 3
relativeModel = "roe"
preset = "along-track-train"
deltaAkm = 0
deltaLambdaDeg = 0.2
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 15
crossTrackKm = 0
phaseOffsetDeg = 0
`;

    const parsed = parseSatelliteEditorConfig(formationToml);
    const serialized = serializeSatelliteEditorConfig(parsed);
    const reparsed = parseSatelliteEditorConfig(serialized);

    expect(reparsed.entries).toHaveLength(2);
    expect(reparsed.entries[1]?.kind).toBe("formation");
    expect(reparsed.entries[1] && "relativeModel" in reparsed.entries[1] ? reparsed.entries[1].relativeModel : "").toBe("roe");
  });

  it("expands formation entries from a chief reference", () => {
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
name = "Projected"
chiefSatnum = 90001
deputyCount = 2
relativeModel = "relativeState"
preset = "projected-circular"
deltaAkm = 0
deltaLambdaDeg = 0
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 8
alongTrackKm = 0
crossTrackKm = 8
phaseOffsetDeg = 90
`);

    const expanded = expandSatelliteEditorConfig(config);
    expect(expanded).toHaveLength(3);
    expect(expanded[1]?.type).toBe("elements");
    expect(expanded[2]?.type).toBe("elements");
    expect(expanded[1]?.meta?.objectName).toBe("Projected-1");
    expect(expanded[2]?.meta?.objectName).toBe("Projected-2");
  });

  it("supports both roe and relativeState presets", () => {
    const roePreset = applyFormationPreset("along-track-train");
    const statePreset = applyFormationPreset("projected-circular");
    const gcoPreset = applyFormationPreset("general-circular-orbit");

    expect(roePreset.roe.deltaLambdaDeg).not.toBe(0);
    expect(statePreset.relativeState.crossTrackKm).not.toBe(0);
    expect(gcoPreset.relativeState.crossTrackKm).toBeCloseTo(gcoPreset.relativeState.radialKm * Math.sqrt(3), 3);
  });

  it("starts new formations in custom mode with one deputy", () => {
    const entry = createDefaultFormationEntry();

    expect(entry.preset).toBe("custom");
    expect(entry.deputyCount).toBe(1);
    expect(entry.relativeState.alongTrackKm).toBe(0);
  });

  it("does not auto-scale custom formations when deputy count increases", () => {
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
name = "CustomFormation"
chiefSatnum = 90001
deputyCount = 3
relativeModel = "roe"
preset = "custom"
deltaAkm = 0
deltaLambdaDeg = 0.1
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
    const deputy3 = expanded[3];

    expect(deputy1?.type).toBe("elements");
    expect(deputy2?.type).toBe("elements");
    expect(deputy3?.type).toBe("elements");
    if (deputy1?.type === "elements" && deputy2?.type === "elements" && deputy3?.type === "elements") {
      expect(deputy2.elements.meanAnomalyDeg).toBeCloseTo(deputy1.elements.meanAnomalyDeg, 8);
      expect(deputy3.elements.meanAnomalyDeg).toBeCloseTo(deputy1.elements.meanAnomalyDeg, 8);
    }
  });

  it("scales preset formations outward by deputy index", () => {
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
deputyCount = 3
relativeModel = "roe"
preset = "along-track-train"
deltaAkm = 0
deltaLambdaDeg = 0.2
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 15
crossTrackKm = 0
phaseOffsetDeg = 0
`);

    const expanded = expandSatelliteEditorConfig(config);
    const chief = expanded[0];
    const deputy1 = expanded[1];
    const deputy2 = expanded[2];
    const deputy3 = expanded[3];

    if (
      chief?.type === "elements" &&
      deputy1?.type === "elements" &&
      deputy2?.type === "elements" &&
      deputy3?.type === "elements"
    ) {
      const delta1 = deputy1.elements.meanAnomalyDeg - chief.elements.meanAnomalyDeg;
      const delta2 = deputy2.elements.meanAnomalyDeg - chief.elements.meanAnomalyDeg;
      const delta3 = deputy3.elements.meanAnomalyDeg - chief.elements.meanAnomalyDeg;

      expect(delta2).toBeCloseTo(delta1 * 2, 8);
      expect(delta3).toBeCloseTo(delta1 * 3, 8);
    }
  });

  it("scales gco deputies outward while preserving the preset pattern", () => {
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
deputyCount = 2
relativeModel = "relativeState"
preset = "general-circular-orbit"
deltaAkm = 0
deltaLambdaDeg = 0
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 8
alongTrackKm = 0
crossTrackKm = 13.856
phaseOffsetDeg = 90
`);

    const expanded = expandSatelliteEditorConfig(config);
    const chief = expanded[0];
    const deputy1 = expanded[1];
    const deputy2 = expanded[2];

    if (chief?.type === "elements" && deputy1?.type === "elements" && deputy2?.type === "elements") {
      const eccentricityDelta1 = Math.abs(deputy1.elements.eccentricity - chief.elements.eccentricity);
      const eccentricityDelta2 = Math.abs(deputy2.elements.eccentricity - chief.elements.eccentricity);
      const raanDelta1 = Math.abs(deputy1.elements.raanDeg - chief.elements.raanDeg);
      const raanDelta2 = Math.abs(deputy2.elements.raanDeg - chief.elements.raanDeg);

      expect(eccentricityDelta2).toBeGreaterThan(eccentricityDelta1);
      expect(raanDelta2).toBeGreaterThan(raanDelta1);
    }
  });

  it("reports missing chief, high chief eccentricity, and duplicate satnum errors", () => {
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
name = "BadFormation"
chiefSatnum = 99999
deputyCount = 0
relativeModel = "roe"
preset = "custom"
deltaAkm = 0
deltaLambdaDeg = 0
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 0
crossTrackKm = 0
phaseOffsetDeg = 0
`);

    const missingChiefErrors = validateSatelliteEditorConfig(config).errors.map((error) => error.message);
    expect(missingChiefErrors).toContain("satnum が重複しています");
    expect(missingChiefErrors).toContain("chiefSatnum に対応する単独衛星がありません");
    expect(missingChiefErrors).toContain("deputyCount は 1 以上の整数が必要です");

    const nearCircularConfig = parseSatelliteEditorConfig(`
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
type = "formation"
name = "Formation"
chiefSatnum = 90001
deputyCount = 2
relativeModel = "roe"
preset = "custom"
deltaAkm = 0
deltaLambdaDeg = 0
deltaEx = 0
deltaEy = 0
deltaIxDeg = 0
deltaIyDeg = 0
radialKm = 0
alongTrackKm = 0
crossTrackKm = 0
phaseOffsetDeg = 0
`);

    const nearCircularErrors = validateSatelliteEditorConfig(nearCircularConfig).errors.map((error) => error.message);
    expect(nearCircularErrors).toContain("chief は near-circular 前提のため離心率 0.02 以下が必要です");
  });
});
