/** Binary-heap Dijkstra over an IslGraph, with optional hysteresis discount (§1.5.1, §1.6.1). */
import type { IslGraph } from "./graph";
import type { IslPathEdge, IslPathResult } from "./types";

interface HeapItem {
  nodeId: number;
  dist: number;
}

class MinHeap {
  private items: HeapItem[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].dist <= this.items[i].dist) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    const n = this.items.length;
    let i = index;
    while (true) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;
      if (left < n && this.items[left].dist < this.items[smallest].dist) smallest = left;
      if (right < n && this.items[right].dist < this.items[smallest].dist) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
      i = smallest;
    }
  }
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export interface ShortestPathOptions {
  /** Edges (by undirected key) belonging to the previously adopted path (§1.5.1). */
  previousPathEdgeKeys?: Set<string>;
  /** beta in [0, 0.5], default 0 (no hysteresis in Phase 1). */
  switchDiscount?: number;
}

export function findShortestPath(
  graph: IslGraph,
  computedAtSimMs: number,
  candidateEdgeCount: number,
  computeTimeMs: number,
  options: ShortestPathOptions = {},
): IslPathResult {
  const { previousPathEdgeKeys, switchDiscount = 0 } = options;

  const dist = new Map<number, number>();
  const prevNode = new Map<number, number>();
  const prevEdge = new Map<number, IslPathEdge>();
  const visited = new Set<number>();

  const heap = new MinHeap();
  dist.set(graph.nodeAId, 0);
  heap.push({ nodeId: graph.nodeAId, dist: 0 });

  while (heap.size() > 0) {
    const current = heap.pop();
    if (!current) break;
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    if (current.nodeId === graph.nodeBId) break;

    const neighbors = graph.adjacency.get(current.nodeId) ?? [];
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;

      let cost = edge.costMs;
      if (previousPathEdgeKeys?.has(edgeKey(current.nodeId, edge.to))) {
        cost *= 1 - switchDiscount;
      }

      const candidateDist = current.dist + cost;
      const existing = dist.get(edge.to);
      if (existing === undefined || candidateDist < existing) {
        dist.set(edge.to, candidateDist);
        prevNode.set(edge.to, current.nodeId);
        prevEdge.set(edge.to, {
          fromNodeId: current.nodeId,
          toNodeId: edge.to,
          kind: edge.kind,
          distanceKm: edge.distanceKm,
          delayMs: edge.costMs,
        });
        heap.push({ nodeId: edge.to, dist: candidateDist });
      }
    }
  }

  if (!visited.has(graph.nodeBId)) {
    return {
      reachable: false,
      computedAtSimMs,
      nodeSatIndices: [],
      edges: [],
      totalDelayMs: 0,
      totalDistanceKm: 0,
      hopCount: 0,
      switchedFromPrevious: false,
      candidateEdgeCount,
      computeTimeMs,
    };
  }

  const edges: IslPathEdge[] = [];
  let node = graph.nodeBId;
  while (node !== graph.nodeAId) {
    const edge = prevEdge.get(node);
    if (!edge) break;
    edges.push(edge);
    node = prevNode.get(node) as number;
  }
  edges.reverse();

  const nodeSatIndices = edges
    .slice(0, -1)
    .map((e) => e.toNodeId)
    .filter((id) => id !== graph.nodeAId && id !== graph.nodeBId);

  const totalDelayMs = edges.reduce((sum, e) => sum + e.delayMs, 0);
  const totalDistanceKm = edges.reduce((sum, e) => sum + e.distanceKm, 0);

  let switchedFromPrevious = false;
  if (previousPathEdgeKeys) {
    const currentKeys = new Set(edges.map((e) => edgeKey(e.fromNodeId, e.toNodeId)));
    switchedFromPrevious =
      currentKeys.size !== previousPathEdgeKeys.size ||
      [...currentKeys].some((k) => !previousPathEdgeKeys.has(k));
  }

  return {
    reachable: true,
    computedAtSimMs,
    nodeSatIndices,
    edges,
    totalDelayMs,
    totalDistanceKm,
    hopCount: edges.length - 1,
    switchedFromPrevious,
    candidateEdgeCount,
    computeTimeMs,
  };
}
