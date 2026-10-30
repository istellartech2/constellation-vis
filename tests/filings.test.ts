import { describe, expect, it } from "bun:test";
import { parseFilingTables } from "../src/lib/filings/parse";
import { filingSatellites } from "../src/lib/filings/geometry";
import { replaceFilingText } from "../src/lib/filings/replace";
import { buildConfigBundle, parseConfigBundle, parseSatellitesToml } from "../src/lib/config";
import { parseSatelliteEditorConfig, serializeSatelliteEditorConfig } from "../src/lib/satelliteEditorSerializer";
import { createFilingExtract, filingExtractFilename, parseFilingExtract } from "../src/lib/filings/extract";
import type { FilingTables } from "../src/lib/filings/types";
import { mergeImportedSatellites } from "../src/utils/celestrakUtils";

const epoch = new Date("2026-10-29T00:00:00Z");
function fixture(): FilingTables {
  return {
    notice: [{ ntc_id: 1, adm: "J", d_rcv: epoch }], non_geo: [{ sat_name: "TEST-FILING" }],
    orbit: [
      { ntc_id: 1, orb_id: 1, orbit_set_id: 1, nbr_sat_pl: 2, inclin_ang: 40, apog_km: 1000, perig_km: 1000, long_asc: 0, act_code: "S" },
      { ntc_id: 1, orb_id: 2, orbit_set_id: 2, nbr_sat_pl: 3, inclin_ang: 50, apog_km: 1000, perig_km: 550, long_asc: 60 },
    ],
    phase: [{ ntc_id: 1, orb_id: 1, orb_sat_id: 1, phase_ang: 0 }, { ntc_id: 1, orb_id: 1, orb_sat_id: 2, phase_ang: 180 }],
  };
}
function dataset() { return parseFilingTables(fixture(), "test.mdb", "unreviewed"); }

describe("local filing import", () => {
  it("does not replace a same-named network filed through a different administration", () => {
    const first = replaceFilingText("", dataset(), "1", epoch);
    const otherTables = fixture();
    otherTables.notice[0].adm = "USA";
    const other = parseFilingTables(otherTables, "other.mdb", "different");
    const combined = replaceFilingText(first, other, "2", epoch);
    expect(parseSatellitesToml(combined)).toHaveLength(5);
    expect(new Set(parseSatellitesToml(combined).map(s => s.meta?.filingKey)).size).toBe(2);
  });
  it("does not merge a hypothetical ID with a real NORAD object", () => {
    const generated = filingSatellites(dataset(), "1", epoch)[0];
    if (generated.type !== "elements") throw Error("elements expected");
    // Scenarios saved before 2026-07 placed filings in the now-real 9xxxx band.
    const planned = { ...generated, elements: { ...generated.elements, satnum: 90000 } };
    const actual = { ...planned, elements: { ...planned.elements }, meta: { objectName: "Actual object", noradCatId: 90000 } };
    const merged = mergeImportedSatellites([planned], [actual]);
    expect(merged).toHaveLength(2);
    expect(merged[0].meta?.dataStatus).toBe("filing");
    expect(merged[0].type === "elements" && merged[0].elements.satnum).not.toBe(90000);
    expect(merged[1].meta?.noradCatId).toBe(90000);
    expect(planned.elements.satnum).toBe(90000);
  });
  it("keeps alternative counts separate and preserves action codes for review", () => {
    const d = dataset();
    expect(d.configurations.map(c => c.count)).toEqual([2, 3]);
    expect(d.configurations[0].hasSuppressedRows).toBe(true);
    expect(d.preferredConfiguration).toBe("2");
    expect(d.sourceUrl).toBe("");
    expect(d.warnings.some(w => w.includes("未レビュー"))).toBe(true);
    expect(d.warnings.some(w => w.includes("等間隔"))).toBe(true);
  });
  it("rejects invalid or ambiguous databases without producing zero satellites", () => {
    const t = fixture();
    expect(() => parseFilingTables({ ...t, non_geo: [] }, "x.mdb", "")).toThrow("SNS MDB");
    expect(() => parseFilingTables({ ...t, orbit: [] }, "x.mdb", "")).toThrow("軌道情報");
    expect(() => parseFilingTables({ ...t, orbit: [t.orbit[0], t.orbit[0]] }, "x.mdb", "")).toThrow("重複");
    expect(() => parseFilingTables({ ...t, orbit: [{ ...t.orbit[0], nbr_sat_pl: 10001 }] }, "x.mdb", "")).toThrow("対応範囲外");
    expect(() => parseFilingTables({ ...t, orbit: [{ ...t.orbit[0], perigee: 1000, perig_km: null }] }, "x.mdb", "")).toThrow("perig_km");
  });
  it("uses only the chosen geometry and explicit synthetic epoch", () => {
    const sats = filingSatellites(dataset(), "2", epoch);
    expect(sats).toHaveLength(3);
    for (const sat of sats) {
      expect(sat.meta?.dataStatus).toBe("filing");
      if (sat.type !== "elements") throw Error("elements expected");
      expect(sat.elements.epoch).toBe(epoch);
      expect(sat.elements.inclinationDeg).toBe(50);
      expect(sat.elements.eccentricity).toBeGreaterThan(0);
      expect(sat.elements.meanAnomalyDeg).toBeGreaterThanOrEqual(0);
      expect(sat.elements.meanAnomalyDeg).toBeLessThan(360);
    }
    expect(() => filingSatellites(dataset(), "missing", epoch)).toThrow("構成");
    expect(() => filingSatellites(dataset(), "2", new Date("invalid"))).toThrow("UTC");
  });
  it("switches a filing without accumulating alternatives or replacing other satellites", () => {
    const manual = `[[satellites]]\ntype = "elements"\nname = "Existing satellite"\nsatnum = 90000\nepoch = "2026-10-29T00:00:00Z"\nsemiMajorAxisKm = 7000\neccentricity = 0\ninclinationDeg = 20\nraanDeg = 0\nargPerigeeDeg = 0\nmeanAnomalyDeg = 0`;
    const first = replaceFilingText(manual, dataset(), "1", epoch);
    expect(parseSatellitesToml(first)).toHaveLength(3);
    const switched = replaceFilingText(first, dataset(), "2", epoch);
    const sats = parseSatellitesToml(switched);
    expect(sats).toHaveLength(4);
    expect(sats[0].meta?.objectName).toBe("Existing satellite");
    expect(new Set(sats.map(s => s.type === "elements" && s.elements.satnum)).size).toBe(4);
    expect(sats.slice(1).every(s => s.meta?.filingConfiguration === "2")).toBe(true);
    const saved = buildConfigBundle(serializeSatelliteEditorConfig(parseSatelliteEditorConfig(switched)), "", "", epoch);
    const restored = parseConfigBundle(saved);
    expect(restored.satellites.filter(s => s.meta?.dataStatus === "filing")).toHaveLength(3);
    expect(restored.satellites[1].meta?.filingSha256).toBe("unreviewed");
  });
});

describe("saved filing extracts", () => {
  const sha = "a".repeat(64);
  function saved(tables: FilingTables = fixture()) { return JSON.stringify(createFilingExtract(tables, "test.mdb", sha)); }
  it("round-trips through the MDB parser with the same configurations", () => {
    const original = parseFilingTables(fixture(), "test.mdb", sha);
    const { dataset: restored, extract } = parseFilingExtract(saved());
    expect(restored.configurations).toEqual(original.configurations);
    expect(restored.key).toBe(original.key);
    expect(restored.sourceDate).toBe("2026-10-29");
    expect(restored.filename).toBe("test.mdb");
    expect(restored.fromExtract).toBe(true);
    expect(restored.warnings.some(w => w.includes("抽出ファイル"))).toBe(true);
    expect(JSON.parse(JSON.stringify(extract))).toEqual(JSON.parse(saved()));
    expect(filingExtractFilename(restored)).toBe("TEST-FILING-aaaaaaaa.filing.json");
  });
  it("keeps only the columns needed for the declared geometry", () => {
    const tables = fixture();
    tables.orbit[0].freq_min = 10.7;
    tables.notice[0].sat_emis = "secret";
    const extract = JSON.parse(saved(tables));
    expect(Object.keys(extract.tables).sort()).toEqual(["non_geo", "notice", "orbit", "phase"]);
    expect(extract.tables.orbit[0].freq_min).toBeUndefined();
    expect(extract.tables.notice[0].sat_emis).toBeUndefined();
    expect(extract.tables.notice[0].d_rcv).toBe(epoch.toISOString());
  });
  it("rejects foreign, future or tampered extracts", () => {
    const valid = JSON.parse(saved());
    expect(() => parseFilingExtract("{")).toThrow("JSON");
    expect(() => parseFilingExtract(JSON.stringify({ ...valid, format: "other" }))).toThrow(".filing.json");
    expect(() => parseFilingExtract(JSON.stringify({ ...valid, version: 2 }))).toThrow("未対応");
    expect(() => parseFilingExtract(JSON.stringify({ ...valid, source: { filename: "x", sha256: "nope" } }))).toThrow("元MDB");
    expect(() => parseFilingExtract(JSON.stringify({ ...valid, tables: { ...valid.tables, phase: "x" } }))).toThrow("phase");
    const tampered = structuredClone(valid);
    tampered.tables.orbit[0].nbr_sat_pl = 10001;
    expect(() => parseFilingExtract(JSON.stringify(tampered))).toThrow("対応範囲外");
  });
});
