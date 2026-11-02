import { describe, expect, it } from "bun:test";
import { analyzeComparisonTimeline, timelineIntervals } from "../src/lib/comparison/timeline";
import { defaultComparisonConditions, type ComparisonScenario } from "../src/lib/constellationComparison";
import { calculateStationAccessData } from "../src/lib/visibility";
import { comparisonScenarioInputs } from "../src/lib/comparison/outages";

const scenario: ComparisonScenario = { id: "one", name: "One", gsText: `[[groundstations]]
name = "Tokyo"
latitudeDeg = 35.68
longitudeDeg = 139.76
minElevationDeg = 10
`, satText: "", constText: `[constellation]
name = "t"
epoch = 2025-05-20T00:00:00Z
[[constellation.shells]]
name = "t"
count = 3
planes = 1
apogee_altitude = 550
eccentricity = 0
inclination = 53
raan_range = 360
` };
const conditions = { ...defaultComparisonConditions(new Date("2025-05-20T00:00:00Z")), durationHours: 3, stepSeconds: 60, minElevationDeg: 10 };
const target = { kind: "points" as const, points: [{ name: "Tokyo", latitudeDeg: 35.68, longitudeDeg: 139.76 }] };

describe("shared event timeline", () => {
  it("clips initial, terminal, and short final intervals", () => {
    expect(timelineIntervals([0, 10, 20, 25], [1, 0, 1, 0])).toEqual([{ startMs: 0, endMs: 10 }, { startMs: 20, endMs: 25 }]);
    expect(timelineIntervals([0, 10], [0, 1])).toEqual([]);
  });
  it("matches the independently propagated single-satellite station access", () => {
    const result = analyzeComparisonTimeline({ scenario, conditions, target, satelliteIndex: 0, targetIndex: 0 });
    const inputs = comparisonScenarioInputs(scenario);
    const reference = calculateStationAccessData([inputs.satellites[0]], inputs.stations, new Date(conditions.startTimeIso), 3, 60);
    const expectedSeconds = reference.slice(0, -1).filter((p) => p.stations[0].visibleCount > 0).length * 60;
    const station = result.lanes.find((l) => l.kind === "station")!;
    expect(station.intervals.reduce((sum, e) => sum + (e.endMs - e.startMs) / 1000, 0)).toBe(expectedSeconds);
    expect(expectedSeconds).toBeGreaterThan(0);
    expect(result.lanes.find((l) => l.kind === "target")!.intervals).toEqual(station.intervals);
    expect(result.lanes[0].intervals.length).toBeGreaterThan(0);
    for (const lane of result.lanes) for (const e of lane.intervals) {
      expect(e.startMs).toBeGreaterThanOrEqual(result.startMs);
      expect(e.endMs).toBeLessThanOrEqual(result.endMs);
      expect(e.endMs).toBeGreaterThan(e.startMs);
    }
  });
  it("removes stopped ground-station lanes and rejects all-failed satellite selections", () => {
    const stopped = { ...scenario, outage: { failedSatelliteCount: 0, seed: 1, disabledStationIndices: [0] } };
    const result = analyzeComparisonTimeline({ scenario: stopped, conditions, target, satelliteIndex: 0, targetIndex: 0 });
    expect(result.lanes.some((l) => l.kind === "station")).toBe(false);
    expect(() => analyzeComparisonTimeline({ scenario: { ...stopped, outage: { ...stopped.outage, failedSatelliteCount: 3 } }, conditions, target, satelliteIndex: 0, targetIndex: 0 })).toThrow();
  });
});
