import { concatCatalogs, type SatelliteCatalog } from "./satelliteCatalog";

/**
 * A large catalog loaded outside the TOML editor (a TLE/OMM file, a filing
 * placed as a catalog, or a synthetic load-test set). Layers are drawn after
 * the editor satellites and persisted in IndexedDB, since 10^5–10^6
 * satellites far exceed localStorage and the editor text.
 */
export interface CatalogLayer {
  id: string;
  name: string;
  kind: "file" | "filing" | "synthetic";
  /** Short provenance line shown in the layer list. */
  detail: string;
  catalog: SatelliteCatalog;
}

/** Merge visible layers into the one catalog the scene draws (null when empty). */
export function mergeCatalogLayers(layers: CatalogLayer[]): SatelliteCatalog | null {
  if (layers.length === 0) return null;
  return concatCatalogs(layers.map((l) => l.catalog));
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

/** Load persisted layers; resolves to [] when IndexedDB is unavailable. */
export async function loadCatalogLayers(): Promise<CatalogLayer[]> {
  try {
    if (typeof indexedDB === "undefined") return [];
    return await withStore<CatalogLayer[]>("readonly", (s) => s.getAll() as IDBRequest<CatalogLayer[]>);
  } catch {
    return [];
  }
}

export async function saveCatalogLayer(layer: CatalogLayer): Promise<void> {
  await withStore("readwrite", (s) => s.put(layer));
}

export async function deleteCatalogLayer(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}
