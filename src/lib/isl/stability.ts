/** Stability penalty (c_stab, §1.5.2, Phase 4) applied on top of a built snapshot graph. */
import * as satellite from "satellite.js";
import {
  elevationRad,
  endpointEci,
  endpointObserver,
  hasLineOfSight,
  linkDistanceKm,
  remainingLinkTime,
  type Vec3,
} from "./geometry";
import { stabilityPenaltyMs } from "./cost";
import { edgeKey } from "./edgeKey";
import type { GraphEdge, IslGraph } from "./graph";
import type { IslEndpoint } from "./types";

export interface StabilityParams {
  satCount: number;
  /** Predicts a satellite's ECI position `dtSeconds` after the snapshot's simDate. */
  predictSatPosition: (satIndex: number, dtSeconds: number) => Vec3;
  /** GMST at simDate + dtSeconds. */
  gmstAt: (dtSeconds: number) => number;
  endpointA: IslEndpoint;
  endpointB: IslEndpoint;
  /**
   * maxRangeKm/losMarginKm used for the forward existence re-check. Uses the
   * global link model, not per-shell overrides — c_stab is a coarse decay
   * estimate, not an exact replay of the shell-aware candidate resolution.
   */
  maxRangeKm: number;
  losMarginKm: number;
  horizonS: number;
  stepS: number;
  thresholdS: number;
  /** w_tau [ms]; a value <= 0 disables this entirely (returns the graph unchanged). */
  weightMs: number;
}

/**
 * Add c_stab to every edge in a snapshot graph by forward-sampling each edge's
 * existence condition (§1.5.2). Expensive — one `remainingLinkTime` sweep per
 * distinct edge (cached by node pair, since each undirected edge otherwise
 * appears twice in the adjacency map). Intended for Worker use only.
 */
export function applyStabilityPenalties(graph: IslGraph, params: StabilityParams): IslGraph {
  if (params.weightMs <= 0) return graph;

  const {
    satCount,
    predictSatPosition,
    gmstAt,
    endpointA,
    endpointB,
    maxRangeKm,
    losMarginKm,
    horizonS,
    stepS,
    thresholdS,
    weightMs,
  } = params;

  const remainingCache = new Map<number, number>();
  const remainingFor = (fromNodeId: number, toNodeId: number, kind: "isl" | "gsl"): number => {
    const key = edgeKey(fromNodeId, toNodeId);
    const cached = remainingCache.get(key);
    if (cached !== undefined) return cached;

    const existsAt = buildExistsAt(
      kind,
      fromNodeId,
      toNodeId,
      satCount,
      predictSatPosition,
      gmstAt,
      endpointA,
      endpointB,
      maxRangeKm,
      losMarginKm,
    );
    const tau = remainingLinkTime(existsAt, horizonS, stepS);
    remainingCache.set(key, tau);
    return tau;
  };

  const adjacency = new Map<number, GraphEdge[]>();
  for (const [nodeId, edges] of graph.adjacency) {
    adjacency.set(
      nodeId,
      edges.map((edge) => {
        const tau = remainingFor(nodeId, edge.to, edge.kind);
        const penalty = stabilityPenaltyMs(tau, thresholdS, weightMs);
        return { ...edge, costMs: edge.costMs + penalty };
      }),
    );
  }

  return { ...graph, adjacency };
}

function buildExistsAt(
  kind: "isl" | "gsl",
  fromNodeId: number,
  toNodeId: number,
  satCount: number,
  predictSatPosition: (satIndex: number, dt: number) => Vec3,
  gmstAt: (dt: number) => number,
  endpointA: IslEndpoint,
  endpointB: IslEndpoint,
  maxRangeKm: number,
  losMarginKm: number,
): (dt: number) => boolean {
  if (kind === "isl") {
    return (dt: number) => {
      const pi = predictSatPosition(fromNodeId, dt);
      const pj = predictSatPosition(toNodeId, dt);
      if (linkDistanceKm(pi, pj) > maxRangeKm) return false;
      return hasLineOfSight(pi, pj, losMarginKm);
    };
  }

  // GSL: exactly one of fromNodeId/toNodeId is an endpoint node id (>= satCount).
  const endpointNodeId = fromNodeId >= satCount ? fromNodeId : toNodeId;
  const satIndex = fromNodeId >= satCount ? toNodeId : fromNodeId;
  const endpoint = endpointNodeId === satCount ? endpointA : endpointB;

  return (dt: number) => {
    const gmst = gmstAt(dt);
    const observer = endpointObserver(endpoint);
    const stationEci = endpointEci(observer, gmst);
    const satEci = predictSatPosition(satIndex, dt);
    if (linkDistanceKm(stationEci, satEci) > maxRangeKm) return false;
    const satEcf = satellite.eciToEcf(satEci as satellite.EciVec3<number>, gmst);
    const elevation = elevationRad(observer, satEcf);
    return elevation >= satellite.degreesToRadians(endpoint.minElevationDeg);
  };
}
