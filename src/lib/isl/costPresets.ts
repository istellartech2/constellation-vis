import { DEFAULT_COST_SETTINGS, type IslCostSettings } from "./types";

export type IslCostPresetId = "fastest" | "balanced" | "stable";

/**
 * Named routing policies offered in the 通信 tab. Each sets the three
 * policy knobs; per-link-kind penalties are left to the custom view.
 */
export const ISL_COST_PRESETS: { id: IslCostPresetId; label: string; cost: Required<Omit<IslCostSettings, "kindPenaltyMs">> }[] = [
  { id: "fastest", label: "最短遅延", cost: { hopPenaltyMs: 0, switchDiscount: 0, stabilityWeightMs: 0 } },
  {
    id: "balanced",
    label: "バランス",
    cost: { hopPenaltyMs: DEFAULT_COST_SETTINGS.hopPenaltyMs, switchDiscount: DEFAULT_COST_SETTINGS.switchDiscount, stabilityWeightMs: 0 },
  },
  { id: "stable", label: "安定重視", cost: { hopPenaltyMs: 5, switchDiscount: 0.4, stabilityWeightMs: 20 } },
];

/** The preset `cost` equals, or null when it has been tuned by hand. */
export function matchCostPreset(cost: IslCostSettings): IslCostPresetId | null {
  const kindPenalties = Object.values(cost.kindPenaltyMs ?? {});
  if (kindPenalties.some((v) => v !== 0)) return null;
  const preset = ISL_COST_PRESETS.find(
    (p) =>
      p.cost.hopPenaltyMs === cost.hopPenaltyMs &&
      p.cost.switchDiscount === cost.switchDiscount &&
      p.cost.stabilityWeightMs === (cost.stabilityWeightMs ?? 0),
  );
  return preset?.id ?? null;
}

/** Apply a preset, keeping zeroed per-kind penalties out of the stored settings. */
export function applyCostPreset(id: IslCostPresetId): IslCostSettings {
  const preset = ISL_COST_PRESETS.find((p) => p.id === id)!;
  return { ...preset.cost };
}
