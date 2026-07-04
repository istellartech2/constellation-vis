/** Snapshot graph construction: node positions + settings -> adjacency list (§1.8, §2.2). */
import * as satellite from "satellite.js";
import type { Vec3 } from "./geometry";
import {
  gridPatternIslCandidates,
  naiveGslCandidates,
  uniformGridIslCandidates,
  type CandidateEdge,
} from "./candidates";
import { edgeCostMs } from "./cost";
import {
  endpointANodeId,
  endpointBNodeId,
  type IslEndpoint,
  type IslLinkModel,
  type IslShellRange,
} from "./types";

export interface GraphEdge {
  to: number;
  kind: "gsl" | "isl";
  distanceKm: number;
  costMs: number;
}

export interface IslGraph {
  adjacency: Map<number, GraphEdge[]>;
  candidateEdgeCount: number;
  nodeAId: number;
  nodeBId: number;
}

export interface BuildGraphInput {
  /** ECI positions [km] indexed by satellite index; all evaluated at the same simDate (§1.8). */
  satEciPositions: Vec3[];
  participantIndices: number[];
  endpointA: IslEndpoint;
  endpointB: IslEndpoint;
  simDate: Date;
  linkModel: IslLinkModel;
  hopPenaltyMs: number;
  kindPenaltyMs?: Record<string, number>;
  /** Shell index ranges for gridPattern topology + per-shell link-model overrides (Phase 3, §2.4). */
  shellRanges?: IslShellRange[];
  shellLinkModels?: Record<string, Partial<IslLinkModel>>;
}

export function buildSnapshotGraph(input: BuildGraphInput): IslGraph {
  const {
    satEciPositions,
    participantIndices,
    endpointA,
    endpointB,
    simDate,
    linkModel,
    hopPenaltyMs,
    kindPenaltyMs,
    shellRanges,
    shellLinkModels,
  } = input;

  const satCount = satEciPositions.length;
  const nodeAId = endpointANodeId(satCount);
  const nodeBId = endpointBNodeId(satCount);
  const gmst = satellite.gstime(simDate);

  const islEdges = resolveIslEdges(
    satEciPositions,
    participantIndices,
    linkModel,
    shellRanges ?? [],
    shellLinkModels,
  );
  const gslAEdges = buildGslEdgesForEndpoint(
    endpointA,
    nodeAId,
    satEciPositions,
    participantIndices,
    gmst,
    linkModel.maxRangeKm,
  );
  const gslBEdges = buildGslEdgesForEndpoint(
    endpointB,
    nodeBId,
    satEciPositions,
    participantIndices,
    gmst,
    linkModel.maxRangeKm,
  );

  const adjacency = new Map<number, GraphEdge[]>();
  const addEdge = (fromId: number, toId: number, kind: "gsl" | "isl", distanceKm: number) => {
    const penalty = kindPenaltyMs?.[kind] ?? 0;
    const costMs = edgeCostMs(distanceKm, hopPenaltyMs, penalty);
    pushAdjacency(adjacency, fromId, { to: toId, kind, distanceKm, costMs });
    pushAdjacency(adjacency, toId, { to: fromId, kind, distanceKm, costMs });
  };

  for (const e of islEdges) addEdge(e.i, e.j, "isl", e.distanceKm);
  for (const e of gslAEdges) addEdge(e.i, e.j, "gsl", e.distanceKm);
  for (const e of gslBEdges) addEdge(e.i, e.j, "gsl", e.distanceKm);

  return {
    adjacency,
    candidateEdgeCount: islEdges.length + gslAEdges.length + gslBEdges.length,
    nodeAId,
    nodeBId,
  };
}

function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/**
 * Resolve ISL candidates using the uniform-grid scan by default (§1.7.2), with
 * per-shell overrides when `shellRanges` is provided (Phase 3, §2.4):
 * gridPattern-mode shells use the structural "+Grid" generator restricted to
 * that shell only (cross-shell links are always dynamic, per design); dynamic
 * shells and cross-shell / unassigned-satellite pairs use the uniform grid,
 * with maxRangeKm resolved per-pair as the larger of the participating
 * shells' overrides (falling back to the global default).
 */
function resolveIslEdges(
  satEciPositions: Vec3[],
  participantIndices: number[],
  linkModel: IslLinkModel,
  shellRanges: IslShellRange[],
  shellLinkModels?: Record<string, Partial<IslLinkModel>>,
): CandidateEdge[] {
  if (shellRanges.length === 0) {
    return uniformGridIslCandidates(
      satEciPositions,
      participantIndices,
      linkModel.maxRangeKm,
      linkModel.losMarginKm,
    );
  }

  const participantSet = new Set(participantIndices);
  const resolvedShellModel = (shell: IslShellRange): IslLinkModel => ({
    ...linkModel,
    ...shellLinkModels?.[shell.key],
  });

  const edges: CandidateEdge[] = [];
  const covered = new Set<string>();

  // 1. Within-shell candidates, using each shell's own (possibly overridden) link model.
  for (const shell of shellRanges) {
    const shellModel = resolvedShellModel(shell);
    const shellParticipants: number[] = [];
    for (let idx = shell.startIndex; idx < shell.startIndex + shell.count; idx++) {
      if (participantSet.has(idx)) shellParticipants.push(idx);
    }
    if (shellParticipants.length === 0) continue;

    const shellEdges =
      shellModel.mode === "gridPattern"
        ? gridPatternIslCandidates(satEciPositions, shell, shellModel.maxRangeKm, shellModel.losMarginKm).filter(
            (e) => participantSet.has(e.i) && participantSet.has(e.j),
          )
        : uniformGridIslCandidates(
            satEciPositions,
            shellParticipants,
            shellModel.maxRangeKm,
            shellModel.losMarginKm,
          );

    for (const e of shellEdges) {
      edges.push(e);
      covered.add(pairKey(e.i, e.j));
    }
  }

  // 2. Cross-shell / unassigned-satellite candidates: always dynamic (never
  // gridPattern, which is only meaningful within a single shell's structure).
  const shellOfIndex = (idx: number): IslShellRange | null => {
    for (const shell of shellRanges) {
      if (idx >= shell.startIndex && idx < shell.startIndex + shell.count) return shell;
    }
    return null;
  };
  const maxRangeKmFor = (shell: IslShellRange | null): number =>
    shell ? resolvedShellModel(shell).maxRangeKm : linkModel.maxRangeKm;

  const widestRangeKm = Math.max(
    linkModel.maxRangeKm,
    ...shellRanges.map((s) => resolvedShellModel(s).maxRangeKm),
  );
  const candidatePairs = uniformGridIslCandidates(
    satEciPositions,
    participantIndices,
    widestRangeKm,
    linkModel.losMarginKm,
  );

  for (const e of candidatePairs) {
    const key = pairKey(e.i, e.j);
    if (covered.has(key)) continue;

    const shellI = shellOfIndex(e.i);
    const shellJ = shellOfIndex(e.j);
    if (shellI && shellJ && shellI.key === shellJ.key) continue; // same-shell pairs are fully handled in step 1

    const maxPairRangeKm = Math.max(maxRangeKmFor(shellI), maxRangeKmFor(shellJ));
    if (e.distanceKm > maxPairRangeKm) continue;

    covered.add(key);
    edges.push(e);
  }

  return edges;
}

function pushAdjacency(map: Map<number, GraphEdge[]>, id: number, edge: GraphEdge): void {
  const list = map.get(id);
  if (list) {
    list.push(edge);
  } else {
    map.set(id, [edge]);
  }
}

function buildGslEdgesForEndpoint(
  endpoint: IslEndpoint,
  nodeId: number,
  satEciPositions: Vec3[],
  participantIndices: number[],
  gmst: number,
  maxRangeKm: number,
): CandidateEdge[] {
  const observer = {
    longitude: satellite.degreesToRadians(endpoint.longitudeDeg),
    latitude: satellite.degreesToRadians(endpoint.latitudeDeg),
    height: endpoint.heightKm,
  };
  const stationEcf = satellite.geodeticToEcf(observer);
  const stationEci = satellite.ecfToEci(stationEcf, gmst);
  const minElevationRad = satellite.degreesToRadians(endpoint.minElevationDeg);

  return naiveGslCandidates(
    satEciPositions,
    participantIndices,
    observer,
    stationEci,
    gmst,
    minElevationRad,
    nodeId,
    maxRangeKm,
  );
}
