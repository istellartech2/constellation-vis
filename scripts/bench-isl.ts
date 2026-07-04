/**
 * ISL routing performance benchmark (isl-routing.md §3.3, §2.7).
 * Measures candidate generation (naive / uniform grid / gridPattern) and
 * Dijkstra shortest-path time for a seeded Walker-like LEO shell at
 * N = 100 / 1,000 / 10,000 satellites. Run with: bun run scripts/bench-isl.ts
 */
import * as satellite from "satellite.js";
import { toSatrec, type SatelliteSpec } from "../src/lib/satellites";
import {
  gridPatternIslCandidates,
  naiveIslCandidates,
  uniformGridIslCandidates,
  type ShellIndexRange,
} from "../src/lib/isl/candidates";
import { findShortestPath } from "../src/lib/isl/shortestPath";
import { buildSnapshotGraph } from "../src/lib/isl/graph";
import type { Vec3 } from "../src/lib/isl/geometry";
import type { IslEndpoint, IslLinkModel } from "../src/lib/isl/types";

const EARTH_RADIUS_KM = 6378.137;
const ALTITUDE_KM = 550;
// A single LEO shell's diameter (~2 * (R_e + alt) ~= 13,860 km) is only ~2.8x
// the ISL spec default of 5,000 km, so at that range nearly every satellite
// can reach nearly every other one (avg degree in the hundreds) — a
// pathological "almost complete graph" case, not representative of a real
// deployment (isl-routing.md §1.6.1 assumes avg degree ~10). 1,500 km keeps
// the candidate-generation + Dijkstra timings representative of realistic
// ISL mesh spacing; the uniform-grid vs naive comparison below still uses the
// spec default of 5,000 km to show the grid's behavior at that range too.
const REALISTIC_MAX_RANGE_KM = 1500;
const MAX_RANGE_KM = 5000;
const LOS_MARGIN_KM = 80;

/** Seeded LCG so bench runs are reproducible. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** A single-shell Walker-like constellation with `count` satellites, plane-major indexed (matches generateFromShells). */
function makeWalkerShell(count: number, seed: number): { specs: SatelliteSpec[]; shell: ShellIndexRange } {
  const planes = Math.max(1, Math.round(Math.sqrt(count / 2)));
  const perPlane = Math.ceil(count / planes);
  const rng = makeRng(seed);
  const specs: SatelliteSpec[] = [];
  let satnum = 1;
  for (let p = 0; p < planes && specs.length < count; p++) {
    const raanDeg = (360 * p) / planes;
    for (let j = 0; j < perPlane && specs.length < count; j++) {
      specs.push({
        type: "elements",
        elements: {
          satnum: satnum++,
          epoch: new Date("2024-01-01T00:00:00.000Z"),
          semiMajorAxisKm: EARTH_RADIUS_KM + ALTITUDE_KM,
          eccentricity: 0,
          inclinationDeg: 53 + rng() * 0.01, // tiny jitter so planes aren't degenerate
          raanDeg,
          argPerigeeDeg: 0,
          meanAnomalyDeg: (360 * j) / perPlane,
        },
      });
    }
  }
  return { specs, shell: { startIndex: 0, count: specs.length, planes } };
}

function propagateAll(specs: SatelliteSpec[], date: Date): Vec3[] {
  return specs.map((spec) => {
    const rec = toSatrec(spec);
    const pv = satellite.propagate(rec, date);
    return pv?.position ?? { x: 0, y: 0, z: 0 };
  });
}

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function runBench(n: number, skipNaive: boolean) {
  console.log(`\n=== N = ${n} ===`);
  const { specs, shell } = makeWalkerShell(n, 42);
  const date = new Date("2024-01-01T00:10:00.000Z");
  const positions = propagateAll(specs, date);
  const participantIndices = positions.map((_, i) => i);

  let naiveMs: number | null = null;
  let naiveCount = 0;
  if (!skipNaive) {
    let edges: ReturnType<typeof naiveIslCandidates> = [];
    naiveMs = timeMs(() => {
      edges = naiveIslCandidates(positions, participantIndices, MAX_RANGE_KM, LOS_MARGIN_KM);
    });
    naiveCount = edges.length;
  }

  let gridEdges: ReturnType<typeof uniformGridIslCandidates> = [];
  const gridMs = timeMs(() => {
    gridEdges = uniformGridIslCandidates(positions, participantIndices, MAX_RANGE_KM, LOS_MARGIN_KM);
  });

  let gridPatternEdges: ReturnType<typeof gridPatternIslCandidates> = [];
  const gridPatternMs = timeMs(() => {
    gridPatternEdges = gridPatternIslCandidates(positions, shell, MAX_RANGE_KM, LOS_MARGIN_KM);
  });

  const endpointA: IslEndpoint = {
    kind: "adhoc",
    name: "A",
    latitudeDeg: 35.68,
    longitudeDeg: 139.65,
    heightKm: 0,
    minElevationDeg: 10,
  };
  const endpointB: IslEndpoint = {
    kind: "adhoc",
    name: "B",
    latitudeDeg: 40.71,
    longitudeDeg: -74.01,
    heightKm: 0,
    minElevationDeg: 10,
  };
  const linkModel: IslLinkModel = {
    mode: "dynamic",
    maxRangeKm: REALISTIC_MAX_RANGE_KM,
    losMarginKm: LOS_MARGIN_KM,
  };

  let dijkstraMs = 0;
  let reachable = false;
  let candidateEdgeCount = 0;
  const totalMs = timeMs(() => {
    const graph = buildSnapshotGraph({
      satEciPositions: positions,
      participantIndices,
      endpointA,
      endpointB,
      simDate: date,
      linkModel,
      hopPenaltyMs: 2,
    });
    candidateEdgeCount = graph.candidateEdgeCount;
    const dijkstraStart = performance.now();
    const result = findShortestPath(graph, date.getTime(), graph.candidateEdgeCount, 0);
    dijkstraMs = performance.now() - dijkstraStart;
    reachable = result.reachable;
  });

  console.log(`-- candidate generation at the ISL spec default (maxRangeKm=${MAX_RANGE_KM}) --`);
  console.log(
    `naive:        ${naiveMs === null ? "skipped (reference only)" : `${naiveMs.toFixed(1)} ms, ${naiveCount} edges`}`,
  );
  console.log(`uniformGrid:  ${gridMs.toFixed(1)} ms, ${gridEdges.length} edges`);
  console.log(`gridPattern:  ${gridPatternMs.toFixed(1)} ms, ${gridPatternEdges.length} edges`);
  console.log(
    `-- full graph build + Dijkstra at a realistic ISL mesh spacing (maxRangeKm=${REALISTIC_MAX_RANGE_KM}) --`,
  );
  console.log(`candidateEdgeCount: ${candidateEdgeCount} (incl. GSL)`);
  console.log(`dijkstra:     ${dijkstraMs.toFixed(1)} ms (reachable=${reachable})`);
  console.log(`graph+path:   ${totalMs.toFixed(1)} ms (candidate gen via graph.ts's default path + Dijkstra)`);
}

runBench(100, false);
runBench(1000, false);
runBench(10000, false);
