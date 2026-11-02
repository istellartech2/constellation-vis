/// <reference lib="webworker" />
import { analyzeComparison } from "../lib/constellationComparison";
import type { ComparisonJob, ComparisonWorkerResponse } from "./comparisonWorker.types";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.addEventListener("message", (event: MessageEvent<ComparisonJob>) => {
  const post = (response: ComparisonWorkerResponse) => ctx.postMessage(response);
  try {
    let lastPost = 0;
    const { scenario, conditions, target } = event.data;
    const result = analyzeComparison(scenario, conditions, target, (fraction) => {
      if (performance.now() - lastPost < 100) return;
      lastPost = performance.now();
      post({ type: "progress", fraction });
    });
    post({ type: "success", result });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "比較解析エラー" });
  }
});
