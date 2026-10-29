export interface FilingPlane {
  id: number;
  satellites: number;
  inclination: number;
  apogee: number;
  perigee: number;
  ascendingLongitude: number | null;
  argumentOfPerigee: number;
  phases: (number | null)[];
  action: string;
}
export interface FilingConfiguration {
  id: string;
  planes: FilingPlane[];
  count: number;
  hasSuppressedRows: boolean;
}
export interface FilingDataset {
  key: string;
  name: string;
  filename: string;
  sha256: string;
  sourceUrl: string;
  reference: string;
  sourceDate: string;
  note: string;
  configurations: FilingConfiguration[];
  preferredConfiguration: string;
  warnings: string[];
}
export type FilingRow = Record<string, unknown>;
export interface FilingTables { notice: FilingRow[]; non_geo: FilingRow[]; orbit: FilingRow[]; phase: FilingRow[] }
export type FilingWorkerResponse = { ok: true; dataset: FilingDataset } | { ok: false; message: string };
