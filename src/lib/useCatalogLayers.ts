import { useCallback, useEffect, useMemo, useState } from "react";
import {
  catalogLayerStyles,
  deleteCatalogLayer,
  loadCatalogLayers,
  mergeCatalogLayers,
  nextLayerColor,
  saveCatalogLayer,
  saveCatalogLayerStyles,
  type CatalogLayer,
} from "./catalogLayers";
import type { SatelliteCatalog } from "./satelliteCatalog";

export type NewCatalogLayer = Omit<CatalogLayer, "id" | "color" | "visible"> & { id?: string };
export type CatalogLayerPatch = Partial<Pick<CatalogLayer, "visible" | "color">>;

interface LayerState {
  layers: CatalogLayer[];
  /** All layers merged in order; replaced only when the set of catalogs changes. */
  catalog: SatelliteCatalog | null;
}

function withLayers(prev: LayerState, layers: CatalogLayer[]): LayerState {
  // Colour/visibility toggles keep the merged catalog: a 10^6-row concat
  // costs ~100 ms plus a GPU upload.
  const same = layers.length === prev.layers.length && layers.every((l, k) => l.catalog === prev.layers[k].catalog);
  return { layers, catalog: same ? prev.catalog : mergeCatalogLayers(layers.map((l) => l.catalog)) };
}

/**
 * Display layers: restored from IndexedDB once, merged for the scene, and
 * persisted on every change. `onReindex` fires when rows shift (add/remove),
 * so the caller can drop a selection that pointed into the layers.
 */
export function useCatalogLayers(onReindex: () => void) {
  const [state, setState] = useState<LayerState>({ layers: [], catalog: null });
  // Styles are written only after the stored ones were read, or the empty
  // first render would wipe them before the restore resolves.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCatalogLayers().then((layers) => {
      if (cancelled) return;
      if (layers.length > 0) setState((prev) => (prev.layers.length === 0 ? withLayers(prev, layers) : prev));
      setRestored(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (restored) saveCatalogLayerStyles(state.layers); }, [restored, state.layers]);

  const add = useCallback((input: NewCatalogLayer) => {
    onReindex();
    const id = input.id ?? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    setState((prev) => {
      const rest = prev.layers.filter((l) => l.id !== id);
      // Re-adding the same filing placement replaces it and keeps its colour.
      const color = prev.layers.find((l) => l.id === id)?.color ?? nextLayerColor(rest);
      return withLayers(prev, [...rest, { ...input, id, color, visible: true }]);
    });
    // Colour and visibility persist separately (saveCatalogLayerStyles).
    saveCatalogLayer({ ...input, id, color: "", visible: true }).catch((err) => console.warn("表示レイヤーを保存できませんでした:", err));
  }, [onReindex]);

  const change = useCallback((id: string, patch: CatalogLayerPatch) => {
    setState((prev) => withLayers(prev, prev.layers.map((l) => (l.id === id ? { ...l, ...patch } : l))));
  }, []);

  const remove = useCallback((id: string) => {
    onReindex();
    setState((prev) => withLayers(prev, prev.layers.filter((l) => l.id !== id)));
    deleteCatalogLayer(id).catch((err) => console.warn("表示レイヤーを削除できませんでした:", err));
  }, [onReindex]);

  const styles = useMemo(() => catalogLayerStyles(state.layers), [state.layers]);
  return { layers: state.layers, catalog: state.catalog, styles, add, change, remove };
}
