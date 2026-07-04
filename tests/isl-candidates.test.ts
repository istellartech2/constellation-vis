import { describe, expect, it } from "bun:test";
import {
  gridPatternIslCandidates,
  naiveIslCandidates,
  uniformGridIslCandidates,
  type CandidateEdge,
} from "../src/lib/isl/candidates";
import type { Vec3 } from "../src/lib/isl/geometry";

const EARTH_RADIUS_EQUATOR_KM = 6378.137;

/** Deterministic LCG so tests are reproducible without relying on Math.random. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomShellPositions(n: number, altitudeKm: number, seed: number): Vec3[] {
  const rng = makeRng(seed);
  const r = EARTH_RADIUS_EQUATOR_KM + altitudeKm;
  const positions: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    // Uniform-ish points on a sphere shell (good enough for a candidate-set
    // equivalence test — exact distribution doesn't matter, only coverage of
    // near/far pairs and cell-boundary crossings does).
    const u = rng() * 2 - 1;
    const theta = rng() * 2 * Math.PI;
    const s = Math.sqrt(1 - u * u);
    positions.push({ x: r * s * Math.cos(theta), y: r * s * Math.sin(theta), z: r * u });
  }
  return positions;
}

function normalizeEdges(edges: CandidateEdge[]): string[] {
  return edges
    .map((e) => {
      const i = Math.min(e.i, e.j);
      const j = Math.max(e.i, e.j);
      return `${i}-${j}`;
    })
    .sort();
}

describe("isl candidates", () => {
  describe("uniformGridIslCandidates matches naiveIslCandidates exactly", () => {
    const seeds = [1, 2, 3, 4, 5];
    const maxRangeKmValues = [500, 2000, 5000];
    const losMarginKm = 80;

    for (const seed of seeds) {
      for (const maxRangeKm of maxRangeKmValues) {
        it(`seed=${seed} maxRangeKm=${maxRangeKm}`, () => {
          const positions = randomShellPositions(300, 550, seed);
          const participantIndices = positions.map((_, i) => i);

          const naive = normalizeEdges(
            naiveIslCandidates(positions, participantIndices, maxRangeKm, losMarginKm),
          );
          const grid = normalizeEdges(
            uniformGridIslCandidates(positions, participantIndices, maxRangeKm, losMarginKm),
          );

          expect(grid).toEqual(naive);
        });
      }
    }

    it("respects participant exclusion (excluded satellites never appear in edges)", () => {
      const positions = randomShellPositions(300, 550, 42);
      const excluded = new Set([3, 17, 42, 100, 250]);
      const participantIndices = positions.map((_, i) => i).filter((i) => !excluded.has(i));

      const edges = uniformGridIslCandidates(positions, participantIndices, 5000, 80);
      for (const e of edges) {
        expect(excluded.has(e.i)).toBe(false);
        expect(excluded.has(e.j)).toBe(false);
      }
      // Sanity: still matches naive on the same reduced participant set.
      const naive = normalizeEdges(naiveIslCandidates(positions, participantIndices, 5000, 80));
      expect(normalizeEdges(edges)).toEqual(naive);
    });
  });

  describe("gridPatternIslCandidates", () => {
    // Walker shell: 6 planes x 11 satellites = 66, laid out plane-major
    // (matches generateFromShells: index = p*perPlane + slot). These tests are
    // only about the index/adjacency structure gridPatternIslCandidates
    // produces, not real orbital geometry, so satellites are placed far along
    // a line with tiny per-index offsets: line-of-sight is always clear (the
    // whole line sits far from the origin) and every structural neighbor is
    // trivially within range, so the resulting edges exactly reflect the
    // structural candidate set under test.
    function walkerShellPositions(planes: number, perPlane: number): Vec3[] {
      const n = planes * perPlane;
      const positions: Vec3[] = [];
      for (let idx = 0; idx < n; idx++) {
        positions.push({ x: 1_000_000 + idx, y: 0, z: 0 });
      }
      return positions;
    }

    it("gives each satellite the expected +Grid neighbors (front/back in-plane, same-slot adjacent-plane)", () => {
      const planes = 6;
      const perPlane = 11;
      const positions = walkerShellPositions(planes, perPlane);
      const shell = { startIndex: 0, count: planes * perPlane, planes };

      // Generous range/margin so every structural candidate survives the
      // physical checks — the point of this test is the adjacency structure.
      const edges = gridPatternIslCandidates(positions, shell, 100000, 500);

      const neighborsOf = new Map<number, Set<number>>();
      for (const e of edges) {
        (neighborsOf.get(e.i) ?? neighborsOf.set(e.i, new Set()).get(e.i)!).add(e.j);
        (neighborsOf.get(e.j) ?? neighborsOf.set(e.j, new Set()).get(e.j)!).add(e.i);
      }

      const indexOf = (p: number, s: number) => p * perPlane + ((s + perPlane) % perPlane);

      for (let p = 0; p < planes; p++) {
        for (let s = 0; s < perPlane; s++) {
          const self = indexOf(p, s);
          const expected = new Set([
            indexOf(p, s - 1),
            indexOf(p, s + 1),
            indexOf((p - 1 + planes) % planes, s),
            indexOf((p + 1) % planes, s),
          ]);
          expected.delete(self);
          expect(neighborsOf.get(self)).toEqual(expected);
        }
      }
    });

    it("wraps plane 5 <-> plane 0 and slot perPlane-1 <-> slot 0 correctly", () => {
      const planes = 6;
      const perPlane = 11;
      const positions = walkerShellPositions(planes, perPlane);
      const shell = { startIndex: 0, count: planes * perPlane, planes };
      const edges = gridPatternIslCandidates(positions, shell, 100000, 500);

      const has = (a: number, b: number) =>
        edges.some((e) => (e.i === a && e.j === b) || (e.i === b && e.j === a));

      // Plane wraparound: plane 5 slot 3 <-> plane 0 slot 3.
      expect(has(5 * perPlane + 3, 0 * perPlane + 3)).toBe(true);
      // Slot wraparound within a plane: plane 2 slot (perPlane-1) <-> plane 2 slot 0.
      expect(has(2 * perPlane + (perPlane - 1), 2 * perPlane + 0)).toBe(true);
    });

    it("respects a shell offset (startIndex) other than 0", () => {
      const planes = 3;
      const perPlane = 4;
      const startIndex = 100;
      const positions: Vec3[] = new Array(startIndex).fill({ x: 0, y: 0, z: 0 });
      positions.push(...walkerShellPositions(planes, perPlane));
      const shell = { startIndex, count: planes * perPlane, planes };

      const edges = gridPatternIslCandidates(positions, shell, 100000, 500);
      for (const e of edges) {
        expect(e.i).toBeGreaterThanOrEqual(startIndex);
        expect(e.j).toBeGreaterThanOrEqual(startIndex);
      }
      // Each satellite gets exactly 4 neighbors (planes=3 >= 3 and perPlane=4 >= 3,
      // so front/back and adjacent-plane neighbors are all distinct from self).
      const degree = new Map<number, number>();
      for (const e of edges) {
        degree.set(e.i, (degree.get(e.i) ?? 0) + 1);
        degree.set(e.j, (degree.get(e.j) ?? 0) + 1);
      }
      for (let idx = startIndex; idx < startIndex + planes * perPlane; idx++) {
        expect(degree.get(idx)).toBe(4);
      }
    });

    it("handles a shell whose last plane is only partially filled", () => {
      // count=10, planes=3 -> perPlane=ceil(10/3)=4, plane sizes [4,4,2].
      const planes = 3;
      const perPlane = 4;
      const count = 10;
      const positions = walkerShellPositions(planes, perPlane).slice(0, count);
      const shell = { startIndex: 0, count, planes };

      const edges = gridPatternIslCandidates(positions, shell, 100000, 500);
      for (const e of edges) {
        expect(e.i).toBeLessThan(count);
        expect(e.j).toBeLessThan(count);
      }
      // Last (short) plane has only 2 satellites (indices 8, 9); they should
      // wrap to each other as in-plane front/back neighbors.
      expect(edges.some((e) => (e.i === 8 && e.j === 9) || (e.i === 9 && e.j === 8))).toBe(true);
    });
  });
});
