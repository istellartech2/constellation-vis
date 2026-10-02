import { get, set, createStore } from "idb-keyval";
import type { CelestrakEntry } from "./celestrakUtils";

const store = createStore("celestrak-cache", "groups");

interface CachedGroup {
  fetchedAt: string;
  data: CelestrakEntry[];
}

// Retain downloads for this session even if IndexedDB is unavailable (e.g.
// private browsing), so repeated imports do not trigger CelesTrak's blocks.
const sessionCache = new Map<string, CachedGroup>();

export async function readCachedGroup(group: string): Promise<CachedGroup | null> {
  const session = sessionCache.get(group);
  if (session) return session;
  try {
    const value = await get<CachedGroup>(group, store);
    if (value) sessionCache.set(group, value);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function writeCachedGroup(
  group: string,
  data: CelestrakEntry[],
): Promise<void> {
  const value = { fetchedAt: new Date().toISOString(), data };
  sessionCache.set(group, value);
  try {
    await set(group, value, store);
  } catch {
    // ignore quota / storage errors silently
  }
}
