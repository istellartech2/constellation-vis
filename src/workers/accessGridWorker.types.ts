import type { AccessGrid } from "../lib/accessGrid";
import type { GroundStation } from "../lib/groundStations";
import type { SatelliteFovCriteria } from "../lib/visibility";

export interface AccessGridJob {
  satText: string;
  constText: string;
  /** Real ground stations (station access) or generated latitude probes (global access). */
  stations: GroundStation[];
  startTimeIso: string;
  durationHours: number;
  stepSeconds: number;
  /**
   * Satellite sensor FOV to AND onto each station's own criteria. Omitted when
   * the user leaves the option off; the values themselves come from the shared
   * display settings (`fovCone*`), never from an analysis-only copy.
   */
  satelliteFov?: SatelliteFovCriteria;
}

export interface AccessGridRequest {
  id: number;
  type: "analyze";
  payload: AccessGridJob;
}

export interface AccessGridResult {
  grid: AccessGrid;
  satelliteCount: number;
}

export type AccessGridResponse =
  | { id: number; type: "progress"; fraction: number }
  | { id: number; type: "success"; payload: AccessGridResult }
  | { id: number; type: "error"; message: string };
