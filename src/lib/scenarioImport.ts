import { expandSatelliteEditorConfig, parseSatelliteEditorConfig, serializeSatelliteEditorConfig } from "./satelliteEditorSerializer";
import { mergeImportedSatellites, satellitesToToml } from "../utils/celestrakUtils";
import type { SatelliteEditorEntry } from "./satelliteEditorTypes";
import type { SatelliteSpec } from "./satellites";

/**
 * Merge imported catalog objects into the scenario at editor-entry level.
 * Manual entries are updated or moved to a free local number through
 * `mergeImportedSatellites`; formation entries are kept as definitions and
 * follow their chief when it is renumbered.
 */
export function mergeImportedIntoScenarioText(text: string, imported: SatelliteSpec[]): string {
  const entries = parseSatelliteEditorConfig(text).entries;
  // Expand one entry at a time so each manual entry maps to exactly one spec.
  const base: { index: number; spec: SatelliteSpec }[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind !== "manual") return;
    const [spec] = expandSatelliteEditorConfig({ entries: [entry] });
    if (spec) base.push({ index, spec });
  });
  const merged = mergeImportedSatellites(base.map(b => b.spec), imported);
  const result: SatelliteEditorEntry[] = [...entries];
  const renumbered = new Map<number, number>();
  base.forEach(({ index, spec }, i) => {
    const next = merged[i];
    if (next === spec) return;
    if (imported.includes(next)) {
      result[index] = parseSatelliteEditorConfig(satellitesToToml([next])).entries[0];
      return;
    }
    // A local object moved to a free number: patch it so GEO entries stay GEO.
    const entry = result[index];
    if (entry.kind !== "manual" || next.type !== "elements" || spec.type !== "elements") return;
    const satnum = next.elements.satnum;
    renumbered.set(spec.elements.satnum, satnum);
    result[index] = {
      ...entry,
      elements: entry.elements && { ...entry.elements, satnum },
      geo: entry.geo && { ...entry.geo, satnum },
      meta: entry.meta?.noradCatId !== undefined ? { ...entry.meta, noradCatId: satnum } : entry.meta,
    };
  });
  const added = parseSatelliteEditorConfig(satellitesToToml(merged.slice(base.length))).entries;
  return serializeSatelliteEditorConfig({
    entries: [...result, ...added].map(entry =>
      entry.kind === "formation" && renumbered.has(entry.chiefSatnum)
        ? { ...entry, chiefSatnum: renumbered.get(entry.chiefSatnum)! }
        : entry),
  });
}
