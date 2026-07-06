import { describe, expect, it } from "bun:test";
import type { GraphEdge, IslGraph } from "../src/lib/isl/graph";
import { edgeKey } from "../src/lib/isl/edgeKey";
import { findShortestPath } from "../src/lib/isl/shortestPath";
import { edgeCostMs } from "../src/lib/isl/cost";

const NODE_A = 100;
const NODE_B = 101;

function makeGraph(edges: Array<[number, number, number]>): IslGraph {
  const adjacency = new Map<number, GraphEdge[]>();
  const push = (from: number, edge: GraphEdge) => {
    const list = adjacency.get(from);
    if (list) list.push(edge);
    else adjacency.set(from, [edge]);
  };
  for (const [from, to, costMs] of edges) {
    push(from, { to, kind: "isl", distanceKm: costMs, costMs });
    push(to, { to: from, kind: "isl", distanceKm: costMs, costMs });
  }
  return { adjacency, candidateEdgeCount: edges.length, nodeAId: NODE_A, nodeBId: NODE_B };
}

describe("isl shortestPath", () => {
  it("finds the known minimum-cost path in a small hand-built graph", () => {
    // A - 0 - 1 - B (cost 10+5+10=25), and a cheaper detour A - 2 - 3 - B (cost 1+1+1=3).
    const graph = makeGraph([
      [NODE_A, 0, 10],
      [0, 1, 5],
      [1, NODE_B, 10],
      [NODE_A, 2, 1],
      [2, 3, 1],
      [3, NODE_B, 1],
    ]);

    const result = findShortestPath(graph, 0, 0);
    expect(result.reachable).toBe(true);
    expect(result.totalDelayMs).toBeCloseTo(3, 6);
    expect(result.nodeSatIndices).toEqual([2, 3]);
    expect(result.hopCount).toBe(2);
  });

  it("returns reachable: false for a disconnected graph", () => {
    const graph = makeGraph([
      [NODE_A, 0, 1],
      [1, NODE_B, 1],
      // 0 and 1 are not connected to each other.
    ]);

    const result = findShortestPath(graph, 0, 0);
    expect(result.reachable).toBe(false);
    expect(result.edges).toEqual([]);
  });

  it("handles a direct A-satellite-B relay (one ISL hop equivalent, two GSL edges)", () => {
    const graph = makeGraph([
      [NODE_A, 5, 4],
      [5, NODE_B, 6],
    ]);

    const result = findShortestPath(graph, 0, 0);
    expect(result.reachable).toBe(true);
    expect(result.hopCount).toBe(1);
    expect(result.nodeSatIndices).toEqual([5]);
    expect(result.totalDelayMs).toBeCloseTo(10, 6);
    expect(result.edges).toHaveLength(2);
  });

  describe("hysteresis (§1.5.1)", () => {
    // Old path A-P-B: edge costs 10 + 90 = 100 total. A-P is kept tiny (10) so
    // that P is always settled by Dijkstra long before Q, regardless of Q's
    // cost — this removes ordering ambiguity and lets the tie case below
    // resolve deterministically to "old path kept" purely from settle order,
    // matching the spec's "tie keeps the old path" rule.
    // New path A-Q-B: all cost on the first edge, so dist(Q) == candidate cost.
    function makeHysteresisGraph(newPathCost: number): IslGraph {
      const adjacency = new Map<number, GraphEdge[]>();
      const push = (from: number, edge: GraphEdge) => {
        const list = adjacency.get(from);
        if (list) list.push(edge);
        else adjacency.set(from, [edge]);
      };
      const addEdge = (from: number, to: number, costMs: number) => {
        push(from, { to, kind: "isl", distanceKm: costMs, costMs });
        push(to, { to: from, kind: "isl", distanceKm: costMs, costMs });
      };
      const NODE_P = 1;
      const NODE_Q = 2;
      addEdge(NODE_A, NODE_P, 10);
      addEdge(NODE_P, NODE_B, 90);
      addEdge(NODE_A, NODE_Q, newPathCost);
      addEdge(NODE_Q, NODE_B, 0);
      return { adjacency, candidateEdgeCount: 4, nodeAId: NODE_A, nodeBId: NODE_B };
    }

    const NODE_P = 1;
    const previousPathEdgeKeys = new Set([
      edgeKey(NODE_A, NODE_P),
      edgeKey(NODE_P, NODE_B),
    ]);

    it("keeps the old path when the new path isn't cheap enough to overcome the discount (100 vs 85, beta 0.2 -> keep, discounted old = 80 < 85)", () => {
      const graph = makeHysteresisGraph(85);
      const result = findShortestPath(graph, 0, 0, {
        previousPathEdgeKeys,
        switchDiscount: 0.2,
      });
      expect(result.totalDelayMs).toBeCloseTo(100, 6); // undiscounted actual cost of the kept path
      expect(result.switchedFromPrevious).toBe(false);
    });

    it("switches to the new path once it's cheap enough (100 vs 75, beta 0.2 -> switch, 75 < 80)", () => {
      const graph = makeHysteresisGraph(75);
      const result = findShortestPath(graph, 0, 0, {
        previousPathEdgeKeys,
        switchDiscount: 0.2,
      });
      expect(result.totalDelayMs).toBeCloseTo(75, 6);
      expect(result.switchedFromPrevious).toBe(true);
    });

    it("keeps the old path on an exact tie (100 vs 80, discounted old = 80 == 80 -> tie keeps old)", () => {
      const graph = makeHysteresisGraph(80);
      const result = findShortestPath(graph, 0, 0, {
        previousPathEdgeKeys,
        switchDiscount: 0.2,
      });
      expect(result.totalDelayMs).toBeCloseTo(100, 6);
      expect(result.switchedFromPrevious).toBe(false);
    });
  });

  describe("hopPenaltyMs trade-off (§1.4.2)", () => {
    // Path 1 (more hops, shorter total distance): A-0-1-B, 3 edges x 100 km.
    // Path 2 (fewer hops, longer total distance): A-2-B, 2 edges x 1000 km.
    function makeTradeoffGraph(hopPenaltyMs: number): IslGraph {
      const adjacency = new Map<number, GraphEdge[]>();
      const push = (from: number, edge: GraphEdge) => {
        const list = adjacency.get(from);
        if (list) list.push(edge);
        else adjacency.set(from, [edge]);
      };
      const addEdge = (from: number, to: number, distanceKm: number) => {
        const costMs = edgeCostMs(distanceKm, hopPenaltyMs);
        push(from, { to, kind: "isl", distanceKm, costMs });
        push(to, { to: from, kind: "isl", distanceKm, costMs });
      };
      addEdge(NODE_A, 0, 100);
      addEdge(0, 1, 100);
      addEdge(1, NODE_B, 100);
      addEdge(NODE_A, 2, 1000);
      addEdge(2, NODE_B, 1000);
      return { adjacency, candidateEdgeCount: 5, nodeAId: NODE_A, nodeBId: NODE_B };
    }

    it("prefers the shorter-distance, more-hop path when hopPenaltyMs is 0", () => {
      const graph = makeTradeoffGraph(0);
      const result = findShortestPath(graph, 0, 0);
      expect(result.hopCount).toBe(2);
      expect(result.nodeSatIndices).toEqual([0, 1]);
    });

    it("switches to the fewer-hop path once hopPenaltyMs is large enough", () => {
      const graph = makeTradeoffGraph(10);
      const result = findShortestPath(graph, 0, 0);
      expect(result.hopCount).toBe(1);
      expect(result.nodeSatIndices).toEqual([2]);
    });
  });
});
