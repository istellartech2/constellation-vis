import type { SatelliteSpec } from "../lib/satellites";
import type {
  IslCostSettings,
  IslEndpoint,
  IslLinkModel,
  IslPathResult,
  IslSettings,
  IslShellRange,
} from "../lib/isl/types";

/** Sent once (and again whenever the satellite list changes) so the worker can build its own satrecs. */
export interface IslRoutingWorkerInitPayload {
  satellites: SatelliteSpec[];
}

export interface IslRoutingWorkerInitRequest {
  id: number;
  type: "init";
  payload: IslRoutingWorkerInitPayload;
}

/**
 * Common routing settings shared by "compute" and "sweep" requests. `cost`
 * and `linkModel` are passed as whole plain-data sub-objects rather than
 * manually flattened — adding a cost field used to mean editing every
 * one of the (now two) call sites that build this payload; a forgotten one
 * silently reverted that field to its default without either call site
 * showing an error.
 */
export interface IslRoutingWorkerSettingsPayload {
  /** Stable keys of shells excluded from participation. */
  excludedShellKeys: string[];
  includeBaseSatellites: boolean;
  endpointA: IslEndpoint;
  endpointB: IslEndpoint;
  linkModel: IslLinkModel;
  shellRanges: IslShellRange[];
  shellLinkModels?: Record<string, Partial<IslLinkModel>>;
  cost: IslCostSettings;
}

/**
 * Sent whenever the live scene's routing settings change identity (endpoints,
 * participation, link model, cost, shellRanges — anything besides the clock).
 * The worker caches this and applies it to every subsequent "compute" until
 * the next "configure": settings no longer need to be re-serialized
 * (structured-cloned) on every recompute, only on actual settings edits.
 */
export interface IslRoutingWorkerConfigureRequest {
  id: number;
  type: "configure";
  payload: IslRoutingWorkerSettingsPayload;
}

/**
 * Builds the settings payload shared by "configure" and "sweep" requests.
 * Previously hand-assembled independently in `visualization.ts` and
 * `IslRoutingAnalysis.tsx` — a forgotten field on one side silently made the
 * live scene and the sweep analysis diverge (the same drift class the
 * `cost`/`linkModel` sub-object bundling fixed).
 */
export function buildIslWorkerSettingsPayload(
  islSettings: IslSettings,
  shellRanges: IslShellRange[],
  endpointA: IslEndpoint,
  endpointB: IslEndpoint,
): IslRoutingWorkerSettingsPayload {
  return {
    excludedShellKeys: islSettings.excludedShellKeys,
    includeBaseSatellites: islSettings.includeBaseSatellites,
    endpointA,
    endpointB,
    linkModel: islSettings.linkModel,
    shellRanges,
    shellLinkModels: islSettings.shellLinkModels,
    cost: islSettings.cost,
  };
}

/**
 * Sent per recompute; the worker re-propagates from its cached satrecs at
 * simDateIso using the settings from the last "configure".
 */
export interface IslRoutingWorkerComputePayload {
  simDateIso: string;
  /** Undirected edge keys (see isl/edgeKey.ts) of the previously adopted path, for hysteresis (§1.5.1). */
  previousPathEdgeKeys?: number[];
}

export interface IslRoutingWorkerComputeRequest {
  id: number;
  type: "compute";
  payload: IslRoutingWorkerComputePayload;
}

/** Sweeps a time window, threading hysteresis across steps internally. */
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
  | IslRoutingWorkerConfigureRequest
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
