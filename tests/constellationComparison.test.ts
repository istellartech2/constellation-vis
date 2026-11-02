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

describe("failure and ground-station outage comparisons", () => {
  const withStations = { ...scenario, gsText: `[[groundstations]]
name = "Tokyo"
latitudeDeg = 35.68
longitudeDeg = 139.76
heightKm = 0
minElevationDeg = 0
` };
  it("reproduces seeded removal without modifying the nominal source", () => {
    const outage = { failedSatelliteCount: 3, seed: 14, disabledStationIndices: [] };
    const degraded = { ...withStations, outage };
    const a = analyzeComparison(degraded, conditions, target);
    const b = analyzeComparison(degraded, conditions, target);
    const nominal = analyzeComparison(withStations, conditions, target);
    expect(a.failedSatelliteIndices).toEqual(b.failedSatelliteIndices);
    expect(a.failedSatelliteIndices).toHaveLength(3);
    expect(a.satelliteCount).toBe(nominal.satelliteCount - 3);
    expect(a.averageAvailabilityPct).toBeLessThanOrEqual(nominal.averageAvailabilityPct);
    expect(a.networkAvailabilityPct).toBeLessThanOrEqual(nominal.networkAvailabilityPct);
    expect(scenario.constText).toBe(withStations.constText);
  });
  it("can remove all satellites and all stations; keeps their impact distinct", () => {
    const nominal = analyzeComparison(withStations, conditions, target);
    const noStations = analyzeComparison({ ...withStations, outage: { failedSatelliteCount: 0, seed: 1, disabledStationIndices: [0] } }, conditions, target);
    expect(noStations.stationCount).toBe(0);
    expect(noStations.networkAvailabilityPct).toBe(0);
    expect(noStations.networkMaxGapMin).toBe(60);
    expect(noStations.averageAvailabilityPct).toBe(nominal.averageAvailabilityPct);
    const noSatellites = analyzeComparison({ ...withStations, outage: { failedSatelliteCount: 12, seed: 1, disabledStationIndices: [] } }, conditions, target);
    expect(noSatellites.satelliteCount).toBe(0);
    expect(noSatellites.maxGapMin).toBe(60);
    expect(noSatellites.networkAvailabilityPct).toBe(0);
  });
  it("round trips failure inputs and rejects nonexistent or duplicated station indices", () => {
    const outage = { failedSatelliteCount: 3, seed: 14, disabledStationIndices: [0] };
    const saved = { ...doc, cases: [{ ...withStations, outage }] };
    expect(parseComparisonDocument(JSON.stringify(saved))).toEqual(saved);
    for (const indices of [[1], [0, 0], [-1]]) {
      expect(() => analyzeComparison({ ...withStations, outage: { ...outage, disabledStationIndices: indices } }, conditions, target)).toThrow();
    }
  });
});
