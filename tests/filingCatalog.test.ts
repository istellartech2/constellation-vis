import { describe, expect, it } from "bun:test";
import { FILING_CATALOG, FILING_SYSTEMS, hasPlacement, searchFilingCatalog, type FilingCatalogEntry, type FilingSystem } from "../src/lib/filings/catalog";

describe("filing catalog entries", () => {
  it("keeps ids, pages, references and reviewed hashes unique", () => {
    for (const values of [FILING_CATALOG.map(e => e.id), FILING_CATALOG.map(e => e.url), FILING_CATALOG.flatMap(e => e.reference ?? []), FILING_CATALOG.flatMap(e => e.sha256 ?? []), FILING_SYSTEMS.map(s => s.id)]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });
  it("places every entry in a declared system and series", () => {
    for (const entry of FILING_CATALOG) {
      const system = FILING_SYSTEMS.find(s => s.id === entry.system);
      expect(system?.series.some(s => s.id === entry.series)).toBe(true);
    }
    for (const system of FILING_SYSTEMS) {
      for (const series of system.series) expect(FILING_CATALOG.some(e => e.system === system.id && e.series === series.id)).toBe(true);
    }
  });
  it("links only to the official agency and records complete reviews", () => {
    for (const entry of FILING_CATALOG) {
      expect(entry.url).toMatch(entry.agency === "ITU" ? /^https:\/\/www\.itu\.int\/ITU-R\/space\/asreceived\/Publication\/DisplayPublication\/\d+$/ : /^https:\/\/docs\.fcc\.gov\//);
      expect(entry.date).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(entry.name && entry.country).toBeTruthy();
      if (entry.agency === "ITU") expect(entry.reference).toMatch(/^[A-Z]{1,4}\d{4}-\d{5}$/);
      if (entry.satellites !== undefined) expect(Number.isInteger(entry.satellites) && entry.satellites > 0).toBe(true);
      if (entry.sha256) {
        expect(hasPlacement(entry)).toBe(true);
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.preferredConfiguration && entry.note).toBeTruthy();
      }
    }
  });
});

describe("searchFilingCatalog", () => {
  const systems: FilingSystem[] = [
    { id: "a", name: "Alpha", operator: "Alpha Corp", description: "", series: [{ id: "g1", label: "第1世代" }, { id: "g2", label: "第2世代" }] },
    { id: "b", name: "Beta", operator: "", description: "", series: [{ id: "x", label: "申請" }] },
  ];
  const entry = (id: string, system: string, series: string, extra: Partial<FilingCatalogEntry> = {}): FilingCatalogEntry =>
    ({ id, system, series, name: id.toUpperCase(), country: "日本", agency: "ITU", url: "https://www.itu.int/", date: "2026-01-01", ...extra });
  const entries = [
    entry("a-10", "a", "g2"), entry("a-9", "a", "g2", { reference: "J2025-12345" }), entry("a-1", "a", "g1"),
    entry("b-1", "b", "x", { country: "米国", description: "低軌道 LEO" }),
  ];
  it("groups by system and series in declared order with natural name order", () => {
    const groups = searchFilingCatalog(entries, "", "", systems);
    expect(groups.map(g => [g.system.id, g.count])).toEqual([["a", 3], ["b", 1]]);
    expect(groups[0].series.map(s => [s.id, s.entries.map(e => e.id)])).toEqual([["g1", ["a-1"]], ["g2", ["a-9", "a-10"]]]);
  });
  it("matches system, operator and series labels as well as entry fields", () => {
    expect(searchFilingCatalog(entries, "alpha 第2世代", "", systems)[0].count).toBe(2);
    expect(searchFilingCatalog(entries, "ｊ２０２５", "", systems)[0].series[0].entries[0].id).toBe("a-9");
    expect(searchFilingCatalog(entries, "leo", "", systems).map(g => g.system.id)).toEqual(["b"]);
    expect(searchFilingCatalog(entries, "leo 日本", "", systems)).toEqual([]);
  });
  it("filters by notifying administration and drops empty groups", () => {
    expect(searchFilingCatalog(entries, "", "米国", systems).map(g => g.system.id)).toEqual(["b"]);
  });
});
