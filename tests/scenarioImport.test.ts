import { describe, expect, it } from "bun:test";
import { LOCAL_SATNUM_MIN } from "../src/lib/localSatnum";
import { mergeImportedIntoScenarioText } from "../src/lib/scenarioImport";
import { expandSatelliteEditorConfig, parseSatelliteEditorConfig } from "../src/lib/satelliteEditorSerializer";
import { celestrakEntryToSat, type CelestrakEntry } from "../src/utils/celestrakUtils";

const scenario = (chiefSatnum: number) => `[[satellites]]
type = "elements"
name = "Chief"
satnum = ${chiefSatnum}
epoch = "2026-10-01T00:00:00Z"
semiMajorAxisKm = 6928.137
eccentricity = 0.001
inclinationDeg = 97.5
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Train"
chiefSatnum = ${chiefSatnum}
formationMode = "alongTrack"
deputyCount = 3
spacingKm = 10
arrangement = "centered"
direction = "prograde"

[[satellites]]
type = "geo"
name = "Relay"
satnum = ${LOCAL_SATNUM_MIN + 5}
epoch = "2026-10-01T00:00:00Z"
longitudeDeg = 140
inclinationDeg = 0`;

const realObject = (norad: number): CelestrakEntry => ({
  OBJECT_NAME: `REAL ${norad}`, OBJECT_ID: "2026-001A", NORAD_CAT_ID: norad,
  EPOCH: "2026-10-29T00:00:00", MEAN_MOTION: 15.1316623,
  ECCENTRICITY: 0.0006901, INCLINATION: 52.9956, RA_OF_ASC_NODE: 66.2329,
  ARG_OF_PERICENTER: 136.1953, MEAN_ANOMALY: 114.1468,
});

describe("importing catalog objects into a scenario", () => {
  it("keeps formation definitions instead of flattening deputies", () => {
    const text = mergeImportedIntoScenarioText(scenario(LOCAL_SATNUM_MIN), [celestrakEntryToSat(realObject(25544))]);
    const entries = parseSatelliteEditorConfig(text).entries;
    expect(entries.map(e => e.kind === "manual" ? e.type : e.kind)).toEqual(["elements", "formation", "geo", "elements"]);
    const formation = entries[1];
    expect(formation.kind === "formation" && formation.chiefSatnum).toBe(LOCAL_SATNUM_MIN);
    const imported = entries[3];
    expect(imported.kind === "manual" && imported.elements?.satnum).toBe(25544);
    // Chief, three deputies, GEO relay and the imported object.
    expect(expandSatelliteEditorConfig({ entries })).toHaveLength(6);
  });

  it("moves a legacy-band chief out of the way and keeps the formation on it", () => {
    const text = mergeImportedIntoScenarioText(scenario(90001), [celestrakEntryToSat(realObject(90001))]);
    const entries = parseSatelliteEditorConfig(text).entries;
    const [chief, formation, geo, imported] = entries;
    const chiefSatnum = chief.kind === "manual" ? chief.elements?.satnum : undefined;
    expect(chiefSatnum).toBeGreaterThanOrEqual(LOCAL_SATNUM_MIN);
    expect(chiefSatnum).not.toBe(LOCAL_SATNUM_MIN + 5);
    expect(chief.kind === "manual" && chief.name).toBe("Chief");
    expect(formation.kind === "formation" && formation.chiefSatnum).toBe(chiefSatnum!);
    expect(geo.kind === "manual" && geo.type).toBe("geo");
    expect(imported.kind === "manual" && imported.meta?.objectId).toBe("2026-001A");
    expect(imported.kind === "manual" && imported.elements?.satnum).toBe(90001);
    const specs = expandSatelliteEditorConfig({ entries });
    expect(specs).toHaveLength(6);
    expect(new Set(specs.map(s => s.type === "elements" ? s.elements.satnum : 0)).size).toBe(6);
  });

  it("updates catalog entries already in the scenario", () => {
    const first = mergeImportedIntoScenarioText(scenario(LOCAL_SATNUM_MIN), [celestrakEntryToSat(realObject(25544))]);
    const newer = celestrakEntryToSat({ ...realObject(25544), EPOCH: "2026-10-30T00:00:00", MEAN_ANOMALY: 10 });
    const entries = parseSatelliteEditorConfig(mergeImportedIntoScenarioText(first, [newer])).entries;
    expect(entries).toHaveLength(4);
    const imported = entries[3];
    expect(imported.kind === "manual" && imported.elements?.meanAnomalyDeg).toBe(10);
  });
});
