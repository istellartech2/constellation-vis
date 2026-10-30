import { describe, expect, it } from "bun:test";
import { buildLayerIndexes } from "./massSatelliteLayer";
import { mergePickHits } from "./visualization";

const style = (count: number, visible = true) => ({ count, color: "#ffffff", visible });

describe("buildLayerIndexes", () => {
  it("assigns each row the index of the layer holding it", () => {
    expect([...buildLayerIndexes([style(2), style(1), style(3)], 6)]).toEqual([0, 0, 1, 2, 2, 2]);
  });

  it("skips empty layers without shifting later ones", () => {
    expect([...buildLayerIndexes([style(1), style(0), style(2)], 3)]).toEqual([0, 2, 2]);
  });

  it("falls back to a single layer when counts do not match the catalog", () => {
    expect([...buildLayerIndexes([style(2), style(2)], 3)]).toEqual([0, 0, 0]);
    expect([...buildLayerIndexes([], 2)]).toEqual([0, 0]);
  });

  it("rewrites a provided buffer in place", () => {
    const out = new Uint8Array([9, 9, 9]);
    expect(buildLayerIndexes([style(1), style(2)], 3, out)).toBe(out);
    expect([...out]).toEqual([0, 1, 1]);
  });
});

describe("mergePickHits", () => {
  it("offsets catalog rows to global indexes and sorts nearest first", () => {
    const editor = [{ index: 1, distance: 5 }, { index: 0, distance: 9 }];
    const catalog = [{ index: 0, distance: 2 }, { index: 4, distance: 7 }];
    expect(mergePickHits(editor, catalog, 10)).toEqual([10, 1, 14, 0]);
  });

  it("handles one side being empty", () => {
    expect(mergePickHits([], [{ index: 3, distance: 1 }], 2)).toEqual([5]);
    expect(mergePickHits([{ index: 3, distance: 1 }], [], 2)).toEqual([3]);
  });
});
