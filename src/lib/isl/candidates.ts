/** Candidate link generation (§1.7). Phase 1: naive all-pairs; later phases add uniform grid / gridPattern. */
import * as satellite from "satellite.js";
import type { Vec3 } from "./geometry";
import { elevationRad, hasLineOfSight, linkDistanceKm, linkDistanceSqKm2 } from "./geometry";

export interface CandidateEdge {
  /** Node id at one end of the edge. */
  i: number;
  /** Node id at the other end of the edge. */
  j: number;
  kind: "isl" | "gsl";
  distanceKm: number;
}

/**
 * Naive all-pairs ISL candidate generation among participant satellites (§1.7.1).
 * Node ids equal satellite indices. Early-rejects by squared distance before the
 * more expensive line-of-sight check.
 */
export function naiveIslCandidates(
  satEciPositions: Vec3[],
  participantIndices: number[],
  maxRangeKm: number,
  losMarginKm: number,
): CandidateEdge[] {
  const maxRangeSqKm2 = maxRangeKm * maxRangeKm;
  const edges: CandidateEdge[] = [];

  for (let a = 0; a < participantIndices.length; a++) {
    const i = participantIndices[a];
    const pi = satEciPositions[i];
    for (let b = a + 1; b < participantIndices.length; b++) {
      const j = participantIndices[b];
      const pj = satEciPositions[j];
      const d2 = linkDistanceSqKm2(pi, pj);
      if (d2 > maxRangeSqKm2) continue;
      if (!hasLineOfSight(pi, pj, losMarginKm)) continue;
      edges.push({ i, j, kind: "isl", distanceKm: Math.sqrt(d2) });
    }
  }

  return edges;
}

/**
 * Uniform-grid ISL candidate generation (§1.7.2, Phase 3). Hashes participant
 * satellites into cells of side `maxRangeKm` and only pair-checks each satellite
 * against occupants of its own cell + the 26 neighboring cells. Any pair with
 * |r_j - r_i| <= maxRangeKm is guaranteed to fall within that 27-cell
 * neighborhood, so this produces exactly the same edge set as
 * {@link naiveIslCandidates} — verified by the naive/grid equivalence test
 * (§3.1) — at O(N + neighbor pairs) instead of O(N^2).
 */
export function uniformGridIslCandidates(
  satEciPositions: Vec3[],
  participantIndices: number[],
  maxRangeKm: number,
  losMarginKm: number,
): CandidateEdge[] {
  if (participantIndices.length === 0) return [];

  const cellSize = Math.max(maxRangeKm, 1e-6);
  const cellCoord = (v: number) => Math.floor(v / cellSize);
  const cellKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;

  const grid = new Map<string, number[]>();
  const satCell = new Map<number, [number, number, number]>();
  for (const i of participantIndices) {
    const p = satEciPositions[i];
    const c: [number, number, number] = [cellCoord(p.x), cellCoord(p.y), cellCoord(p.z)];
    satCell.set(i, c);
    const key = cellKey(c[0], c[1], c[2]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const maxRangeSqKm2 = maxRangeKm * maxRangeKm;
  const edges: CandidateEdge[] = [];
  const OFFSETS = [-1, 0, 1];

  // No extra "seen" dedup needed: each of the 27 (dx,dy,dz) offsets maps to a
  // distinct cell, so a given neighbor satellite j is found from i's loop via
  // exactly one offset. Combined with the `j <= i` guard (which also skips
  // the symmetric visit from j's own outer-loop iteration), every unordered
  // pair is produced exactly once.
  for (const i of participantIndices) {
    const [cx, cy, cz] = satCell.get(i)!;
    const pi = satEciPositions[i];
    for (const dx of OFFSETS) {
      for (const dy of OFFSETS) {
        for (const dz of OFFSETS) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;

            const pj = satEciPositions[j];
            const d2 = linkDistanceSqKm2(pi, pj);
            if (d2 > maxRangeSqKm2) continue;
            if (!hasLineOfSight(pi, pj, losMarginKm)) continue;
            edges.push({ i, j, kind: "isl", distanceKm: Math.sqrt(d2) });
          }
        }
      }
    }
  }

  return edges;
}

/** Describes one shell's satellite index range for gridPattern candidate generation. */
export interface ShellIndexRange {
  /** Index (into the satEciPositions array) of the shell's first satellite. */
  startIndex: number;
  /** Number of satellites in the shell. */
  count: number;
  /** Number of orbital planes. */
  planes: number;
}

/**
 * "+Grid" structural ISL candidate generation for a single shell (§1.2.2 (c),
 * §1.7.3): each satellite links to its front/back neighbors within the same
 * plane (mean-anomaly order, wrapping) and to the same-slot satellite in each
 * adjacent plane (wrapping across the plane count), for at most 4 structural
 * candidates per satellite — an O(N) alternative to the all-pairs / grid scan.
 * Line-of-sight and maxRangeKm (§1.2.2 (a)(b)) are still applied on top.
 * Satellites are assumed laid out plane-major (matching `generateFromShells`):
 * plane p occupies indices [startIndex + p*ceil(count/planes), ...).
 */
export function gridPatternIslCandidates(
  satEciPositions: Vec3[],
  shell: ShellIndexRange,
  maxRangeKm: number,
  losMarginKm: number,
): CandidateEdge[] {
  const { startIndex, count, planes } = shell;
  if (planes <= 0 || count <= 0) return [];

  const perPlane = Math.ceil(count / planes);
  const planeSize: number[] = [];
  const planeOffset: number[] = [];
  let offset = 0;
  for (let p = 0; p < planes; p++) {
    const size = Math.max(0, Math.min(perPlane, count - offset));
    planeOffset.push(offset);
    planeSize.push(size);
    offset += size;
  }

  const globalIndex = (plane: number, slot: number): number | null => {
    const p = ((plane % planes) + planes) % planes;
    const size = planeSize[p];
    if (size === 0) return null;
    const s = ((slot % size) + size) % size;
    return startIndex + planeOffset[p] + s;
  };

  const maxRangeSqKm2 = maxRangeKm * maxRangeKm;
  const edges: CandidateEdge[] = [];
  const seen = new Set<string>();

  const tryAddEdge = (a: number | null, b: number | null) => {
    if (a === null || b === null || a === b) return;
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const key = `${i}-${j}`;
    if (seen.has(key)) return;
    seen.add(key);

    const pi = satEciPositions[i];
    const pj = satEciPositions[j];
    const d2 = linkDistanceSqKm2(pi, pj);
    if (d2 > maxRangeSqKm2) return;
    if (!hasLineOfSight(pi, pj, losMarginKm)) return;
    edges.push({ i, j, kind: "isl", distanceKm: Math.sqrt(d2) });
  };

  for (let p = 0; p < planes; p++) {
    const size = planeSize[p];
    for (let slot = 0; slot < size; slot++) {
      const self = globalIndex(p, slot);
      tryAddEdge(self, globalIndex(p, slot + 1)); // same-plane, next satellite
      tryAddEdge(self, globalIndex(p + 1, slot)); // adjacent plane, same slot
    }
  }

  return edges;
}

/**
 * GSL candidate generation for a single ground endpoint against all participant
 * satellites. Existence requires the elevation condition (§1.2.1) AND a maximum
 * range (practical addition beyond the original elevation-only design: at very
 * low elevation the slant range to a LEO satellite can reach ~2,500+ km, which
 * produces geometrically-valid but implausibly long "grazing" GSL links whose
 * satellite-side endpoint can be very far from the ground point).
 */
export function naiveGslCandidates(
  satEciPositions: Vec3[],
  participantIndices: number[],
  observer: { longitude: number; latitude: number; height: number },
  endpointEci: Vec3,
  gmst: number,
  minElevationRad: number,
  endpointNodeId: number,
  maxRangeKm: number,
): CandidateEdge[] {
  const edges: CandidateEdge[] = [];

  for (const satIndex of participantIndices) {
    const satEci = satEciPositions[satIndex];
    const distanceKm = linkDistanceKm(endpointEci, satEci);
    if (distanceKm > maxRangeKm) continue;
    const satEcf = satellite.eciToEcf(satEci as satellite.EciVec3<number>, gmst);
    const elevation = elevationRad(observer, satEcf);
    if (elevation < minElevationRad) continue;
    edges.push({
      i: endpointNodeId,
      j: satIndex,
      kind: "gsl",
      distanceKm,
    });
  }

  return edges;
}
