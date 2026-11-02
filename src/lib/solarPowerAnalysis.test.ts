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
  it("scales generation by the visible solar disc during penumbra", () => {
    const input = { ...createDefaultSolarPowerInput(), orbitStepSeconds: 1, sweepSteps: 2 };
    const result = analyzeSolarPower(TEST_SATELLITE, "TestSunSat", TEST_SATELLITE.elements.epoch, input);
    const samples = result.orbitSamples;
    const fullPower = input.solarArrayPowerBOL_W
      * Math.max(0, 1 - input.degradationPerYear * input.missionYears)
      * input.sunTrackingFactor * input.powerPathEfficiency;
    expect(samples.some((s) => s.sunlightFraction > 0 && s.sunlightFraction < 1)).toBe(true);
    expect(samples.some((s) => s.sunlightFraction === 0)).toBe(true);
    expect(samples.some((s) => s.sunlightFraction === 1)).toBe(true);
    for (const sample of samples) {
      expect(sample.generationW).toBeCloseTo(fullPower * sample.sunlightFraction, 10);
      expect(sample.inSunlight).toBe(sample.sunlightFraction > 0.5);
    }
  });

});

it("integrates exactly 24 hours of constant load and ends the orbit at its boundary", () => {
  const input = { ...createDefaultSolarPowerInput(), dayStepSeconds: 137, baseLoadW: 100,
    sunlightExtraLoadW: 0, eclipseExtraLoadW: 0, payloadLoadW: 0, designMarginPercent: 0, sweepSteps: 2 };
  const r = analyzeSolarPower(TEST_SATELLITE, "constant", TEST_SATELLITE.elements.epoch, input);
  expect(r.currentDay.dailyLoadWh).toBeCloseTo(2400, 8);
  expect(r.daySamples.at(-1)!.timestamp - r.daySamples[0].timestamp).toBe(86_400_000);
  expect(r.orbitSamples.at(-1)!.elapsedMinutes).toBeCloseTo(r.currentOrbit.orbitPeriodMinutes, 5);
  // Date stores integer milliseconds; allow less than one millisecond of energy.
  expect(Math.abs(r.currentOrbit.dailyLoadWh - 100 * r.currentOrbit.orbitPeriodMinutes / 60)).toBeLessThan(100 / 3_600_000);
});
