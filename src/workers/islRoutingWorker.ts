/// <reference lib="webworker" />
import * as satellite from "satellite.js";
import { toSatrec } from "../lib/satellites";
import { resolveIslParticipantIndices } from "../lib/isl/participants";
import { pathEdgeKeys } from "../lib/isl/edgeKey";
import { buildSnapshotGraph } from "../lib/isl/graph";
import { findShortestPath } from "../lib/isl/shortestPath";
import { applyStabilityPenalties } from "../lib/isl/stability";
import { DEFAULT_REMAINING_LINK_TIME_STEP_S } from "../lib/isl/geometry";
import { propagateAll, type PropagateAllResult } from "../lib/isl/propagate";
import type { Vec3 } from "../lib/isl/geometry";
import type { IslPathResult, IslShellRange } from "../lib/isl/types";
import type {
  IslRoutingWorkerRequest,
  IslRoutingWorkerResponse,
  IslRoutingWorkerSettingsPayload,
} from "./islRoutingWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let satRecs: satellite.SatRec[] = [];
/**
 * Reused across every "compute"/sweep-step for the lifetime of one "init"
 * (SP-17) — `propagateAll` mutates this in place instead of allocating N
 * position objects + 2 arrays per call. Reset to undefined on "init" since
 * the satellite count may have changed.
 */
let propagateBuffer: PropagateAllResult | undefined;
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

/**
 * Memoized position/GMST prediction for the stability pass (§1.5.2). Without
 * this, every ISL edge re-propagates its own satellites at every one of
 * `remainingLinkTime`'s coarse sample times (satCount * avgEdgesPerSat * ~31
 * samples * 2 endpoints — the dominant cost when stabilityWeightMs > 0). The
 * coarse samples land on a shared (satIndex, dt) grid across every edge, so
 * caching by that pair turns the redundant re-propagation into a single call
 * per satellite per sample. Binary-search refinement dt values aren't
 * grid-aligned and are rare (only for edges that actually break, ~20 calls
 * each) — they skip the cache and are computed directly, which is fine since
 * they were never the bottleneck (isl-routing-review.md SP-13).
 */
function memoizedStabilityPredictors(
  satEciPositions: Vec3[],
  simDate: Date,
  stepS: number = DEFAULT_REMAINING_LINK_TIME_STEP_S,
) {
  const posCache = new Map<number, Vec3>();
  const gmstCache = new Map<number, number>();
  const scratchDate = new Date(simDate.getTime());

  const predictSatPosition = (satIndex: number, dt: number): Vec3 => {
    const gridIndex = dt / stepS;
    if (!Number.isInteger(gridIndex)) {
      scratchDate.setTime(simDate.getTime() + dt * 1000);
      const pv = satellite.propagate(satRecs[satIndex], scratchDate);
      return pv?.position ?? satEciPositions[satIndex];
    }
    const key = satIndex * 1_000_000 + gridIndex;
    const cached = posCache.get(key);
    if (cached) return cached;
    scratchDate.setTime(simDate.getTime() + dt * 1000);
    const pv = satellite.propagate(satRecs[satIndex], scratchDate);
    const pos = pv?.position ?? satEciPositions[satIndex];
    posCache.set(key, pos);
    return pos;
  };

  const gmstAt = (dt: number): number => {
    const gridIndex = dt / stepS;
    if (!Number.isInteger(gridIndex)) {
      return satellite.gstime(new Date(simDate.getTime() + dt * 1000));
    }
    const cached = gmstCache.get(gridIndex);
    if (cached !== undefined) return cached;
    const gmst = satellite.gstime(new Date(simDate.getTime() + dt * 1000));
    gmstCache.set(gridIndex, gmst);
    return gmst;
  };

  return { predictSatPosition, gmstAt };
}

/** Build the snapshot graph + (optional) stability pass + Dijkstra for one instant. */
function computeAt(
  simDate: Date,
  settings: IslRoutingWorkerSettingsPayload,
  previousPathEdgeKeys: Set<number> | undefined,
): IslPathResult {
  validateShellRanges(settings.shellRanges, satRecs.length);

  propagateBuffer = propagateAll(satRecs, simDate, propagateBuffer);
  const { positions: satEciPositions, valid: satEciValid } = propagateBuffer;

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
    const { predictSatPosition, gmstAt } = memoizedStabilityPredictors(satEciPositions, simDate);
    graph = applyStabilityPenalties(graph, {
      predictSatPosition,
      gmstAt,
      endpointA: settings.endpointA,
      endpointB: settings.endpointB,
      maxRangeKm: settings.linkModel.maxRangeKm,
      losMarginKm: settings.linkModel.losMarginKm,
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

ctx.addEventListener("message", (event: MessageEvent<IslRoutingWorkerRequest>) => {
  const message = event.data;
  const { id } = message;

  try {
    if (message.type === "init") {
      satRecs = message.payload.satellites.map((spec) => toSatrec(spec));
      propagateBuffer = undefined; // satellite count may have changed
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
      if (result.reachable) previousPathEdgeKeys = new Set(pathEdgeKeys(result.edges));
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
