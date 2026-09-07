/// <reference lib="webworker" />
/**
 * Mission-design Worker: runs the whole enumerate → screen → verify pipeline off
 * the main thread and streams progress and per-candidate results back.
 *
 * Imports `enumerate.ts` directly rather than `constellationDesign/index.ts` so
 * `toShell.ts` (and its `crypto.randomUUID`) stays out of the Worker bundle.
 * Nothing on this import graph touches `window`, `document`, React or Three.js.
 *
 * There is no cancel message. The owner terminates the Worker and builds a new
 * one, the same way `StationAccessAnalysis.tsx` aborts its sweep.
 */
import { runDesign } from "../lib/constellationDesign/enumerate";
import type {
  ConstellationDesignWorkerRequest,
  ConstellationDesignWorkerResponse,
} from "./constellationDesignWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: ConstellationDesignWorkerResponse): void {
  ctx.postMessage(message);
}

/**
 * Hands the event loop back so queued `postMessage` calls actually reach the
 * main thread. Awaited between candidates: without it the whole run is one
 * synchronous block and the progress bar jumps from 0 to 100.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

ctx.onmessage = async (event: MessageEvent<ConstellationDesignWorkerRequest>) => {
  const request = event.data;
  const { id } = request;
  post({ id, type: "ack" });

  try {
    if (request.type !== "design") {
      throw new Error(`未対応のリクエスト種別です: ${String((request as { type: string }).type)}`);
    }
    const result = await runDesign(request.payload, {
      onProgress: (progress) => post({ id, type: "progress", payload: progress }),
      onPartial: (candidate) => post({ id, type: "partial", payload: { candidate } }),
      yieldNow: yieldToEventLoop,
    });
    post({ id, type: "result", payload: { result } });
  } catch (error) {
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
