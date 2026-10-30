import { describe, expect, it } from "bun:test";
import {
  buildContactSegments,
  formatLatitude,
  latitudeRanges,
  summarizeCounts,
  summarizeNetwork,
} from "../src/components/analysis/utils/accessMetrics";
import type { StationVisibilitySample } from "../src/lib/visibility";

function samples(series: number[][], stepSeconds = 10): StationVisibilitySample[] {
  const length = series[0].length;
  return Array.from({ length }, (_, i) => ({
    time: "",
    timestamp: i * stepSeconds * 1000,
    stations: series.map((s, k) => ({ name: `S${k}`, visibleCount: s[i] })),
  }));
}

describe("summarizeCounts", () => {
  it("computes availability, redundancy, passes and gaps", () => {
    // 60 s steps: gap 2, pass (1,2,2), gap 1, pass (1), gap 3
    const counts = [0, 0, 1, 2, 2, 0, 1, 0, 0, 0];
    const s = summarizeCounts(counts, 60);
    expect(s.availabilityPct).toBeCloseTo(40);
    expect(s.redundancyPct).toBeCloseTo(20);
    expect(s.passCount).toBe(2);
    expect(s.interruptionCount).toBe(2); // the outage open at t=0 is not counted
    expect(s.maxGapMin).toBe(3);
    expect(s.avgGapMin).toBe(2);
  });

  it("handles empty and always-visible series", () => {
    expect(summarizeCounts([], 10).availabilityPct).toBe(0);
    const s = summarizeCounts([1, 1, 1], 10);
    expect(s.availabilityPct).toBe(100);
    expect(s.passCount).toBe(1);
    expect(s.maxGapMin).toBe(0);
  });
});

describe("buildContactSegments", () => {
  it("run-length encodes non-zero counts per station", () => {
    const data = samples([
      [0, 1, 1, 2, 0],
      [3, 3, 0, 0, 1],
    ]);
    const segs = buildContactSegments(data, 10);
    expect(segs).toEqual([
      { stationIndex: 0, startMs: 10_000, endMs: 30_000, count: 1 },
      { stationIndex: 0, startMs: 30_000, endMs: 40_000, count: 2 },
      { stationIndex: 1, startMs: 0, endMs: 20_000, count: 3 },
      { stationIndex: 1, startMs: 40_000, endMs: 50_000, count: 1 },
    ]);
  });
});

describe("summarizeNetwork", () => {
  it("treats any station in contact as network contact", () => {
    const data = samples([
      [1, 0, 0, 0],
      [0, 0, 1, 1],
    ]);
    const s = summarizeNetwork(data, 60);
    expect(s.availabilityPct).toBeCloseTo(75);
    expect(s.maxGapMin).toBe(1);
  });
});

describe("latitude helpers", () => {
  it("formats latitudes and finds contiguous ranges", () => {
    expect(formatLatitude(60)).toBe("60°N");
    expect(formatLatitude(-35)).toBe("35°S");
    expect(formatLatitude(0)).toBe("0°");
    const rows = [-2, -1, 0, 1, 2].map((latitude) => ({ latitude, ok: latitude !== 0 }));
    expect(latitudeRanges(rows, (r) => r.ok)).toEqual([
      [-2, -1],
      [1, 2],
    ]);
  });
});
