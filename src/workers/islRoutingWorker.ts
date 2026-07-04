/// <reference lib="webworker" />
import * as satellite from "satellite.js";
import { toSatrec } from "../lib/satellites";
import { resolveIslParticipantIndices } from "../lib/isl/participants";
import { edgeKey } from "../lib/isl/edgeKey";
import { buildSnapshotGraph } from "../lib/isl/graph";
import { findShortestPath } from "../lib/isl/shortestPath";
import { applyStabilityPenalties } from "../lib/isl/stability";
import {
  DEFAULT_REMAINING_LINK_TIME_HORIZON_S,
  DEFAULT_REMAINING_LINK_TIME_STEP_S,
} from "../lib/isl/geometry";
import { propagateAll } from "../lib/isl/propagate";
import type { IslPathResult, IslShellRange } from "../lib/isl/types";
import type {
  IslRoutingWorkerRequest,
  IslRoutingWorkerResponse,
  IslRoutingWorkerSettingsPayload,
} from "./islRoutingWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

/** tau_min [s] (§1.5.2). Folded to a constant (S-2) — no UI ever wired up a way to override it. */
const DEFAULT_STABILITY_THRESHOLD_S = 60;

let satRecs: satellite.SatRec[] = [];
/** Set by "configure" and reused by every "compute" until the next one (P-2). */
let liveSettings: IslRoutingWorkerSettingsPayload | null = null;

/**
 * Guard against stale/inconsistent shellRanges (H-1): if the UI ever sends
 * ranges that don't fit the worker's own satellite count (e.g. a race between
 * an in-flight compute request and a constellation update), fail with a
 * descriptive message instead of an out-of-bounds array read.
 */
function validateShellRanges(shellRanges: IslShellRange[], satCount: number): void {
  for (const shell of shellRanges) {
    if (shell.startIndex < 0 || shell.startIndex + shell.count > satCount) {
      throw new Error(
        `シェル「${shell.name ?? shell.key}」の衛星範囲(開始 ${shell.startIndex} + ${shell.count} 機)が` +
          `現在の衛星数(${satCount} 機)と整合しません。エディタで「更新」を押し直してください。`,
      );
    }
  }
}

/** Build the snapshot graph + (optional) stability pass + Dijkstra for one instant. */
function computeAt(
  simDate: Date,
  settings: IslRoutingWorkerSettingsPayload,
  previousPathEdgeKeys: Set<number> | undefined,
): IslPathResult {
  validateShellRanges(settings.shellRanges, satRecs.length);

  const { positions: satEciPositions, valid: satEciValid } = propagateAll(satRecs, simDate);

  // Exclude satellites whose propagation failed at this instant — matches
  // the main-thread bug fix (a stale/zeroed position must never be treated
  // as a real, current satellite location for routing).
  const participantIndices = resolveIslParticipantIndices(
    satRecs.length,
    settings.shellRanges,
    settings.excludedShellKeys,
    settings.includeBaseSatellites,
  ).filter((i) => satEciValid[i]);

  const computeStartedAtMs = Date.now();
  let graph = buildSnapshotGraph({
    satEciPositions,
    participantIndices,
    endpointA: settings.endpointA,
    endpointB: settings.endpointB,
    simDate,
    linkModel: settings.linkModel,
    hopPenaltyMs: settings.cost.hopPenaltyMs,
    kindPenaltyMs: settings.cost.kindPenaltyMs,
    shellRanges: settings.shellRanges,
    shellLinkModels: settings.shellLinkModels,
  });

  const stabilityWeightMs = settings.cost.stabilityWeightMs ?? 0;
  if (stabilityWeightMs > 0) {
    graph = applyStabilityPenalties(graph, {
      satCount: satRecs.length,
      predictSatPosition: (satIndex, dt) => {
        const future = new Date(simDate.getTime() + dt * 1000);
        const pv = satellite.propagate(satRecs[satIndex], future);
        return pv?.position ?? satEciPositions[satIndex];
      },
      gmstAt: (dt) => satellite.gstime(new Date(simDate.getTime() + dt * 1000)),
      endpointA: settings.endpointA,
      endpointB: settings.endpointB,
      maxRangeKm: settings.linkModel.maxRangeKm,
      losMarginKm: settings.linkModel.losMarginKm,
      horizonS: DEFAULT_REMAINING_LINK_TIME_HORIZON_S,
      stepS: DEFAULT_REMAINING_LINK_TIME_STEP_S,
      thresholdS: DEFAULT_STABILITY_THRESHOLD_S,
      weightMs: stabilityWeightMs,
    });
  }

  return findShortestPath(
    graph,
    simDate.getTime(),
    Date.now() - computeStartedAtMs,
    {
      previousPathEdgeKeys,
      switchDiscount: settings.cost.switchDiscount,
    },
  );
}

function edgeKeysOf(result: IslPathResult): Set<number> {
  return new Set(result.edges.map((e) => edgeKey(e.fromNodeId, e.toNodeId)));
}

ctx.addEventListener("message", (event: MessageEvent<IslRoutingWorkerRequest>) => {
  const message = event.data;
  const { id } = message;

  try {
    if (message.type === "init") {
      satRecs = message.payload.satellites.map((spec) => toSatrec(spec));
      const response: IslRoutingWorkerResponse = { id, type: "ack" };
      ctx.postMessage(response);
      return;
    }

    if (message.type === "configure") {
      liveSettings = message.payload;
      const response: IslRoutingWorkerResponse = { id, type: "ack" };
      ctx.postMessage(response);
      return;
    }

    if (message.type === "compute") {
      if (!liveSettings) {
        throw new Error("ISL 経路設定が未初期化です(configure が compute より先に届いていません)。");
      }
      const { simDateIso, previousPathEdgeKeys } = message.payload;
      const result = computeAt(
        new Date(simDateIso),
        liveSettings,
        previousPathEdgeKeys ? new Set(previousPathEdgeKeys) : undefined,
      );
      const response: IslRoutingWorkerResponse = { id, type: "result", payload: { result } };
      ctx.postMessage(response);
      return;
    }

    // "sweep": walk a time window, threading hysteresis across steps internally.
    const { startIso, durationS, stepS, ...settings } = message.payload;
    const startMs = new Date(startIso).getTime();
    const results: IslPathResult[] = [];
    let previousPathEdgeKeys: Set<number> | undefined;

    for (let t = 0; t <= durationS; t += stepS) {
      const simDate = new Date(startMs + t * 1000);
      const result = computeAt(simDate, settings, previousPathEdgeKeys);
      results.push(result);
      if (result.reachable) previousPathEdgeKeys = edgeKeysOf(result);
    }

    const response: IslRoutingWorkerResponse = { id, type: "sweepResult", payload: { results } };
    ctx.postMessage(response);
  } catch (error) {
    const response: IslRoutingWorkerResponse = {
      id,
      type: "error",
      message: error instanceof Error ? error.message : "ISL経路計算でエラーが発生しました",
    };
    ctx.postMessage(response);
  }
});
