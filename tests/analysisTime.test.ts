import { describe, expect, it } from "bun:test";
import { analysisTimes } from "../src/lib/analysisTime";
import { summarizeCounts } from "../src/lib/accessMetrics";

describe("bounded analysis intervals", () => {
  it("includes a partial last interval and rejects non-progressing time", () => {
    expect(analysisTimes(1000, 25, 10)).toEqual([1000, 11000, 21000, 26000]);
    for (const step of [0, -1, NaN, Infinity]) expect(() => analysisTimes(0, 25, step)).toThrow();
  });
  it("does not count the endpoint and weights the partial interval", () => {
    const m = summarizeCounts([0, 1, 1, 0], 10, 25);
    expect(m.availabilityPct).toBe(60);
    expect(m.maxGapMin).toBeCloseTo(10 / 60);
    expect(m.passCount).toBe(1);
    expect(summarizeCounts([0, 0, 0, 1], 10, 25).maxGapMin).toBeCloseTo(25 / 60);
  });
});
