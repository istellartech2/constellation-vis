import type { OrbitalElements } from "./satellites";

export type ManualSatelliteType = "tle" | "elements";
export type FormationRelativeModel = "roe" | "relativeState";
export type FormationPreset =
  | "custom"
  | "along-track-train"
  | "projected-circular"
  | "general-circular-orbit"
  | "in-plane-ellipse"
  | "cross-track-only";

export interface SatelliteEditorMetadata {
  objectName?: string;
  objectId?: string;
  noradCatId?: number;
}

export interface SatelliteEditorTle {
  line1: string;
  line2: string;
}

export interface SatelliteEditorRoe {
  deltaAkm: number;
  deltaLambdaDeg: number;
  deltaEx: number;
  deltaEy: number;
  deltaIxDeg: number;
  deltaIyDeg: number;
}

export interface SatelliteEditorRelativeState {
  radialKm: number;
  alongTrackKm: number;
  crossTrackKm: number;
  phaseOffsetDeg: number;
}

export interface ManualSatelliteEntry {
  id: string;
  kind: "manual";
  type: ManualSatelliteType;
  name?: string;
  meta?: SatelliteEditorMetadata;
  tle?: SatelliteEditorTle;
  elements?: OrbitalElements;
}

export interface FormationSatelliteEntry {
  id: string;
  kind: "formation";
  name: string;
  chiefSatnum: number;
  deputyCount: number;
  epoch?: Date;
  relativeModel: FormationRelativeModel;
  preset: FormationPreset;
  roe: SatelliteEditorRoe;
  relativeState: SatelliteEditorRelativeState;
}

export type SatelliteEditorEntry = ManualSatelliteEntry | FormationSatelliteEntry;

export interface SatelliteEditorConfig {
  entries: SatelliteEditorEntry[];
}

export const DEFAULT_ROE: SatelliteEditorRoe = {
  deltaAkm: 0,
  deltaLambdaDeg: 0,
  deltaEx: 0,
  deltaEy: 0,
  deltaIxDeg: 0,
  deltaIyDeg: 0,
};

export const DEFAULT_RELATIVE_STATE: SatelliteEditorRelativeState = {
  radialKm: 0,
  alongTrackKm: 10,
  crossTrackKm: 0,
  phaseOffsetDeg: 0,
};

export function createDefaultManualEntry(): ManualSatelliteEntry {
  return {
    id: crypto.randomUUID(),
    kind: "manual",
    type: "elements",
    name: "",
    meta: {},
    elements: {
      satnum: 90001,
      epoch: new Date(),
      semiMajorAxisKm: 7000,
      eccentricity: 0.001,
      inclinationDeg: 98,
      raanDeg: 0,
      argPerigeeDeg: 0,
      meanAnomalyDeg: 0,
    },
  };
}

export function createDefaultFormationEntry(): FormationSatelliteEntry {
  return {
    id: crypto.randomUUID(),
    kind: "formation",
    name: "Formation",
    chiefSatnum: 0,
    deputyCount: 1,
    epoch: undefined,
    relativeModel: "roe",
    preset: "custom",
    roe: { ...DEFAULT_ROE },
    relativeState: { ...DEFAULT_RELATIVE_STATE, alongTrackKm: 0 },
  };
}
