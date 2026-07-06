/**
 * Undirected node-id pair packed into a single numeric key. Previously
 * reimplemented as a template string independently in `shortestPath.ts`,
 * `graph.ts`, `stability.ts` and the routing worker — any one of those
 * drifting out of sync would silently break hysteresis. This is the single
 * source of truth; every site imports it.
 *
 * Numeric rather than string-keyed: avoids a string allocation per
 * relaxed edge in Dijkstra's hot loop. `MULTIPLIER` only needs to exceed the
 * largest node id ever used (satellite index count + 2 endpoints) — real
 * constellations are nowhere near 2^21 satellites, and `min*MULTIPLIER+max`
 * stays comfortably within Number's safe integer range.
 */
const EDGE_KEY_MULTIPLIER = 1 << 21;

export function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_KEY_MULTIPLIER + b : b * EDGE_KEY_MULTIPLIER + a;
}

/**
 * Undirected edge-key list for a path's edges — previously reimplemented
 * independently in the routing worker (`edgeKeysOf`) and in `visualization.ts`
 * (inline `.map(...)`), risking the same silent-hysteresis-breakage drift
 * if "which edges count toward hysteresis" ever changed.
 */
export function pathEdgeKeys(edges: Array<{ fromNodeId: number; toNodeId: number }>): number[] {
  return edges.map((e) => edgeKey(e.fromNodeId, e.toNodeId));
}
