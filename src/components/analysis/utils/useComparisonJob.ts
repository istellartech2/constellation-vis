import { useCallback, useEffect, useRef, useState } from "react";
import type { ComparisonResult } from "../../../lib/constellationComparison";
import type { ComparisonJob, WorkerResponse } from "../../../workers/comparisonWorker.types";
import type { ComparisonTimeline, ComparisonTimelineJob } from "../../../lib/comparison/timeline";
import { AnalysisCancelledError } from "./useAccessGridJob";

function useComparisonWorker<Job, Result>(mode: "compare" | "timeline") {
  const workerRef = useRef<Worker | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    rejectRef.current?.(new AnalysisCancelledError());
    rejectRef.current = null;
    setProgress(null);
  }, []);
  const run = useCallback((job: Job) => {
    cancel();
    setProgress(0);
    return new Promise<Result>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("../../../workers/comparisonWorker.ts", import.meta.url), { type: "module" });
      } catch {
        setProgress(null);
        reject(new Error("解析ワーカーを開始できません。ブラウザを再読み込みしてお試しください"));
        return;
      }
      workerRef.current = worker;
      rejectRef.current = reject;
      const finish = () => { worker.terminate(); workerRef.current = null; rejectRef.current = null; setProgress(null); };
      worker.onmessage = (event: MessageEvent<WorkerResponse<Result>>) => {
        if (workerRef.current !== worker) return;
        const message = event.data;
        if (message.type === "progress") setProgress(message.fraction);
        else {
          finish();
          if (message.type === "success") resolve(message.result);
          else reject(new Error(message.message));
        }
      };
      worker.onerror = () => { if (workerRef.current !== worker) return; finish(); reject(new Error("比較ワーカーでエラーが発生しました")); };
      try { worker.postMessage({ mode, payload: job }); }
      catch { finish(); reject(new Error("解析条件をワーカーへ渡せませんでした")); }
    });
  }, [cancel, mode]);
  useEffect(() => () => {
    workerRef.current?.terminate();
    rejectRef.current?.(new AnalysisCancelledError());
  }, []);
  return { run, cancel, progress };
}

export function useComparisonJob() { return useComparisonWorker<ComparisonJob, ComparisonResult>("compare"); }
export function useComparisonTimelineJob() { return useComparisonWorker<ComparisonTimelineJob, ComparisonTimeline>("timeline"); }
