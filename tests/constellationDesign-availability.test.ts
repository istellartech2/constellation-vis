import { describe, it, expect } from "bun:test";
import { scoreAvailability, evaluatedAvailability } from "../src/lib/constellationDesign/availability";
import { runDesign, assertSupportedRequest } from "../src/lib/constellationDesign/enumerate";
import { DEFAULT_MISSION_FORM, formToRequest, constraintsFromShell, validateMissionForm } from "../src/lib/missionDesignForm";
import { candidateToShell } from "../src/lib/constellationDesign/toShell";
import { parseConstellationConfig, serializeConstellationConfig } from "../src/lib/constellationSerializer";
import { createNewShell } from "../src/lib/constellationTypes";

const epoch = "2025-05-20T00:00:00Z";

describe("availability requirements", () => {
  it("keeps area average separate from the lowest latitude average", () => {
    const screen = { minFold: 0, meanFold: 1, foldAvailability: 0.99, worstLatitudeAvailability: 0.8, testCount: 1 };
    expect(scoreAvailability(screen, "areaAverage")).toBe(0.99);
    expect(scoreAvailability(screen, "worstLatitude")).toBe(0.8);
    expect(evaluatedAvailability({ ...screen, evaluationAvailability: 0.8 })).toBe(0.8);
    expect(scoreAvailability({ ...screen, perLatitude: [{ latitudeDeg: 50, minFold: 0, meanFold: 1, foldAvailability: 0.7 }] }, "worstLatitude")).toBe(0.7);
  });

  it("validates percentages and request ratios", () => {
    for (const value of [0, -1, 101, NaN]) {
      expect(validateMissionForm({ ...DEFAULT_MISSION_FORM, targetAvailabilityPercent: value }).length).toBeGreaterThan(0);
    }
    const request = formToRequest({ ...DEFAULT_MISSION_FORM, targetAvailabilityPercent: 99.5 }, epoch);
    expect(request.constraints.continuousThreshold).toBe(0.995);
    for (const continuousThreshold of [0, -1, 1.01, NaN]) {
      expect(() => assertSupportedRequest({ ...request, constraints: { ...request.constraints, continuousThreshold } })).toThrow();
    }
  });

  it("uses the requested goal and basis in actual screening and SGP4 verification", async () => {
    const form = { ...DEFAULT_MISSION_FORM, objective: "fixedBudget" as const,
      satelliteBudget: 308, family: "walkerDelta" as const, region: "latitudeBand" as const,
      latMinDeg: -50, latMaxDeg: 50, altitudeMinKm: 600, altitudeMaxKm: 600,
      restrictInclination: true, inclinationMinDeg: 47.18487341111228,
      inclinationMaxDeg: 47.18487341111228, topK: 1, targetAvailabilityPercent: 99 };
    for (const availabilityBasis of ["areaAverage", "worstLatitude"] as const) {
      const request = formToRequest({ ...form, availabilityBasis }, epoch);
      const result = await runDesign(request);
      const candidate = result.best!;
      expect(candidate.verified).toBeDefined();
      expect(candidate.screen!.evaluationAvailability).toBe(scoreAvailability(candidate.screen!, availabilityBasis));
      expect(candidate.verified!.evaluationAvailability).toBe(scoreAvailability(candidate.verified!, availabilityBasis));
      expect(candidate.feasible).toBe(candidate.verified!.evaluationAvailability! >= 0.99);
      const shell = candidateToShell(candidate, { request });
      const config = parseConstellationConfig(serializeConstellationConfig({ epoch: new Date(epoch), shells: [shell] }));
      const restored = constraintsFromShell(config.shells[0]);
      expect(restored.targetAvailabilityPercent).toBe(99);
      expect(restored.availabilityBasis).toBe(availabilityBasis);
    }
    const strict = await runDesign(formToRequest({ ...form, availabilityBasis: "areaAverage", targetAvailabilityPercent: 99.99 }, epoch));
    expect(strict.best!.feasible).toBe(false);
  });

  it("restores legacy designs with average scoring and uses worst-latitude scoring for new designs", () => {
    const shell = createNewShell("walker_delta");
    expect(constraintsFromShell(shell).availabilityBasis).toBe("worstLatitude");
    expect(constraintsFromShell({ ...shell, mission_objective: "minSatellites" }).availabilityBasis).toBe("areaAverage");
  });
});
