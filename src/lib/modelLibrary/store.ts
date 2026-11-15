/**
 * Model library storage: metadata and file bytes in IndexedDB (two
 * idb-keyval stores, so listing never loads the bytes), per browser.
 *
 * Every storage call is wrapped: when IndexedDB is unavailable (private
 * mode, blocked site data, tests) the library falls back to an in-memory
 * backend for this session and says so via `snapshot.mode === "session"`.
 *
 * The library is a module-level singleton with a subscribe / snapshot pair
 * for React's useSyncExternalStore, and change listeners the 3D model cache
 * uses to drop stale templates (edit / delete).
 */
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";
import { isModelAxis, isValidOrientation } from "./orientation";
import {
  isValidLibraryId,
  MODEL_UNITS,
  type LibraryModelMeta,
  type LibraryModelSettings,
  type ModelNodeRef,
  type ModelScale,
  type ModelUnit,
} from "./types";

export interface ModelStoreBackend {
  listMeta(): Promise<LibraryModelMeta[]>;
  getData(id: string): Promise<ArrayBuffer | null>;
  putMeta(meta: LibraryModelMeta): Promise<void>;
  putData(id: string, data: ArrayBuffer): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryBackend(): ModelStoreBackend {
  const metas = new Map<string, LibraryModelMeta>();
  const datas = new Map<string, ArrayBuffer>();
  return {
    listMeta: async () => [...metas.values()],
    getData: async (id) => datas.get(id) ?? null,
    putMeta: async (meta) => void metas.set(meta.id, meta),
    putData: async (id, data) => void datas.set(id, data),
    remove: async (id) => {
      metas.delete(id);
      datas.delete(id);
    },
  };
}

const DB_META = "constellation-vis-model-library";
const DB_DATA = "constellation-vis-model-library-data";

export function createIndexedDbBackend(): ModelStoreBackend {
  const metaStore: UseStore = createStore(DB_META, "meta");
  const dataStore: UseStore = createStore(DB_DATA, "data");
  return {
    listMeta: async () => (await entries<string, unknown>(metaStore)).map(([, v]) => v as LibraryModelMeta),
    getData: async (id) => (await get<ArrayBuffer>(id, dataStore)) ?? null,
    putMeta: (meta) => set(meta.id, meta, metaStore),
    putData: (id, data) => set(id, data, dataStore),
    remove: async (id) => {
      await del(id, metaStore);
      await del(id, dataStore);
    },
  };
}

// ---------------------------------------------------------------------------
// Metadata validation (stored records are untrusted: older versions, edits)
// ---------------------------------------------------------------------------

function sanitizeScale(v: unknown): ModelScale | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (s.mode === "unit" && (MODEL_UNITS as readonly unknown[]).includes(s.unit)) return { mode: "unit", unit: s.unit as ModelUnit };
  if (s.mode === "length" && typeof s.lengthM === "number" && Number.isFinite(s.lengthM) && s.lengthM > 0) {
    return { mode: "length", lengthM: s.lengthM };
  }
  return null;
}

function sanitizeNodeRefs(v: unknown): ModelNodeRef[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((n) => {
    if (!n || typeof n !== "object") return [];
    const r = n as Record<string, unknown>;
    if (!Array.isArray(r.path) || !r.path.every((i) => Number.isInteger(i) && i >= 0)) return [];
    return [{ path: [...(r.path as number[])], name: typeof r.name === "string" ? r.name : "" }];
  });
}

/** A valid metadata record, or null. */
export function sanitizeModelMeta(v: unknown): LibraryModelMeta | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== "string" || !isValidLibraryId(m.id)) return null;
  const o = m.orientation as Record<string, unknown> | undefined;
  if (!o || !isModelAxis(o.forward) || !isModelAxis(o.nadir)) return null;
  const orientation = { forward: o.forward, nadir: o.nadir };
  if (!isValidOrientation(orientation)) return null;
  const scale = sanitizeScale(m.scale);
  if (!scale) return null;
  const bbox = m.bboxSize;
  if (!Array.isArray(bbox) || bbox.length !== 3 || !bbox.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) {
    return null;
  }
  return {
    id: m.id,
    name: typeof m.name === "string" && m.name.trim() ? m.name : "モデル",
    fileName: typeof m.fileName === "string" ? m.fileName : "",
    format: m.format === "gltf" ? "gltf" : "glb",
    sizeBytes: typeof m.sizeBytes === "number" ? m.sizeBytes : 0,
    addedAt: typeof m.addedAt === "string" ? m.addedAt : new Date(0).toISOString(),
    updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : typeof m.addedAt === "string" ? m.addedAt : new Date(0).toISOString(),
    orientation,
    scale,
    origin: m.origin === "base" ? "base" : "center",
    bboxSize: [bbox[0], bbox[1], bbox[2]],
    solarWings: sanitizeNodeRefs(m.solarWings),
    ...(m.sourceUp === "y" || m.sourceUp === "z" ? { sourceUp: m.sourceUp } : {}),
  };
}

// ---------------------------------------------------------------------------
// Library singleton
// ---------------------------------------------------------------------------

export interface ModelLibrarySnapshot {
  /** False until the first listing finished (or failed). */
  ready: boolean;
  /** persistent = IndexedDB; session = in memory, lost on reload. */
  mode: "persistent" | "session";
  /** Sorted by addedAt. */
  models: readonly LibraryModelMeta[];
}

export type ModelLibraryChange = { kind: "update" | "delete"; id: string };

export class ModelLibrary {
  private backend: ModelStoreBackend;
  private snapshot: ModelLibrarySnapshot;
  private listeners = new Set<() => void>();
  private changeListeners = new Set<(change: ModelLibraryChange) => void>();
  private initPromise: Promise<void> | null = null;

  constructor(backend: ModelStoreBackend | null) {
    this.backend = backend ?? createMemoryBackend();
    this.snapshot = { ready: false, mode: backend ? "persistent" : "session", models: [] };
  }

  getSnapshot = (): ModelLibrarySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.init();
    return () => this.listeners.delete(listener);
  };

  /** Edit / delete notifications (for template caches). */
  onChange(listener: (change: ModelLibraryChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Load the listing once; falls back to session storage when the backend fails. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      let metas: LibraryModelMeta[];
      try {
        metas = (await this.backend.listMeta()).flatMap((m) => sanitizeModelMeta(m) ?? []);
      } catch (error) {
        console.warn("Model library storage unavailable; models are kept for this session only.", error);
        this.backend = createMemoryBackend();
        this.setSnapshot({ ...this.snapshot, mode: "session" });
        metas = [];
      }
      this.setSnapshot({ ...this.snapshot, ready: true, models: sortModels(metas) });
    })();
    return this.initPromise;
  }

  get(id: string): LibraryModelMeta | undefined {
    return this.snapshot.models.find((m) => m.id === id);
  }

  /** Metadata (waiting for the listing) and file bytes of a model, or null if missing. */
  async load(id: string): Promise<{ meta: LibraryModelMeta; data: ArrayBuffer } | null> {
    await this.init();
    const meta = this.get(id);
    if (!meta) return null;
    const data = await this.withFallback(() => this.backend.getData(id));
    return data ? { meta, data } : null;
  }

  async add(
    file: { fileName: string; format: LibraryModelMeta["format"]; sizeBytes: number; bboxSize: LibraryModelMeta["bboxSize"] },
    settings: LibraryModelSettings,
    data: ArrayBuffer,
  ): Promise<LibraryModelMeta> {
    await this.init();
    const now = new Date().toISOString();
    const meta: LibraryModelMeta = { id: newModelId(), ...file, ...settings, addedAt: now, updatedAt: now };
    await this.withFallback(async () => {
      await this.backend.putData(meta.id, data);
      await this.backend.putMeta(meta);
    });
    this.setSnapshot({ ...this.snapshot, models: sortModels([...this.snapshot.models, meta]) });
    return meta;
  }

  /**
   * Save edited settings; with `file`, also replace the model file (「ファイルを差し替え…」)
   * and its file fields (name, format, size, measured bbox).
   */
  async update(
    id: string,
    settings: LibraryModelSettings,
    file?: { fileName: string; format: LibraryModelMeta["format"]; sizeBytes: number; bboxSize: LibraryModelMeta["bboxSize"]; data: ArrayBuffer },
  ): Promise<LibraryModelMeta | null> {
    await this.init();
    const prev = this.get(id);
    if (!prev) return null;
    const fileFields = file
      ? { fileName: file.fileName, format: file.format, sizeBytes: file.sizeBytes, bboxSize: file.bboxSize }
      : {};
    const meta: LibraryModelMeta = { ...prev, ...settings, ...fileFields, updatedAt: new Date().toISOString() };
    await this.withFallback(async () => {
      if (file) await this.backend.putData(id, file.data);
      await this.backend.putMeta(meta);
    });
    this.setSnapshot({ ...this.snapshot, models: sortModels(this.snapshot.models.map((m) => (m.id === id ? meta : m))) });
    this.emitChange({ kind: "update", id });
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.init();
    try {
      await this.backend.remove(id);
    } catch (error) {
      console.warn("Model library: delete failed", error);
    }
    this.setSnapshot({ ...this.snapshot, models: this.snapshot.models.filter((m) => m.id !== id) });
    this.emitChange({ kind: "delete", id });
  }

  /**
   * Run a storage call; if the persistent backend throws (quota, revoked
   * access), switch to session storage (copying what is still readable) and retry once.
   */
  private async withFallback<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (this.snapshot.mode === "session") throw error;
      console.warn("Model library storage failed; switching to session-only storage.", error);
      const memory = createMemoryBackend();
      const old = this.backend;
      this.backend = memory;
      this.setSnapshot({ ...this.snapshot, mode: "session" });
      // Keep the bytes of models already listed reachable when the old store can still read them.
      for (const m of this.snapshot.models) {
        try {
          const d = await old.getData(m.id);
          if (d) await memory.putData(m.id, d);
          await memory.putMeta(m);
        } catch {
          /* unreadable — the model will fail to load */
        }
      }
      return await op();
    }
  }

  private emitChange(change: ModelLibraryChange) {
    for (const l of this.changeListeners) l(change);
  }

  private setSnapshot(next: ModelLibrarySnapshot) {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

function sortModels(models: LibraryModelMeta[]): LibraryModelMeta[] {
  return [...models].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
}

function newModelId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function defaultBackend(): ModelStoreBackend | null {
  try {
    if (typeof indexedDB === "undefined") return null;
    return createIndexedDbBackend();
  } catch {
    return null;
  }
}

/** The app's model library. */
export const modelLibrary = new ModelLibrary(defaultBackend());
