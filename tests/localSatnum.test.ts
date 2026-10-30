import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import { LOCAL_SATNUM_MAX, LOCAL_SATNUM_MIN, isLocalSatnum, nextLocalSatnum } from "../src/lib/localSatnum";
import { toSatrec, type SatelliteSpec } from "../src/lib/satellites";
import { parseSatelliteEditorConfig, serializeSatelliteEditorConfig, validateSatelliteEditorConfig } from "../src/lib/satelliteEditorSerializer";
import { createDefaultGeoEntry, createDefaultManualEntry } from "../src/lib/satelliteEditorTypes";
import { parseSatellitesToml } from "../src/lib/tomlParsers";
import { celestrakEntryToSat, mergeImportedSatellites, satellitesToToml, type CelestrakEntry } from "../src/utils/celestrakUtils";

// A scenario saved before the catalog passed 99999: a manual chief in the
// old 9xxxx placeholder band with an auto-numbered NMC deputy.
const LEGACY_TOML = `[[satellites]]
type = "elements"
name = "Chief"
satnum = 90001
epoch = "2026-10-01T00:00:00Z"
semiMajorAxisKm = 6928.137
eccentricity = 0.001
inclinationDeg = 97.5
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[satellites]]
type = "formation"
name = "Pair"
chiefSatnum = 90001
formationMode = "nmc"
sizeKm = 1
orientationDeg = 0
equidistant = false
crossTrackSign = "north"
crossTrackOffsetKm = 0
phaseOffsetDeg = 0`;

const realObject = (norad: number, epoch = "2026-10-29T00:00:00"): CelestrakEntry => ({
  OBJECT_NAME: `REAL ${norad}`, OBJECT_ID: "2026-001A", NORAD_CAT_ID: norad,
  EPOCH: epoch, MEAN_MOTION: 15.1316623,
  ECCENTRICITY: 0.0006901, INCLINATION: 52.9956, RA_OF_ASC_NODE: 66.2329,
  ARG_OF_PERICENTER: 136.1953, MEAN_ANOMALY: 114.1468,
});

const ids = (specs: SatelliteSpec[]) => specs.map(s => s.meta?.noradCatId ?? (s.type === "elements" ? s.elements.satnum : Number(s.lines[0].slice(2, 7))));
const satnum = (spec: SatelliteSpec) => spec.type === "elements" ? spec.elements.satnum : Number(spec.lines[0].slice(2, 7));

describe("local satellite numbers", () => {
  it("allocate from the nine-digit local band", () => {
    expect(nextLocalSatnum(new Set())).toBe(LOCAL_SATNUM_MIN);
    expect(nextLocalSatnum(new Set([LOCAL_SATNUM_MIN, LOCAL_SATNUM_MIN + 1]))).toBe(LOCAL_SATNUM_MIN + 2);
    expect(nextLocalSatnum(new Set(), 90000)).toBe(LOCAL_SATNUM_MIN);
    expect(() => nextLocalSatnum(new Set([LOCAL_SATNUM_MAX]), LOCAL_SATNUM_MAX)).toThrow();
    expect(isLocalSatnum(90001)).toBe(true);
    expect(isLocalSatnum(101227)).toBe(false);
    expect(createDefaultManualEntry().elements?.satnum).toBe(LOCAL_SATNUM_MIN);
    expect(createDefaultGeoEntry().geo?.satnum).toBe(LOCAL_SATNUM_MIN);
  });

  it("keeps legacy 9xxxx satnums and chief references when round-tripping TOML", () => {
    const serialized = serializeSatelliteEditorConfig(parseSatelliteEditorConfig(LEGACY_TOML));
    expect(serialized).toContain("satnum = 90001");
    expect(serialized).toContain("chiefSatnum = 90001");
    const specs = parseSatellitesToml(serialized);
    expect(specs).toHaveLength(2);
    expect(satnum(specs[0])).toBe(90001);
  });

  it("numbers deputies outside the real catalog without duplicates", () => {
    const text = LEGACY_TOML.replaceAll("90001", "99999") + `

[[satellites]]
type = "formation"
name = "Train"
chiefSatnum = 99999
formationMode = "alongTrack"
deputyCount = 4
spacingKm = 10
arrangement = "centered"
direction = "prograde"

[[satellites]]
type = "elements"
name = "Imported six-digit object"
noradCatId = 101227
satnum = 101227
objectId = "2026-150A"
epoch = "2026-10-01T00:00:00Z"
semiMajorAxisKm = 7000
eccentricity = 0.001
inclinationDeg = 53
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0`;
    const specs = parseSatellitesToml(text);
    const deputies = specs.filter(s => s.meta?.objectName?.startsWith("Pair") || s.meta?.objectName?.startsWith("Train"));
    expect(deputies).toHaveLength(5);
    for (const deputy of deputies) {
      expect(satnum(deputy)).toBeGreaterThanOrEqual(LOCAL_SATNUM_MIN);
      expect(deputy.meta?.noradCatId).toBe(satnum(deputy));
    }
    expect(new Set(specs.map(satnum)).size).toBe(specs.length);
    const position = satellite.propagate(toSatrec(deputies[0]), new Date("2026-10-01T01:00:00Z"));
    expect(position?.position).toBeTruthy();
  });

  it("moves manual satellites aside instead of overwriting them with a real 9xxxx object", () => {
    const imported = celestrakEntryToSat(realObject(90001));
    const merged = mergeImportedSatellites(parseSatellitesToml(LEGACY_TOML), [imported]);
    expect(merged).toHaveLength(3);
    const chief = merged.find(s => s.meta?.objectName === "Chief");
    expect(chief).toBeDefined();
    expect(satnum(chief!)).toBeGreaterThanOrEqual(LOCAL_SATNUM_MIN);
    expect(merged.find(s => s.meta?.objectName?.startsWith("Pair"))).toBeDefined();
    expect(merged).toContainEqual(imported);
    expect(new Set(ids(merged)).size).toBe(merged.length);

    // The scenario written back to the editor must still be valid.
    const text = satellitesToToml(merged);
    expect(validateSatelliteEditorConfig(parseSatelliteEditorConfig(text)).errors).toEqual([]);
    expect(parseSatellitesToml(text)).toHaveLength(3);
  });

  it("moves stored deputies aside when their legacy noradCatId becomes a real object", () => {
    // Earlier imports wrote expanded deputies back with satnum = noradCatId.
    const storedDeputy = parseSatellitesToml(LEGACY_TOML.split("[[satellites]]\ntype = \"formation\"")[0]
      .replace('name = "Chief"', 'name = "Pair-1"\nnoradCatId = 90002')
      .replace("satnum = 90001", "satnum = 90002"))[0];
    const imported = celestrakEntryToSat(realObject(90002));
    const merged = mergeImportedSatellites([storedDeputy], [imported]);
    expect(merged).toHaveLength(2);
    expect(merged[0].meta?.objectName).toBe("Pair-1");
    expect(merged[0].meta?.noradCatId).toBe(satnum(merged[0]));
    expect(satnum(merged[0])).toBeGreaterThanOrEqual(LOCAL_SATNUM_MIN);
    expect(merged[1]).toEqual(imported);
  });

  it("still replaces a previously imported 9xxxx catalog object with a newer epoch", () => {
    const old = celestrakEntryToSat(realObject(90001, "2026-08-01T00:00:00"));
    const current = celestrakEntryToSat(realObject(90001));
    const merged = mergeImportedSatellites([old], [current]);
    expect(merged).toEqual([current]);
  });
});
