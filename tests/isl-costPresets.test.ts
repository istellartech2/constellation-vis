import { describe, it, expect } from "bun:test";
import { applyCostPreset, ISL_COST_PRESETS, matchCostPreset } from "../src/lib/isl/costPresets";
import { DEFAULT_COST_SETTINGS } from "../src/lib/isl/types";

describe("ISL cost presets", () => {
  it("treats the default cost settings as the balanced preset", () => {
    expect(matchCostPreset(DEFAULT_COST_SETTINGS)).toBe("balanced");
  });

  it("round-trips every preset", () => {
    for (const preset of ISL_COST_PRESETS) {
      expect(matchCostPreset(applyCostPreset(preset.id))).toBe(preset.id);
    }
  });

  it("reports hand-tuned costs as custom", () => {
    expect(matchCostPreset({ ...DEFAULT_COST_SETTINGS, hopPenaltyMs: 3 })).toBeNull();
    expect(matchCostPreset({ ...DEFAULT_COST_SETTINGS, kindPenaltyMs: { isl: 1 } })).toBeNull();
  });

  it("ignores zeroed per-kind penalties", () => {
    expect(matchCostPreset({ ...DEFAULT_COST_SETTINGS, kindPenaltyMs: { gsl: 0, isl: 0 } })).toBe("balanced");
  });
});
