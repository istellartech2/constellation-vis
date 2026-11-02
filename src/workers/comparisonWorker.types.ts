import type { ComparisonConditions, ComparisonResult, ComparisonScenario, ComparisonTarget } from "../lib/constellationComparison";
export interface ComparisonJob { scenario: ComparisonScenario; conditions: ComparisonConditions; target: ComparisonTarget }
export type ComparisonWorkerResponse =
  | { type: "progress"; fraction: number }
  | { type: "success"; result: ComparisonResult }
  | { type: "error"; message: string };
