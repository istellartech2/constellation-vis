import type { ComparisonConditions, ComparisonResult, ComparisonScenario, ComparisonTarget } from "../lib/constellationComparison";
import type { ComparisonTimeline, ComparisonTimelineJob } from "../lib/comparison/timeline";
export interface ComparisonJob { scenario: ComparisonScenario; conditions: ComparisonConditions; target: ComparisonTarget }
export type ComparisonWorkerRequest = { mode: "compare"; payload: ComparisonJob } | { mode: "timeline"; payload: ComparisonTimelineJob };
export type WorkerResponse<T> =
  | { type: "progress"; fraction: number }
  | { type: "success"; result: T }
  | { type: "error"; message: string };
export type ComparisonWorkerResponse = WorkerResponse<ComparisonResult | ComparisonTimeline>;
