import { describe, expect, it } from "bun:test";
import { analyzeComparison, comparisonTargets, defaultComparisonConditions, type ComparisonScenario, type ComparisonDocument } from "../src/lib/constellationComparison";
import { comparisonReportHtml, parseComparisonDocument, currentComparisonResult } from "../src/lib/comparison/document";

const scenario: ComparisonScenario = { id: "a", name: "A", satText: "", gsText: "", constText: `[constellation]
name = "test"
epoch = 2025-05-20T00:00:00Z
[[constellation.shells]]
name = "test"
count = 12
planes = 3
phasing = 1
apogee_altitude = 550
eccentricity = 0
inclination = 53
raan_range = 360
` };
const conditions = { ...defaultComparisonConditions(new Date("2025-05-20T00:00:00Z")), durationHours: 1, stepSeconds: 47 };
const target = { kind: "points" as const, points: [{ name: "Tokyo", latitudeDeg: 35.68, longitudeDeg: 139.76 }] };
const doc: ComparisonDocument = { format: "constellation-comparison", version: 1, conditions, target, cases: [scenario] };

describe("regional constellation comparison", () => {
  it("weights partial geographic cells and crosses the date line", () => {
    const cells = comparisonTargets({ kind: "rectangle", southDeg: 0, northDeg: 15, westDeg: 170, eastDeg: -175, spacingDeg: 10 }, 25);
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.station.longitudeDeg)).toEqual([175, -177.5, 175, -177.5]);
    const area = cells.reduce((sum, c) => sum + c.weight, 0);
    expect(area).toBeCloseTo(Math.sin(15 * Math.PI / 180) * 15 * Math.PI / 180, 12);
    expect(() => comparisonTargets({ kind: "rectangle", southDeg: -90, northDeg: 90, westDeg: -179, eastDeg: 179, spacingDeg: 0.25 }, 0)).toThrow();
  });
  it("never improves availability when elevation or fold requirements are raised", () => {
    const a = analyzeComparison(scenario, conditions, target);
    const b = analyzeComparison(scenario, { ...conditions, minElevationDeg: 60 }, target);
    const c = analyzeComparison(scenario, { ...conditions, requiredFold: 4 }, target);
    expect(b.averageAvailabilityPct).toBeLessThanOrEqual(a.averageAvailabilityPct);
    expect(c.averageFoldAvailabilityPct).toBeLessThanOrEqual(a.averageFoldAvailabilityPct);
    expect(a.maxGapMin).toBeLessThanOrEqual(60);
    expect(a.points[0].foldAvailabilityPct).toBe(a.points[0].availabilityPct);
  });
  it("counts an all-uncovered point for exactly the requested duration", () => {
    const polar = { kind: "points" as const, points: [{ name: "Pole", latitudeDeg: 90, longitudeDeg: 0 }] };
    const r = analyzeComparison(scenario, conditions, polar);
    expect(r.averageAvailabilityPct).toBe(0);
    expect(r.maxGapMin).toBe(60);
    expect(r.meetsRequirements).toBe(false);
  });
  it("invalidates results when conditions or source inputs change", () => {
    const result = analyzeComparison(scenario, conditions, target);
    const saved = { ...scenario, result };
    expect(currentComparisonResult(saved, doc)).toBe(result);
    expect(currentComparisonResult(saved, { ...doc, conditions: { ...conditions, stepSeconds: 60 } })).toBeNull();
    expect(currentComparisonResult({ ...saved, gsText: "# new" }, doc)).toBeNull();
  });
  it("restores inputs, discards unverified archived results, and escapes report markup", () => {
    const restored = parseComparisonDocument(JSON.stringify({ ...doc, cases: [{ ...scenario, result: { forged: true } }] }));
    expect(restored).toEqual(doc);
    expect(() => parseComparisonDocument(JSON.stringify({ ...doc, conditions: { ...conditions, stepSeconds: 0 } }))).toThrow();
    expect(() => parseComparisonDocument(JSON.stringify({ ...doc, cases: [scenario, scenario] }))).toThrow();
    const html = comparisonReportHtml({ ...doc, cases: [{ ...scenario, name: '<script>alert("x")</script>' }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('要再解析');
  });
});
