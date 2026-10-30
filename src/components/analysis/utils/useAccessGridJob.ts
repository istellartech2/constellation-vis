import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccessGridJob,
  AccessGridRequest,
  AccessGridResponse,
  AccessGridResult,
} from "../../../workers/accessGridWorker.types";

export class AnalysisCancelledError extends Error {
  constructor() {
    super("解析を中止しました");
    this.name = "AnalysisCancelledError";
  }
}

interface Pending {
  id: number;
  resolve: (result: AccessGridResult) => void;
  reject: (error: Error) => void;
}

/**
 * Runs access-grid jobs in a Web Worker so the page stays responsive.
 * `progress` is null when idle, otherwise 0–1. `cancel()` terminates the
 * worker (the only way to stop a synchronous computation) and the next
 * `run()` starts a fresh one.
 */
export function useAccessGridJob() {
  const [progress, setProgress] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const nextId = useRef(0);

  const dispose = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const settle = useCallback(() => {
    pendingRef.current = null;
    setProgress(null);
  }, []);

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../../../workers/accessGridWorker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<AccessGridResponse>) => {
      const pending = pendingRef.current;
      const message = event.data;
      if (!pending || message.id !== pending.id) return;
      if (message.type === "progress") {
        setProgress(message.fraction);
      } else if (message.type === "success") {
        settle();
        pending.resolve(message.payload);
      } else {
        settle();
        pending.reject(new Error(message.message));
      }
    });
    worker.addEventListener("error", (event) => {
      const pending = pendingRef.current;
      if (!pending) return;
      settle();
      dispose();
      pending.reject(new Error(event.message || "解析ワーカーでエラーが発生しました"));
    });
    workerRef.current = worker;
    return worker;
  }, [dispose, settle]);

  const run = useCallback(
    (job: AccessGridJob): Promise<AccessGridResult> => {
      // A new run supersedes an unfinished one.
      if (pendingRef.current) {
        pendingRef.current.reject(new AnalysisCancelledError());
        dispose();
      }
      const id = ++nextId.current;
      setProgress(0);
      return new Promise<AccessGridResult>((resolve, reject) => {
        pendingRef.current = { id, resolve, reject };
        const request: AccessGridRequest = { id, type: "analyze", payload: job };
        getWorker().postMessage(request);
      });
    },
    [dispose, getWorker],
  );

  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    dispose();
    settle();
    pending?.reject(new AnalysisCancelledError());
  }, [dispose, settle]);

  useEffect(() => () => {
    pendingRef.current = null;
    dispose();
  }, [dispose]);

  return { run, cancel, progress, running: progress !== null };
}
