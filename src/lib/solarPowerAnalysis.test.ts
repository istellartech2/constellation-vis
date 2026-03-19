import { describe, expect, it } from "bun:test";
import type { SatelliteSpec } from "./satellites";
import { analyzeSolarPower, createDefaultSolarPowerInput } from "./solarPowerAnalysis";

const TEST_SATELLITE: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 91001,
    epoch: new Date("2025-05-20T00:00:00.000Z"),
    semiMajorAxisKm: 6878.137,
    eccentricity: 0.0001,
    inclinationDeg: 97.4,
    raanDeg: 0,
    argPerigeeDeg: 0,
    meanAnomalyDeg: 0,
  },
  meta: {
    objectName: "TestSunSat",
  },
};

describe("solarPowerAnalysis", () => {
  it("returns representative days and sweep points", () => {
    const input = createDefaultSolarPowerInput();
    const result = analyzeSolarPower(
      TEST_SATELLITE,
      "TestSunSat",
      new Date("2025-03-20T00:00:00.000Z"),
      input,
    );

    expect(result.representativeDays).toHaveLength(4);
    expect(result.sweep).toHaveLength(input.sweepSteps);
    expect(result.daySamples.length).toBeGreaterThan(10);
    expect(result.currentDay.minSocPercent).toBeGreaterThanOrEqual(0);
    expect(result.currentDay.minSocPercent).toBeLessThanOrEqual(100);
  });

  it("shows worse net energy when loads are increased", () => {
    const baseInput = createDefaultSolarPowerInput();
    const highLoadInput = {
      ...baseInput,
      baseLoadW: baseInput.baseLoadW * 1.8,
      payloadLoadW: baseInput.payloadLoadW * 1.5,
    };

    const baseResult = analyzeSolarPower(
      TEST_SATELLITE,
      "TestSunSat",
      new Date("2025-03-20T00:00:00.000Z"),
      baseInput,
    );
    const highLoadResult = analyzeSolarPower(
      TEST_SATELLITE,
      "TestSunSat",
      new Date("2025-03-20T00:00:00.000Z"),
      highLoadInput,
    );

    expect(highLoadResult.currentDay.dailyNetWh).toBeLessThan(baseResult.currentDay.dailyNetWh);
    expect(highLoadResult.currentDay.minSocPercent).toBeLessThanOrEqual(baseResult.currentDay.minSocPercent);
  });
});
