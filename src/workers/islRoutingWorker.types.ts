import type { SatelliteSpec } from "../lib/satellites";
import type { IslEndpoint, IslLinkModel, IslPathResult, IslShellRange } from "../lib/isl/types";

/** Sent once (and again whenever the satellite list changes) so the worker can build its own satrecs. */
export interface IslRoutingWorkerInitPayload {
  satellites: SatelliteSpec[];
}

export interface IslRoutingWorkerInitRequest {
  id: number;
  type: "init";
  payload: IslRoutingWorkerInitPayload;
}

/** Common routing settings shared by "compute" and "sweep" requests. */
export interface IslRoutingWorkerSettingsPayload {
  participantSatnums: number[];
  endpointA: IslEndpoint;
  endpointB: IslEndpoint;
  linkModel: IslLinkModel;
  shellRanges: IslShellRange[];
  shellLinkModels?: Record<string, Partial<IslLinkModel>>;
  hopPenaltyMs: number;
  kindPenaltyMs?: Record<string, number>;
  switchDiscount: number;
  /** w_tau [ms] (§1.5.2, Phase 4); omit or <= 0 to skip the (expensive) stability pass entirely. */
  stabilityWeightMs?: number;
  /** tau_min [s] (§1.5.2, Phase 4). */
  stabilityThresholdS?: number;
}

/** Sent per recompute; the worker re-propagates from its cached satrecs at simDateIso (§2.3, §2.7). */
export interface IslRoutingWorkerComputePayload extends IslRoutingWorkerSettingsPayload {
  simDateIso: string;
  /** Undirected edge keys of the previously adopted path, for hysteresis (§1.5.1). */
  previousPathEdgeKeys?: string[];
}

export interface IslRoutingWorkerComputeRequest {
  id: number;
  type: "compute";
  payload: IslRoutingWorkerComputePayload;
}

/** Sweeps a time window, threading hysteresis across steps internally (§2.5.4, Phase 4). */
export interface IslRoutingWorkerSweepPayload extends IslRoutingWorkerSettingsPayload {
  startIso: string;
  durationS: number;
  stepS: number;
}

export interface IslRoutingWorkerSweepRequest {
  id: number;
  type: "sweep";
  payload: IslRoutingWorkerSweepPayload;
}

export type IslRoutingWorkerRequest =
  | IslRoutingWorkerInitRequest
  | IslRoutingWorkerComputeRequest
  | IslRoutingWorkerSweepRequest;

export interface IslRoutingWorkerAck {
  id: number;
  type: "ack";
}

export interface IslRoutingWorkerResult {
  id: number;
  type: "result";
  payload: { result: IslPathResult };
}

export interface IslRoutingWorkerSweepResult {
  id: number;
  type: "sweepResult";
  payload: { results: IslPathResult[] };
}

export interface IslRoutingWorkerError {
  id: number;
  type: "error";
  message: string;
}

export type IslRoutingWorkerResponse =
  | IslRoutingWorkerAck
  | IslRoutingWorkerResult
  | IslRoutingWorkerSweepResult
  | IslRoutingWorkerError;
