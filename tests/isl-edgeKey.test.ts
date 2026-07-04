import { describe, expect, it } from "bun:test";
import { edgeKey } from "../src/lib/isl/edgeKey";

// D-1: edgeKey is the single shared implementation used by shortestPath.ts,
// graph.ts, stability.ts and the routing worker — a regression here would
// silently break hysteresis matching across all of them.
describe("edgeKey", () => {
  it("is symmetric (undirected)", () => {
    expect(edgeKey(3, 7)).toBe(edgeKey(7, 3));
  });

  it("is unique per unordered pair across a reasonable id range", () => {
    const seen = new Map<number, [number, number]>();
    for (let a = 0; a < 50; a++) {
      for (let b = a + 1; b < 50; b++) {
        const key = edgeKey(a, b);
        const prior = seen.get(key);
        expect(prior).toBeUndefined();
        seen.set(key, [a, b]);
      }
    }
  });

  it("returns a number", () => {
    expect(typeof edgeKey(0, 1)).toBe("number");
  });
});
