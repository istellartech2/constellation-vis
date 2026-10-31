import { concatCatalogs, type SatelliteCatalog } from "./satelliteCatalog";

/**
 * A display layer: a satellite set loaded outside the TOML editor (a
 * CelesTrak group, a TLE/OMM file, a filing placed as a layer, or a
 * synthetic load-test set). Layers are drawn by the GPU J2 overlay
 * independently of the editor satellites, so adding, hiding or removing one
 * never rebuilds the scene; they are display-only (analyses and ISL use the
 * editor satellites). Persisted in IndexedDB, since 10^5–10^6 satellites far
 * exceed localStorage and the editor text.
 */
export type CatalogLayerKind = "celestrak" | "file" | "filing" | "synthetic";

export interface CatalogLayer {
  id: string;
  name: string;
  kind: CatalogLayerKind;
  /** Short provenance line shown in the layer list. */
  detail: string;
  /** Dot colour when layers are coloured per layer (CSS hex). */
  color: string;
  /** Hidden layers stay loaded (indexes stay stable) but are not drawn or pickable. */
  visible: boolean;
  catalog: SatelliteCatalog;
}

/** Per-layer drawing style handed to the scene; order matches the merged catalog. */
export interface CatalogLayerStyle {
  count: number;
  color: string;
  visible: boolean;
}

/** How layer dots are coloured: per layer, or by ground-station visibility like editor satellites. */
export type LayerColorMode = "layer" | "visibility";

/** Shader uniform arrays are fixed-size; the UI refuses to add more layers. */
export const MAX_CATALOG_LAYERS = 16;

/** Distinct hues that read on both the dark and the white background. */
export const LAYER_PALETTE = [
  "#f59e0b", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185",
  "#facc15", "#60a5fa", "#c084fc", "#2dd4bf", "#fb923c", "#a3e635",
];

export function nextLayerColor(layers: readonly CatalogLayer[]): string {
  const used = new Set(layers.map((l) => l.color));
  return LAYER_PALETTE.find((c) => !used.has(c)) ?? LAYER_PALETTE[layers.length % LAYER_PALETTE.length];
}

/** Merge all layers (hidden ones included, so indexes do not shift on toggle). */
export function mergeCatalogLayers(catalogs: readonly SatelliteCatalog[]): SatelliteCatalog | null {
  if (catalogs.length === 0) return null;
  return concatCatalogs([...catalogs]);
}

export function catalogLayerStyles(layers: readonly CatalogLayer[]): CatalogLayerStyle[] {
  return layers.map((l) => ({ count: l.catalog.count, color: l.color, visible: l.visible }));
}

/** Index of the layer holding merged row `row`, or -1. */
export function layerIndexOfRow(styles: readonly CatalogLayerStyle[], row: number): number {
  let end = 0;
  for (let k = 0; k < styles.length; k++) {
    end += styles[k].count;
    if (row < end) return k;
  }
  return -1;
}

const DB_NAME = "constellation-vis-catalogs";
const STORE = "layers";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Colour/visibility live in localStorage: re-putting a 10^6-row catalog into
 * IndexedDB on every toggle would structured-clone ~70 MB on the main thread.
 */
const STYLE_KEY = "constellation-vis-layer-styles";
type StoredStyles = Record<string, { color: string; visible: boolean }>;

function readStyles(): StoredStyles {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as StoredStyles) : {};
  } catch {
    return {};
  }
}

/** Persist colour/visibility for the given layers (drops entries of removed layers). */
export function saveCatalogLayerStyles(layers: readonly CatalogLayer[]) {
  try {
    const styles: StoredStyles = {};
    for (const l of layers) styles[l.id] = { color: l.color, visible: l.visible };
    localStorage.setItem(STYLE_KEY, JSON.stringify(styles));
  } catch { /* storage unavailable: styles reset on reload */ }
}

const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Layers saved before colours/visibility existed (or in old builds) get defaults; order is insertion order. */
function normalizeLayers(raw: (Partial<CatalogLayer> & { addedAt?: number })[]): CatalogLayer[] {
  const styles = readStyles();
  const out: CatalogLayer[] = [];
  for (const layer of [...raw].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))) {
    if (!layer.id || !layer.catalog) continue;
    const style = styles[layer.id];
    out.push({
      id: layer.id,
      name: layer.name ?? "レイヤー",
      kind: layer.kind ?? "file",
      detail: layer.detail ?? "",
      color: [style?.color, layer.color].find(isHexColor) ?? nextLayerColor(out),
      visible: [style?.visible, layer.visible].find((v) => typeof v === "boolean") ?? true,
      catalog: layer.catalog,
    });
  }
  return out.slice(0, MAX_CATALOG_LAYERS);
}

/** Load persisted layers; resolves to [] when IndexedDB is unavailable. */
export async function loadCatalogLayers(): Promise<CatalogLayer[]> {
  try {
    if (typeof indexedDB === "undefined") return [];
    return normalizeLayers(await withStore<Partial<CatalogLayer>[]>("readonly", (s) => s.getAll() as IDBRequest<Partial<CatalogLayer>[]>));
  } catch {
    return [];
  }
}

export async function saveCatalogLayer(layer: CatalogLayer): Promise<void> {
  await withStore("readwrite", (s) => s.put({ ...layer, addedAt: Date.now() }));
}

export async function deleteCatalogLayer(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}
