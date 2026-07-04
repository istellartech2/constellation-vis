/// <reference lib="webworker" />
import * as satellite from "satellite.js";
import { toSatrec } from "../lib/satellites";
import { resolveIslParticipantIndices } from "../lib/isl/participants";
import { buildSnapshotGraph } from "../lib/isl/graph";
import { findShortestPath } from "../lib/isl/shortestPath";
import { applyStabilityPenalties } from "../lib/isl/stability";
import {
  DEFAULT_REMAINING_LINK_TIME_HORIZON_S,
  DEFAULT_REMAINING_LINK_TIME_STEP_S,
  type Vec3,
} from "../lib/isl/geometry";
import type { IslPathResult } from "../lib/isl/types";
import type {
  IslRoutingWorkerRequest,
  IslRoutingWorkerResponse,
  IslRoutingWorkerSettingsPayload,
} from "./islRoutingWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let satRecs: satellite.SatRec[] = [];

/** Propagate all satrecs at simDate; mirrors the main thread's per-frame loop, minus rendering. */
function propagateAll(simDate: Date): { positions: Vec3[]; valid: boolean[] } {
  const positions: Vec3[] = new Array(satRecs.length);
  const valid: boolean[] = new Array(satRecs.length);
  for (let i = 0; i < satRecs.length; i++) {
    const pv = satellite.propagate(satRecs[i], simDate);
    if (pv?.position) {
      positions[i] = { x: pv.position.x, y: pv.position.y, z: pv.position.z };
      valid[i] = true;
    } else {
      positions[i] = { x: 0, y: 0, z: 0 };
      valid[i] = false;
    }
  }
  return { positions, valid };
}

/** Build the snapshot graph + (optional) stability pass + Dijkstra for one instant. */
function computeAt(
  simDate: Date,
  settings: IslRoutingWorkerSettingsPayload,
  previousPathEdgeKeys: Set<string> | undefined,
): IslPathResult {
  const { positions: satEciPositions, valid: satEciValid } = propagateAll(simDate);

  // Exclude satellites whose propagation failed at this instant — matches
  // the main-thread bug fix (a stale/zeroed position must never be treated
  // as a real, current satellite location for routing).
  const participantIndices = resolveIslParticipantIndices(
    satRecs,
    settings.participantSatnums,
  ).filter((i) => satEciValid[i]);

  const computeStartedAtMs = Date.now();
  let graph = buildSnapshotGraph({
    satEciPositions,
    participantIndices,
    endpointA: settings.endpointA,
    endpointB: settings.endpointB,
    simDate,
    linkModel: settings.linkModel,
    hopPenaltyMs: settings.hopPenaltyMs,
    kindPenaltyMs: settings.kindPenaltyMs,
    shellRanges: settings.shellRanges,
    shellLinkModels: settings.shellLinkModels,
  });

  const stabilityWeightMs = settings.stabilityWeightMs ?? 0;
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
      thresholdS: settings.stabilityThresholdS ?? 60,
      weightMs: stabilityWeightMs,
    });
  }

  return findShortestPath(
    graph,
    simDate.getTime(),
    graph.candidateEdgeCount,
    Date.now() - computeStartedAtMs,
    {
      previousPathEdgeKeys,
      switchDiscount: settings.switchDiscount,
    },
  );
}

function edgeKeysOf(result: IslPathResult): Set<string> {
  return new Set(
    result.edges.map((e) => {
      const a = Math.min(e.fromNodeId, e.toNodeId);
      const b = Math.max(e.fromNodeId, e.toNodeId);
      return `${a}-${b}`;
    }),
  );
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

    if (message.type === "compute") {
      const { simDateIso, previousPathEdgeKeys, ...settings } = message.payload;
      const result = computeAt(
        new Date(simDateIso),
        settings,
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
    let previousPathEdgeKeys: Set<string> | undefined;

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
