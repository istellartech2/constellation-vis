import { get, set, createStore } from "idb-keyval";
import type { CelestrakEntry } from "./celestrakUtils";

const store = createStore("celestrak-cache", "groups");

interface CachedGroup {
  fetchedAt: string;
  data: CelestrakEntry[];
}

export async function readCachedGroup(group: string): Promise<CachedGroup | null> {
  try {
    const value = await get<CachedGroup>(group, store);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function writeCachedGroup(
  group: string,
  data: CelestrakEntry[],
): Promise<void> {
  try {
    await set(group, { fetchedAt: new Date().toISOString(), data }, store);
  } catch {
    // ignore quota / storage errors silently
  }
}
