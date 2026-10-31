import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  LAYER_PALETTE,
  catalogLayerStyles,
  layerIndexOfRow,
  nextLayerColor,
  saveCatalogLayerStyles,
  type CatalogLayer,
} from "../src/lib/catalogLayers";
import { createCatalog } from "../src/lib/satelliteCatalog";

const layer = (id: string, count: number, color: string, visible = true): CatalogLayer => ({
  id, name: id, kind: "file", detail: "", color, visible, catalog: createCatalog(count),
});

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

describe("catalog layer helpers", () => {
  it("picks the first unused palette colour, then cycles", () => {
    expect(nextLayerColor([])).toBe(LAYER_PALETTE[0]);
    expect(nextLayerColor([layer("a", 1, LAYER_PALETTE[0]), layer("b", 1, LAYER_PALETTE[2])])).toBe(LAYER_PALETTE[1]);
    const full = LAYER_PALETTE.map((c, i) => layer(String(i), 1, c));
    expect(nextLayerColor(full)).toBe(LAYER_PALETTE[full.length % LAYER_PALETTE.length]);
  });

  it("maps merged rows back to their layer, keeping hidden layers in the count", () => {
    const styles = catalogLayerStyles([layer("a", 3, "#000"), layer("b", 0, "#111"), layer("c", 2, "#222", false)]);
    expect(styles).toEqual([
      { count: 3, color: "#000", visible: true },
      { count: 0, color: "#111", visible: true },
      { count: 2, color: "#222", visible: false },
    ]);
    expect([0, 2, 3, 4, 5].map((row) => layerIndexOfRow(styles, row))).toEqual([0, 0, 2, 2, -1]);
  });
});

describe("saveCatalogLayerStyles", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage;
  });

  it("stores only colour and visibility, keyed by layer id", () => {
    saveCatalogLayerStyles([layer("a", 5, "#abc"), layer("b", 1, "#def", false)]);
    expect(JSON.parse(storage.getItem("constellation-vis-layer-styles")!)).toEqual({
      a: { color: "#abc", visible: true },
      b: { color: "#def", visible: false },
    });
  });

  it("does not throw when storage is unavailable", () => {
    delete (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage;
    expect(() => saveCatalogLayerStyles([layer("a", 1, "#abc")])).not.toThrow();
  });
});
