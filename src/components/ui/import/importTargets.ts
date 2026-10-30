import type { NewCatalogLayer } from "../../../lib/useCatalogLayers";
import type { SatelliteSpec } from "../../../lib/satellites";

/** Satellites the TOML editor can hold comfortably (filings get ids 90000–99999). */
export const SCENARIO_LIMIT = 10_000;
/** Above this, a layer is the better default (editor parse and SGP4 cost grow per satellite). */
export const SCENARIO_RECOMMENDED_MAX = 2_000;

export type ImportDestination = "scenario" | "layer";
export type NewLayer = NewCatalogLayer;

/** What every source panel can do with its result; provided by the dialog. */
export interface ImportTargets {
  editorCount: number;
  layerCount: number;
  layerLimit: number;
  /** Scenario start ("YYYY-MM-DDTHH:mm", UTC). */
  startText: string;
  /** Merge into the editor satellites and apply to the 3D view (throws on invalid data). */
  addToScenario: (specs: SatelliteSpec[]) => void;
  /** Add a display layer, drawn immediately. */
  addLayer: (layer: NewLayer) => void;
  close: () => void;
}

export function recommendedDestination(count: number): ImportDestination {
  return count <= SCENARIO_RECOMMENDED_MAX ? "scenario" : "layer";
}

/** Why a destination cannot take `count` satellites, or null. */
export function destinationBlock(dest: ImportDestination, count: number, targets: ImportTargets): string | null {
  if (dest === "scenario" && count > SCENARIO_LIMIT) return `シナリオの上限（${SCENARIO_LIMIT.toLocaleString()}機）を超えます`;
  if (dest === "layer" && targets.layerCount >= targets.layerLimit) return `レイヤーは${targets.layerLimit}個までです。不要なレイヤーを削除してください`;
  return null;
}
