/// <reference lib="webworker" />
import { analyzeComparison } from "../lib/constellationComparison";
import { analyzeComparisonTimeline } from "../lib/comparison/timeline";
import type { ComparisonWorkerRequest, ComparisonWorkerResponse } from "./comparisonWorker.types";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.addEventListener("message", (event: MessageEvent<ComparisonWorkerRequest>) => {
  const post = (response: ComparisonWorkerResponse) => ctx.postMessage(response);
  try {
    let lastPost = 0;
    const progress = (fraction: number) => {
      if (performance.now() - lastPost < 100) return;
      lastPost = performance.now();
      post({ type: "progress", fraction });
    };
    const request = event.data;
    if (request.mode === "timeline") {
      post({ type: "success", result: analyzeComparisonTimeline(request.payload, progress) });
    } else {
      const { scenario, conditions, target } = request.payload;
      post({ type: "success", result: analyzeComparison(scenario, conditions, target, progress) });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "比較解析エラー" });
  }
});
