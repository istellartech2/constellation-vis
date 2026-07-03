import type { OrbitalElements } from "./satellites";

export type ManualSatelliteType = "tle" | "elements" | "geo";
export type FormationRelativeModel = "roe" | "relativeState";
export type FormationMode =
  | "custom"
  | "alongTrack"
  | "nmc"
  | "crossTrackPendulum"
  | "helix"
  | "gco";
export type AlongTrackArrangement = "centered";
export type ProgradeDirection = "prograde" | "retrograde";
export type CrossTrackSide = "north" | "south";

export interface SatelliteEditorMetadata {
  objectName?: string;
  objectId?: string;
  noradCatId?: number;
}

export interface SatelliteEditorTle {
  line1: string;
  line2: string;
}

/**
 * Simplified input for a geostationary satellite: the user supplies only the
 * longitude, and the orbital elements are derived from it. `inclinationDeg`
 * (default 0) allows inclined geosynchronous orbits; `epoch` anchors the GMST
 * used to convert longitude into mean anomaly.
 */
export interface SatelliteEditorGeo {
  satnum: number;
  epoch: Date;
  longitudeDeg: number;
  inclinationDeg: number;
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
  geo?: SatelliteEditorGeo;
}

export interface FormationBaseEntry {
  id: string;
  kind: "formation";
  name: string;
  chiefSatnum: number;
  epoch?: Date;
  formationMode: FormationMode;
}

export interface CustomFormationEntry extends FormationBaseEntry {
  formationMode: "custom";
  deputyCount: number;
  relativeModel: FormationRelativeModel;
  roe: SatelliteEditorRoe;
  relativeState: SatelliteEditorRelativeState;
}

export interface AlongTrackFormationEntry extends FormationBaseEntry {
  formationMode: "alongTrack";
  deputyCount: number;
  spacingKm: number;
  arrangement: AlongTrackArrangement;
  direction: ProgradeDirection;
}

export interface NmcFormationEntry extends FormationBaseEntry {
  formationMode: "nmc";
  sizeKm: number;
  orientationDeg: number;
  equidistant: boolean;
  crossTrackSign: CrossTrackSide;
  crossTrackOffsetKm: number;
  phaseOffsetDeg: number;
}

export interface CrossTrackPendulumFormationEntry extends FormationBaseEntry {
  formationMode: "crossTrackPendulum";
  amplitudeKm: number;
  phaseOffsetDeg: number;
  side: CrossTrackSide;
}

export interface HelixFormationEntry extends FormationBaseEntry {
  formationMode: "helix";
  deputyCount: number;
  radiusKm: number;
  pitchKm: number;
  turnDirection: ProgradeDirection;
  phaseOffsetDeg: number;
}

export interface GcoFormationEntry extends FormationBaseEntry {
  formationMode: "gco";
  deputyCount: number;
  radiusKm: number;
  phaseOffsetDeg: number;
  rotationDirection: ProgradeDirection;
}

export type FormationSatelliteEntry =
  | CustomFormationEntry
  | AlongTrackFormationEntry
  | NmcFormationEntry
  | CrossTrackPendulumFormationEntry
  | HelixFormationEntry
  | GcoFormationEntry;

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
  alongTrackKm: 0,
  crossTrackKm: 0,
  phaseOffsetDeg: 0,
};

export const FORMATION_MODES: Array<{ mode: FormationMode; label: string; blurb: string }> = [
  { mode: "custom", label: "Custom", blurb: "ROE / 距離ベースで自由入力" },
  { mode: "alongTrack", label: "Along-track", blurb: "chief を中心に列をなす編隊" },
  { mode: "nmc", label: "NMC", blurb: "自然相対運動の 2:1 楕円 circumnavigation" },
  { mode: "crossTrackPendulum", label: "Cross-track pendulum", blurb: "面外方向の振り子型相対運動" },
  { mode: "helix", label: "Helix", blurb: "位相分散 + 進行方向ピッチの螺旋編隊" },
  { mode: "gco", label: "GCO", blurb: "record-disk 軌道として等距離を保つ 3D 円運動" },
];

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

export function createDefaultGeoEntry(): ManualSatelliteEntry {
  return {
    id: crypto.randomUUID(),
    kind: "manual",
    type: "geo",
    name: "",
    meta: {},
    geo: {
      satnum: 90001,
      epoch: new Date(),
      longitudeDeg: 0,
      inclinationDeg: 0,
    },
  };
}

export function createDefaultFormationEntry(mode: FormationMode = "custom"): FormationSatelliteEntry {
  const id = crypto.randomUUID();
  const base: FormationBaseEntry = {
    id,
    kind: "formation",
    name: "Formation",
    chiefSatnum: 0,
    epoch: undefined,
    formationMode: mode,
  };

  switch (mode) {
    case "alongTrack":
      return {
        ...base,
        formationMode: "alongTrack",
        name: "Along-track Formation",
        deputyCount: 4,
        spacingKm: 10,
        arrangement: "centered",
        direction: "prograde",
      };
    case "nmc":
      return {
        ...base,
        formationMode: "nmc",
        name: "Natural Motion Circumnavigation",
        sizeKm: 8,
        orientationDeg: 0,
        equidistant: true,
        crossTrackSign: "north",
        crossTrackOffsetKm: 13.856,
        phaseOffsetDeg: 0,
      };
    case "crossTrackPendulum":
      return {
        ...base,
        formationMode: "crossTrackPendulum",
        name: "Cross-track Pendulum",
        amplitudeKm: 8,
        phaseOffsetDeg: 90,
        side: "north",
      };
    case "helix":
      return {
        ...base,
        formationMode: "helix",
        name: "Helix Formation",
        deputyCount: 4,
        radiusKm: 6,
        pitchKm: 4,
        turnDirection: "prograde",
        phaseOffsetDeg: 0,
      };
    case "gco":
      return {
        ...base,
        formationMode: "gco",
        name: "General Circular Orbit",
        deputyCount: 4,
        radiusKm: 8,
        phaseOffsetDeg: 0,
        rotationDirection: "prograde",
      };
    case "custom":
    default:
      return {
        ...base,
        formationMode: "custom",
        name: "Custom Formation",
        deputyCount: 1,
        relativeModel: "roe",
        roe: { ...DEFAULT_ROE },
        relativeState: { ...DEFAULT_RELATIVE_STATE },
      };
  }
}
