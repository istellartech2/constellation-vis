/**
 * Message contract for the mission-design Worker.
 *
 * Same `id`-keyed request/response union style as
 * `islRoutingWorker.types.ts` / `stationAccessWorker.types.ts`. There is no
 * cancel request: the owner aborts by calling `terminate()` and creating a new
 * Worker, matching `StationAccessAnalysis.tsx`.
 *
 * Everything crossing the boundary is plain structured-cloneable data
 * (`DesignRequest` in, `DesignResult`/`DesignCandidate` out) — see
 * `src/lib/constellationDesign/types.ts`.
 */
import type { DesignCandidate, DesignRequest, DesignResult } from "../lib/constellationDesign/types";

export interface ConstellationDesignWorkerDesignRequest {
  id: number;
  type: "design";
  payload: DesignRequest;
}

export type ConstellationDesignWorkerRequest = ConstellationDesignWorkerDesignRequest;

/** Sent as soon as the request is picked up, before any computation. */
export interface ConstellationDesignWorkerAck {
  id: number;
  type: "ack";
}

export interface ConstellationDesignWorkerProgress {
  id: number;
  type: "progress";
  payload: {
    phase: "screen" | "verify";
    done: number;
    total: number;
    message?: string;
  };
}

/** One candidate, streamed as soon as it is screened or verified. */
export interface ConstellationDesignWorkerPartial {
  id: number;
  type: "partial";
  payload: { candidate: DesignCandidate };
}

export interface ConstellationDesignWorkerResult {
  id: number;
  type: "result";
  payload: { result: DesignResult };
}

export interface ConstellationDesignWorkerError {
  id: number;
  type: "error";
  message: string;
}

export type ConstellationDesignWorkerResponse =
  | ConstellationDesignWorkerAck
  | ConstellationDesignWorkerProgress
  | ConstellationDesignWorkerPartial
  | ConstellationDesignWorkerResult
  | ConstellationDesignWorkerError;
