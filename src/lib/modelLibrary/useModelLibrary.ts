import { useSyncExternalStore } from "react";
import { modelLibrary, type ModelLibrarySnapshot } from "./store";
import { DEFAULT_SATELLITE_MODEL, libraryModelId } from "./types";

/** Live snapshot of the model library (loads the listing on first use). */
export function useModelLibrary(): ModelLibrarySnapshot {
  return useSyncExternalStore(modelLibrary.subscribe, modelLibrary.getSnapshot, modelLibrary.getSnapshot);
}

/**
 * The model the scene should draw for a stored satelliteModel value: a
 * library model that is not (or no longer) in this browser's library falls
 * back to 標準バス once the listing is known.
 */
export function resolveSatelliteModel(value: string, library: ModelLibrarySnapshot): string {
  const id = libraryModelId(value);
  if (id === null) return DEFAULT_SATELLITE_MODEL;
  if (!library.ready) return value;
  return library.models.some((m) => m.id === id) ? value : DEFAULT_SATELLITE_MODEL;
}

/** Display name of a model string among the built-ins and the library ("" if unknown). */
export function libraryModelName(value: string | undefined, library: ModelLibrarySnapshot): string | null {
  const id = libraryModelId(value);
  if (id === null) return null;
  return library.models.find((m) => m.id === id)?.name ?? null;
}
