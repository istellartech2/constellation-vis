import type { OrbitalElements, SatelliteMetadata, SatelliteSpec } from "./satellites";
import {
  createDefaultFormationEntry,
  createDefaultManualEntry,
  type AlongTrackFormationEntry,
  type CrossTrackPendulumFormationEntry,
  type CustomFormationEntry,
  type FormationMode,
  type FormationSatelliteEntry,
  type GcoFormationEntry,
  type HelixFormationEntry,
  type ManualSatelliteEntry,
  type NmcFormationEntry,
  type SatelliteEditorConfig,
  type SatelliteEditorEntry,
  type SatelliteEditorMetadata,
  type SatelliteEditorRelativeState,
  type SatelliteEditorRoe,
} from "./satelliteEditorTypes";

const MANUAL_SATNUM_MIN = 90000;
const MANUAL_SATNUM_MAX = 99999;
const NEAR_CIRCULAR_ECC_MAX = 0.02;
const SQRT3 = Math.sqrt(3);
const EARTH_MU_KM3_S2 = 398600.4418;

export interface SatelliteEditorValidationError {
  field: string;
  message: string;
}

export interface SatelliteEditorValidationResult {
  isValid: boolean;
  errors: SatelliteEditorValidationError[];
}

type TomlRecord = Record<string, string | number | boolean | Date>;

function parseValue(raw: string): string | number | boolean | Date {
  const s = raw.trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/.test(s)) {
    return new Date(s.replace(/['"]/g, ""));
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

function parseArrayTable(text: string, marker: string): TomlRecord[] {
  const lines = text.split(/\r?\n/);
  const result: TomlRecord[] = [];
  let current: TomlRecord | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === `[[${marker}]]`) {
      if (current) result.push(current);
      current = {};
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const value = parseValue(match[2]);
    if (!current) current = { [key]: value };
    else current[key] = value;
  }
  if (current) result.push(current);
  return result;
}

function formatTomlDate(date: Date): string {
  return JSON.stringify(date.toISOString().replace(/\.\d{3}Z$/, "Z"));
}

function formatNumber(value: number, decimals: number = 6): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(decimals).replace(/\.?0+$/, "") || "0";
}

function normalizeAngleDeg(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function magnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const mag = magnitude(v);
  if (mag < 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(v, 1 / mag);
}

function eccentricAnomalyFromMeanAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomalyRad;
  for (let i = 0; i < 10; i += 1) {
    const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return eccentricAnomaly;
}

function stateVectorsFromElements(elements: OrbitalElements): { position: Vec3; velocity: Vec3 } {
  const a = elements.semiMajorAxisKm;
  const e = elements.eccentricity;
  const inc = degToRad(elements.inclinationDeg);
  const raan = degToRad(elements.raanDeg);
  const argp = degToRad(elements.argPerigeeDeg);
  const meanAnomaly = degToRad(elements.meanAnomalyDeg);
  const eccentricAnomaly = eccentricAnomalyFromMeanAnomaly(meanAnomaly, e);
  const cosE = Math.cos(eccentricAnomaly);
  const sinE = Math.sin(eccentricAnomaly);
  const radius = a * (1 - e * cosE);
  const xP = a * (cosE - e);
  const yP = a * Math.sqrt(1 - e * e) * sinE;
  const factor = Math.sqrt(EARTH_MU_KM3_S2 * a) / radius;
  const vxP = -factor * sinE;
  const vyP = factor * Math.sqrt(1 - e * e) * cosE;

  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosArgp = Math.cos(argp);
  const sinArgp = Math.sin(argp);
  const cosInc = Math.cos(inc);
  const sinInc = Math.sin(inc);

  const pHat: Vec3 = {
    x: cosRaan * cosArgp - sinRaan * sinArgp * cosInc,
    y: sinRaan * cosArgp + cosRaan * sinArgp * cosInc,
    z: sinArgp * sinInc,
  };
  const qHat: Vec3 = {
    x: -cosRaan * sinArgp - sinRaan * cosArgp * cosInc,
    y: -sinRaan * sinArgp + cosRaan * cosArgp * cosInc,
    z: cosArgp * sinInc,
  };

  return {
    position: add(scale(pHat, xP), scale(qHat, yP)),
    velocity: add(scale(pHat, vxP), scale(qHat, vyP)),
  };
}

function orbitalElementsFromState(position: Vec3, velocity: Vec3, epoch: Date, satnum: number): OrbitalElements {
  const r = magnitude(position);
  const v = magnitude(velocity);
  const hVec = cross(position, velocity);
  const h = magnitude(hVec);
  const nodeVec = cross({ x: 0, y: 0, z: 1 }, hVec);
  const node = magnitude(nodeVec);
  const eVec = add(scale(cross(velocity, hVec), 1 / EARTH_MU_KM3_S2), scale(position, -1 / r));
  const e = magnitude(eVec);
  const energy = (v * v) / 2 - EARTH_MU_KM3_S2 / r;
  const a = -EARTH_MU_KM3_S2 / (2 * energy);
  const inclination = Math.acos(Math.min(1, Math.max(-1, hVec.z / Math.max(h, 1e-12))));

  let raan = 0;
  if (node > 1e-12) {
    raan = Math.atan2(nodeVec.y, nodeVec.x);
  }

  let argPerigee = 0;
  if (node > 1e-12 && e > 1e-10) {
    const cosArgp = Math.min(1, Math.max(-1, dot(nodeVec, eVec) / (node * e)));
    argPerigee = Math.acos(cosArgp);
    if (eVec.z < 0) argPerigee = 2 * Math.PI - argPerigee;
  } else if (e > 1e-10) {
    argPerigee = Math.atan2(eVec.y, eVec.x);
  }

  let trueAnomaly = 0;
  if (e > 1e-10) {
    const cosNu = Math.min(1, Math.max(-1, dot(eVec, position) / (e * r)));
    trueAnomaly = Math.acos(cosNu);
    if (dot(position, velocity) < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  } else if (node > 1e-12) {
    const cosU = Math.min(1, Math.max(-1, dot(nodeVec, position) / (node * r)));
    trueAnomaly = Math.acos(cosU);
    if (position.z < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  } else {
    trueAnomaly = Math.atan2(position.y, position.x);
  }

  let meanAnomaly = trueAnomaly;
  if (e > 1e-10) {
    const eccentricAnomaly = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2), Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2));
    meanAnomaly = eccentricAnomaly - e * Math.sin(eccentricAnomaly);
  }

  return {
    satnum,
    epoch,
    semiMajorAxisKm: a,
    eccentricity: e,
    inclinationDeg: normalizeAngleDeg(radToDeg(inclination)),
    raanDeg: normalizeAngleDeg(radToDeg(raan)),
    argPerigeeDeg: normalizeAngleDeg(radToDeg(argPerigee)),
    meanAnomalyDeg: normalizeAngleDeg(radToDeg(meanAnomaly)),
  };
}

function orbitalMetaFromEntry(entry: TomlRecord): SatelliteEditorMetadata | undefined {
  const meta: SatelliteEditorMetadata = {};
  if (entry.name !== undefined) meta.objectName = String(entry.name);
  if (entry.objectName !== undefined) meta.objectName = String(entry.objectName);
  if (entry.objectId !== undefined) meta.objectId = String(entry.objectId);
  if (entry.noradCatId !== undefined) meta.noradCatId = Number(entry.noradCatId);
  return meta.objectName || meta.objectId || meta.noradCatId !== undefined ? meta : undefined;
}

function cloneMeta(meta?: SatelliteEditorMetadata): SatelliteMetadata | undefined {
  if (!meta) return undefined;
  return {
    objectName: meta.objectName,
    objectId: meta.objectId,
    noradCatId: meta.noradCatId,
  };
}

function getChiefDisplayName(entry: ManualSatelliteEntry): string {
  return entry.meta?.objectName || entry.name || `Chief ${entry.elements?.satnum ?? "?"}`;
}

function getChiefElements(entry: ManualSatelliteEntry): OrbitalElements | null {
  if (entry.type !== "elements" || !entry.elements) return null;
  return entry.elements;
}

function relativeStateToRoe(chief: OrbitalElements, relativeState: SatelliteEditorRelativeState): SatelliteEditorRoe {
  const phaseRad = degToRad(relativeState.phaseOffsetDeg);
  const a = Math.max(chief.semiMajorAxisKm, 1);
  const radialVector = relativeState.radialKm / a;
  const crossTrackVector = relativeState.crossTrackKm / a;
  return {
    deltaAkm: 0,
    deltaLambdaDeg: radToDeg(relativeState.alongTrackKm / a),
    deltaEx: radialVector * Math.cos(phaseRad),
    deltaEy: radialVector * Math.sin(phaseRad),
    deltaIxDeg: radToDeg(crossTrackVector * Math.cos(phaseRad)),
    deltaIyDeg: radToDeg(crossTrackVector * Math.sin(phaseRad)),
  };
}

function roeToRelativeState(chief: OrbitalElements, roe: SatelliteEditorRoe): SatelliteEditorRelativeState {
  const a = Math.max(chief.semiMajorAxisKm, 1);
  const radialVector = Math.hypot(roe.deltaEx, roe.deltaEy);
  const crossTrackVector = Math.hypot(degToRad(roe.deltaIxDeg), degToRad(roe.deltaIyDeg));
  const phaseRad = Math.atan2(roe.deltaEy, roe.deltaEx);
  return {
    radialKm: radialVector * a,
    alongTrackKm: degToRad(roe.deltaLambdaDeg) * a,
    crossTrackKm: crossTrackVector * a,
    phaseOffsetDeg: normalizeAngleDeg(radToDeg(phaseRad)),
  };
}

function buildDeputyElements(chief: OrbitalElements, roe: SatelliteEditorRoe, satnum: number, epoch?: Date): OrbitalElements {
  const chiefEx = chief.eccentricity * Math.cos(degToRad(chief.argPerigeeDeg));
  const chiefEy = chief.eccentricity * Math.sin(degToRad(chief.argPerigeeDeg));
  const deputyEx = chiefEx + roe.deltaEx;
  const deputyEy = chiefEy + roe.deltaEy;
  const deputyEcc = Math.min(0.999, Math.hypot(deputyEx, deputyEy));
  const deputyArgPerigee = deputyEcc > 1e-9 ? normalizeAngleDeg(radToDeg(Math.atan2(deputyEy, deputyEx))) : chief.argPerigeeDeg;
  const deputyMeanAnomaly = chief.meanAnomalyDeg + roe.deltaLambdaDeg - roe.deltaEx * 180;
  const chiefIncRad = degToRad(chief.inclinationDeg);
  const deltaIxRad = degToRad(roe.deltaIxDeg);
  const deltaIyRad = degToRad(roe.deltaIyDeg);
  const deputyInclination = chief.inclinationDeg + radToDeg(deltaIxRad);
  const sinInclination = Math.max(Math.abs(Math.sin(chiefIncRad)), 0.1);
  const deputyRaan = chief.raanDeg + radToDeg(deltaIyRad / sinInclination);
  return {
    satnum,
    epoch: epoch ?? chief.epoch,
    semiMajorAxisKm: chief.semiMajorAxisKm + roe.deltaAkm,
    eccentricity: deputyEcc,
    inclinationDeg: deputyInclination,
    raanDeg: normalizeAngleDeg(deputyRaan),
    argPerigeeDeg: normalizeAngleDeg(deputyArgPerigee),
    meanAnomalyDeg: normalizeAngleDeg(deputyMeanAnomaly),
  };
}

function buildDeputyElementsFromHillState(
  chief: OrbitalElements,
  relativePosition: SatelliteEditorRelativeState,
  relativeVelocity: Vec3,
  satnum: number,
  epoch?: Date,
): OrbitalElements {
  const chiefState = stateVectorsFromElements(chief);
  const rHat = normalize(chiefState.position);
  const hVec = cross(chiefState.position, chiefState.velocity);
  const wHat = normalize(hVec);
  const sHat = normalize(cross(wHat, rHat));
  const rhoInertial = add(
    add(scale(rHat, relativePosition.radialKm), scale(sHat, relativePosition.alongTrackKm)),
    scale(wHat, relativePosition.crossTrackKm),
  );
  const rhoDotInertial = add(
    add(scale(rHat, relativeVelocity.x), scale(sHat, relativeVelocity.y)),
    scale(wHat, relativeVelocity.z),
  );
  const omega = scale(wHat, magnitude(hVec) / Math.max(magnitude(chiefState.position) ** 2, 1e-12));
  const deputyPosition = add(chiefState.position, rhoInertial);
  const deputyVelocity = add(chiefState.velocity, add(rhoDotInertial, cross(omega, rhoInertial)));
  return orbitalElementsFromState(deputyPosition, deputyVelocity, epoch ?? chief.epoch, satnum);
}

function centeredOffsets(count: number): number[] {
  if (count <= 0) return [];
  const offsets: number[] = [];
  if (count % 2 === 0) {
    const half = count / 2;
    for (let i = 0; i < count; i += 1) offsets.push(i - half + 0.5);
  } else {
    const half = Math.floor(count / 2);
    for (let i = 0; i < count; i += 1) {
      const offset = i - half;
      if (offset !== 0) offsets.push(offset);
    }
    offsets.splice(half, 0, 0);
  }
  return offsets;
}

function modeLabel(mode: FormationMode): string {
  switch (mode) {
    case "alongTrack": return "Along-track";
    case "nmc": return "NMC";
    case "crossTrackPendulum": return "Cross-track Pendulum";
    case "helix": return "Helix";
    case "gco": return "GCO";
    case "custom":
    default: return "Custom";
  }
}

function addDeputy(output: SatelliteSpec[], chief: OrbitalElements, name: string, satnum: number, roe: SatelliteEditorRoe, epoch?: Date) {
  output.push({
    type: "elements",
    elements: buildDeputyElements(chief, roe, satnum, epoch),
    meta: {
      objectName: name,
      noradCatId: satnum,
    },
  });
}

function serializeCommonFormation(lines: string[], entry: FormationSatelliteEntry) {
  lines.push('type = "formation"');
  lines.push(`name = ${JSON.stringify(entry.name)}`);
  lines.push(`chiefSatnum = ${entry.chiefSatnum}`);
  if (entry.epoch) lines.push(`epoch = ${formatTomlDate(entry.epoch)}`);
  lines.push(`formationMode = ${JSON.stringify(entry.formationMode)}`);
}

function parseCustomFormation(entry: TomlRecord): CustomFormationEntry {
  return {
    ...createDefaultFormationEntry("custom"),
    id: crypto.randomUUID(),
    name: String(entry.name ?? "Custom Formation"),
    chiefSatnum: Number(entry.chiefSatnum ?? 0),
    deputyCount: Number(entry.deputyCount ?? 1),
    epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
    formationMode: "custom",
    relativeModel: String(entry.relativeModel ?? "roe") as CustomFormationEntry["relativeModel"],
    roe: {
      deltaAkm: Number(entry.deltaAkm ?? 0),
      deltaLambdaDeg: Number(entry.deltaLambdaDeg ?? 0),
      deltaEx: Number(entry.deltaEx ?? 0),
      deltaEy: Number(entry.deltaEy ?? 0),
      deltaIxDeg: Number(entry.deltaIxDeg ?? 0),
      deltaIyDeg: Number(entry.deltaIyDeg ?? 0),
    },
    relativeState: {
      radialKm: Number(entry.radialKm ?? 0),
      alongTrackKm: Number(entry.alongTrackKm ?? 0),
      crossTrackKm: Number(entry.crossTrackKm ?? 0),
      phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 0),
    },
  };
}

function parseFormation(entry: TomlRecord): FormationSatelliteEntry {
  const mode = String(entry.formationMode ?? "");
  if (!mode) {
    throw new Error("旧形式の formation は未対応です。新しい編隊モードで作り直してください。");
  }
  switch (mode as FormationMode) {
    case "custom":
      return parseCustomFormation(entry);
    case "alongTrack":
      return {
        ...createDefaultFormationEntry("alongTrack"),
        id: crypto.randomUUID(),
        name: String(entry.name ?? "Along-track Formation"),
        chiefSatnum: Number(entry.chiefSatnum ?? 0),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        formationMode: "alongTrack",
        deputyCount: Number(entry.deputyCount ?? 4),
        spacingKm: Number(entry.spacingKm ?? 10),
        arrangement: "centered",
        direction: String(entry.direction ?? "prograde") as AlongTrackFormationEntry["direction"],
      };
    case "nmc":
      return {
        ...createDefaultFormationEntry("nmc"),
        id: crypto.randomUUID(),
        name: String(entry.name ?? "Natural Motion Circumnavigation"),
        chiefSatnum: Number(entry.chiefSatnum ?? 0),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        formationMode: "nmc",
        sizeKm: Number(entry.sizeKm ?? 8),
        orientationDeg: Number(entry.orientationDeg ?? 0),
        equidistant: Boolean(entry.equidistant ?? true),
        crossTrackSign: String(entry.crossTrackSign ?? "north") as NmcFormationEntry["crossTrackSign"],
        crossTrackOffsetKm: Number(entry.crossTrackOffsetKm ?? 13.856),
        phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 0),
      };
    case "crossTrackPendulum":
      return {
        ...createDefaultFormationEntry("crossTrackPendulum"),
        id: crypto.randomUUID(),
        name: String(entry.name ?? "Cross-track Pendulum"),
        chiefSatnum: Number(entry.chiefSatnum ?? 0),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        formationMode: "crossTrackPendulum",
        amplitudeKm: Number(entry.amplitudeKm ?? 8),
        phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 90),
        side: String(entry.side ?? "north") as CrossTrackPendulumFormationEntry["side"],
      };
    case "helix":
      return {
        ...createDefaultFormationEntry("helix"),
        id: crypto.randomUUID(),
        name: String(entry.name ?? "Helix Formation"),
        chiefSatnum: Number(entry.chiefSatnum ?? 0),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        formationMode: "helix",
        deputyCount: Number(entry.deputyCount ?? 4),
        radiusKm: Number(entry.radiusKm ?? 6),
        pitchKm: Number(entry.pitchKm ?? 4),
        turnDirection: String(entry.turnDirection ?? "prograde") as HelixFormationEntry["turnDirection"],
        phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 0),
      };
    case "gco":
      return {
        ...createDefaultFormationEntry("gco"),
        id: crypto.randomUUID(),
        name: String(entry.name ?? "General Circular Orbit"),
        chiefSatnum: Number(entry.chiefSatnum ?? 0),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        formationMode: "gco",
        deputyCount: Number(entry.deputyCount ?? 4),
        radiusKm: Number(entry.radiusKm ?? 8),
        phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 0),
        rotationDirection: String(entry.rotationDirection ?? "prograde") as GcoFormationEntry["rotationDirection"],
      };
    default:
      throw new Error(`未知の formationMode です: ${mode}`);
  }
}

export function getFormationModeDescription(mode: FormationMode): string {
  switch (mode) {
    case "alongTrack":
      return "chief を中心に進行方向へ列をなす編隊です。";
    case "nmc":
      return "自然相対運動で 2:1 の面内楕円を描く circumnavigation 編隊です。";
    case "crossTrackPendulum":
      return "面外方向を主体に振り子のように相対運動する編隊です。";
    case "helix":
      return "chief 周囲を位相分散し、進行方向にピッチを持つ螺旋編隊です。";
    case "gco":
      return "GCO / record-disk orbit は chief からの距離をほぼ一定に保ちつつ、z = √3 x を満たす 3次元の円運動編隊です。";
    case "custom":
    default:
      return "ROE または距離ベースで自由に相対軌道を指定します。";
  }
}

export function getEntryDisplayName(entry: SatelliteEditorEntry, index: number): string {
  if (entry.kind === "manual") {
    const label = entry.meta?.objectName || entry.name;
    if (label) return label;
    if (entry.type === "elements" && entry.elements) return `Satellite ${entry.elements.satnum}`;
    return `TLE ${index + 1}`;
  }
  return entry.name || `${modeLabel(entry.formationMode)} ${index + 1}`;
}

export function parseSatelliteEditorConfig(text: string): SatelliteEditorConfig {
  if (!text.trim()) return { entries: [] };
  const records = parseArrayTable(text, "satellites");
  const entries: SatelliteEditorEntry[] = records.map((entry) => {
    const type = String(entry.type ?? "elements");
    if (type === "tle") {
      return {
        id: crypto.randomUUID(),
        kind: "manual",
        type: "tle",
        name: entry.name !== undefined ? String(entry.name) : undefined,
        meta: orbitalMetaFromEntry(entry),
        tle: { line1: String(entry.line1 ?? ""), line2: String(entry.line2 ?? "") },
      } satisfies ManualSatelliteEntry;
    }
    if (type === "elements") {
      return {
        id: crypto.randomUUID(),
        kind: "manual",
        type: "elements",
        name: entry.name !== undefined ? String(entry.name) : undefined,
        meta: orbitalMetaFromEntry(entry),
        elements: {
          satnum: Number(entry.satnum ?? 90001),
          epoch: entry.epoch instanceof Date ? entry.epoch : new Date(String(entry.epoch ?? new Date().toISOString())),
          semiMajorAxisKm: Number(entry.semiMajorAxisKm ?? 7000),
          eccentricity: Number(entry.eccentricity ?? 0),
          inclinationDeg: Number(entry.inclinationDeg ?? 0),
          raanDeg: Number(entry.raanDeg ?? 0),
          argPerigeeDeg: Number(entry.argPerigeeDeg ?? 0),
          meanAnomalyDeg: Number(entry.meanAnomalyDeg ?? 0),
        },
      } satisfies ManualSatelliteEntry;
    }
    if (type === "formation") {
      return parseFormation(entry);
    }
    return createDefaultManualEntry();
  });
  return { entries };
}

export function serializeSatelliteEditorConfig(config: SatelliteEditorConfig): string {
  const lines: string[] = [];
  for (const entry of config.entries) {
    lines.push("[[satellites]]");
    if (entry.kind === "manual" && entry.type === "tle") {
      lines.push('type = "tle"');
      if (entry.name) lines.push(`name = ${JSON.stringify(entry.name)}`);
      if (entry.meta?.objectId) lines.push(`objectId = ${JSON.stringify(entry.meta.objectId)}`);
      if (entry.meta?.noradCatId !== undefined) lines.push(`noradCatId = ${entry.meta.noradCatId}`);
      lines.push(`line1 = ${JSON.stringify(entry.tle?.line1 ?? "")}`);
      lines.push(`line2 = ${JSON.stringify(entry.tle?.line2 ?? "")}`);
    } else if (entry.kind === "manual" && entry.type === "elements") {
      const elements = entry.elements ?? createDefaultManualEntry().elements!;
      lines.push('type = "elements"');
      if (entry.name) lines.push(`name = ${JSON.stringify(entry.name)}`);
      if (entry.meta?.objectId) lines.push(`objectId = ${JSON.stringify(entry.meta.objectId)}`);
      if (entry.meta?.noradCatId !== undefined) lines.push(`noradCatId = ${entry.meta.noradCatId}`);
      lines.push(`satnum = ${elements.satnum}`);
      lines.push(`epoch = ${formatTomlDate(elements.epoch)}`);
      lines.push(`semiMajorAxisKm = ${formatNumber(elements.semiMajorAxisKm, 3)}`);
      lines.push(`eccentricity = ${formatNumber(elements.eccentricity, 6)}`);
      lines.push(`inclinationDeg = ${formatNumber(elements.inclinationDeg, 4)}`);
      lines.push(`raanDeg = ${formatNumber(elements.raanDeg, 4)}`);
      lines.push(`argPerigeeDeg = ${formatNumber(elements.argPerigeeDeg, 4)}`);
      lines.push(`meanAnomalyDeg = ${formatNumber(elements.meanAnomalyDeg, 4)}`);
    } else if (entry.kind === "formation") {
      serializeCommonFormation(lines, entry);
      switch (entry.formationMode) {
        case "custom":
          lines.push(`deputyCount = ${entry.deputyCount}`);
          lines.push(`relativeModel = ${JSON.stringify(entry.relativeModel)}`);
          lines.push(`deltaAkm = ${formatNumber(entry.roe.deltaAkm, 6)}`);
          lines.push(`deltaLambdaDeg = ${formatNumber(entry.roe.deltaLambdaDeg, 6)}`);
          lines.push(`deltaEx = ${formatNumber(entry.roe.deltaEx, 8)}`);
          lines.push(`deltaEy = ${formatNumber(entry.roe.deltaEy, 8)}`);
          lines.push(`deltaIxDeg = ${formatNumber(entry.roe.deltaIxDeg, 6)}`);
          lines.push(`deltaIyDeg = ${formatNumber(entry.roe.deltaIyDeg, 6)}`);
          lines.push(`radialKm = ${formatNumber(entry.relativeState.radialKm, 6)}`);
          lines.push(`alongTrackKm = ${formatNumber(entry.relativeState.alongTrackKm, 6)}`);
          lines.push(`crossTrackKm = ${formatNumber(entry.relativeState.crossTrackKm, 6)}`);
          lines.push(`phaseOffsetDeg = ${formatNumber(entry.relativeState.phaseOffsetDeg, 6)}`);
          break;
        case "alongTrack":
          lines.push(`deputyCount = ${entry.deputyCount}`);
          lines.push(`spacingKm = ${formatNumber(entry.spacingKm, 3)}`);
          lines.push(`arrangement = ${JSON.stringify(entry.arrangement)}`);
          lines.push(`direction = ${JSON.stringify(entry.direction)}`);
          break;
        case "nmc":
          lines.push(`sizeKm = ${formatNumber(entry.sizeKm, 3)}`);
          lines.push(`orientationDeg = ${formatNumber(entry.orientationDeg, 3)}`);
          lines.push(`equidistant = ${entry.equidistant}`);
          lines.push(`crossTrackSign = ${JSON.stringify(entry.crossTrackSign)}`);
          lines.push(`crossTrackOffsetKm = ${formatNumber(entry.crossTrackOffsetKm, 3)}`);
          lines.push(`phaseOffsetDeg = ${formatNumber(entry.phaseOffsetDeg, 3)}`);
          break;
        case "crossTrackPendulum":
          lines.push(`amplitudeKm = ${formatNumber(entry.amplitudeKm, 3)}`);
          lines.push(`phaseOffsetDeg = ${formatNumber(entry.phaseOffsetDeg, 3)}`);
          lines.push(`side = ${JSON.stringify(entry.side)}`);
          break;
        case "helix":
          lines.push(`deputyCount = ${entry.deputyCount}`);
          lines.push(`radiusKm = ${formatNumber(entry.radiusKm, 3)}`);
          lines.push(`pitchKm = ${formatNumber(entry.pitchKm, 3)}`);
          lines.push(`turnDirection = ${JSON.stringify(entry.turnDirection)}`);
          lines.push(`phaseOffsetDeg = ${formatNumber(entry.phaseOffsetDeg, 3)}`);
          break;
        case "gco":
          lines.push(`deputyCount = ${entry.deputyCount}`);
          lines.push(`radiusKm = ${formatNumber(entry.radiusKm, 3)}`);
          lines.push(`phaseOffsetDeg = ${formatNumber(entry.phaseOffsetDeg, 3)}`);
          lines.push(`rotationDirection = ${JSON.stringify(entry.rotationDirection)}`);
          break;
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function validateSatelliteEditorConfig(config: SatelliteEditorConfig): SatelliteEditorValidationResult {
  const errors: SatelliteEditorValidationError[] = [];
  const manualElements = new Map<number, ManualSatelliteEntry>();
  const usedSatnums = new Set<number>();
  config.entries.forEach((entry) => {
    if (entry.kind === "manual" && entry.type === "elements" && entry.elements) {
      manualElements.set(entry.elements.satnum, entry);
    }
  });

  config.entries.forEach((entry, index) => {
    if (entry.kind === "manual") {
      if (entry.type === "tle") {
        if (!entry.tle?.line1 || !entry.tle?.line2) errors.push({ field: `entry.${index}.tle`, message: "TLE 2行が必要です" });
      } else {
        const el = entry.elements;
        if (!el) {
          errors.push({ field: `entry.${index}.elements`, message: "軌道要素が必要です" });
          return;
        }
        if (usedSatnums.has(el.satnum)) errors.push({ field: `entry.${index}.elements.satnum`, message: "satnum が重複しています" });
        usedSatnums.add(el.satnum);
        if (!(el.epoch instanceof Date) || Number.isNaN(el.epoch.getTime())) errors.push({ field: `entry.${index}.elements.epoch`, message: "epoch が不正です" });
        if (!Number.isFinite(el.semiMajorAxisKm) || el.semiMajorAxisKm <= 0) errors.push({ field: `entry.${index}.elements.semiMajorAxisKm`, message: "semiMajorAxisKm は正の値が必要です" });
        if (!Number.isFinite(el.eccentricity) || el.eccentricity < 0 || el.eccentricity >= 1) errors.push({ field: `entry.${index}.elements.eccentricity`, message: "離心率は 0 以上 1 未満が必要です" });
      }
      return;
    }

    if (!entry.name.trim()) errors.push({ field: `entry.${index}.name`, message: "編隊名は必須です" });
    const chief = manualElements.get(entry.chiefSatnum);
    if (!chief) errors.push({ field: `entry.${index}.chiefSatnum`, message: "chiefSatnum に対応する単独衛星がありません" });
    else if (chief.type !== "elements" || !chief.elements) errors.push({ field: `entry.${index}.chiefSatnum`, message: "chief には軌道要素型の衛星のみ使用できます" });
    else if (chief.elements.eccentricity > NEAR_CIRCULAR_ECC_MAX) errors.push({ field: `entry.${index}.chiefSatnum`, message: "chief は near-circular 前提のため離心率 0.02 以下が必要です" });

    switch (entry.formationMode) {
      case "custom":
        if (entry.deputyCount < 1 || !Number.isInteger(entry.deputyCount)) errors.push({ field: `entry.${index}.deputyCount`, message: "deputyCount は 1 以上の整数が必要です" });
        break;
      case "alongTrack":
      case "helix":
      case "gco":
        if (entry.deputyCount < 2 || !Number.isInteger(entry.deputyCount)) errors.push({ field: `entry.${index}.deputyCount`, message: "この編隊は 2 機以上の deputy が必要です" });
        break;
      case "nmc":
      case "crossTrackPendulum":
        break;
    }
  });
  return { isValid: errors.length === 0, errors };
}

function nmcCrossTrack(entry: NmcFormationEntry): number {
  const sign = entry.crossTrackSign === "north" ? 1 : -1;
  return sign * (entry.equidistant ? entry.sizeKm * SQRT3 : entry.crossTrackOffsetKm);
}

export function relativeStateForFormation(chief: OrbitalElements, entry: FormationSatelliteEntry, deputyIndex: number): SatelliteEditorRelativeState {
  switch (entry.formationMode) {
    case "custom":
      return entry.relativeModel === "relativeState" ? entry.relativeState : roeToRelativeState(chief, entry.roe);
    case "alongTrack": {
      const offsets = centeredOffsets(entry.deputyCount);
      const signedSpacing = entry.direction === "prograde" ? 1 : -1;
      return {
        radialKm: 0,
        alongTrackKm: offsets[deputyIndex]! * entry.spacingKm * signedSpacing,
        crossTrackKm: 0,
        phaseOffsetDeg: 0,
      };
    }
    case "nmc": {
      const phase = degToRad(entry.phaseOffsetDeg + entry.orientationDeg);
      return {
        radialKm: entry.sizeKm * Math.cos(phase),
        alongTrackKm: 2 * entry.sizeKm * Math.sin(phase),
        crossTrackKm: nmcCrossTrack(entry),
        phaseOffsetDeg: entry.phaseOffsetDeg,
      };
    }
    case "crossTrackPendulum": {
      const sign = entry.side === "north" ? 1 : -1;
      return {
        radialKm: 0,
        alongTrackKm: 0,
        crossTrackKm: sign * entry.amplitudeKm,
        phaseOffsetDeg: entry.phaseOffsetDeg,
      };
    }
    case "helix": {
      const basePhase = entry.phaseOffsetDeg + (360 / entry.deputyCount) * deputyIndex;
      const theta = degToRad(basePhase);
      const pitchSign = entry.turnDirection === "prograde" ? 1 : -1;
      return {
        radialKm: entry.radiusKm * Math.cos(theta),
        alongTrackKm: pitchSign * deputyIndex * entry.pitchKm,
        crossTrackKm: entry.radiusKm * Math.sin(theta),
        phaseOffsetDeg: basePhase,
      };
    }
    case "gco": {
      const basePhase = entry.phaseOffsetDeg + (360 / entry.deputyCount) * deputyIndex;
      const theta = degToRad(basePhase);
      const rotationSign = entry.rotationDirection === "prograde" ? 1 : -1;
      const sinTheta = Math.sin(theta) * rotationSign;
      const cosTheta = Math.cos(theta);
      return {
        // General circular / record-disk orbit:
        // radial : along-track : cross-track amplitude = 1/2 : 1 : sqrt(3)/2
        // which keeps ||r_rel|| ~= radiusKm and enforces z = sqrt(3) x.
        radialKm: 0.5 * entry.radiusKm * sinTheta,
        alongTrackKm: entry.radiusKm * cosTheta,
        crossTrackKm: 0.5 * SQRT3 * entry.radiusKm * sinTheta,
        phaseOffsetDeg: basePhase,
      };
    }
  }
}

function canonicalRoeForFormation(chief: OrbitalElements, entry: FormationSatelliteEntry, deputyIndex: number): SatelliteEditorRoe {
  if (entry.formationMode === "custom" && entry.relativeModel === "roe") {
    return entry.roe;
  }
  return relativeStateToRoe(chief, relativeStateForFormation(chief, entry, deputyIndex));
}

function deputyCountForFormation(entry: FormationSatelliteEntry): number {
  switch (entry.formationMode) {
    case "custom":
    case "alongTrack":
    case "helix":
    case "gco":
      return entry.deputyCount;
    case "nmc":
    case "crossTrackPendulum":
      return 1;
  }
}

function gcoRelativeVelocity(chief: OrbitalElements, entry: GcoFormationEntry, deputyIndex: number): Vec3 {
  const basePhase = entry.phaseOffsetDeg + (360 / entry.deputyCount) * deputyIndex;
  const theta = degToRad(basePhase);
  const phaseRate = Math.sqrt(EARTH_MU_KM3_S2 / Math.max(chief.semiMajorAxisKm, 1) ** 3);
  const direction = entry.rotationDirection === "prograde" ? 1 : -1;
  return {
    x: 0.5 * entry.radiusKm * Math.cos(theta) * phaseRate * direction,
    y: -entry.radiusKm * Math.sin(theta) * phaseRate * direction,
    z: 0.5 * SQRT3 * entry.radiusKm * Math.cos(theta) * phaseRate * direction,
  };
}

export function expandSatelliteEditorConfig(config: SatelliteEditorConfig): SatelliteSpec[] {
  const output: SatelliteSpec[] = [];
  const manualChiefs = new Map<number, ManualSatelliteEntry>();
  config.entries.forEach((entry) => {
    if (entry.kind === "manual" && entry.type === "elements" && entry.elements) manualChiefs.set(entry.elements.satnum, entry);
  });
  let nextSatnum = Math.max(
    MANUAL_SATNUM_MIN,
    ...config.entries
      .filter((entry): entry is ManualSatelliteEntry => entry.kind === "manual" && entry.type === "elements" && !!entry.elements)
      .map((entry) => entry.elements!.satnum + 1),
  );

  for (const entry of config.entries) {
    if (entry.kind === "manual") {
      if (entry.type === "tle" && entry.tle) output.push({ type: "tle", lines: [entry.tle.line1, entry.tle.line2], meta: cloneMeta(entry.meta) });
      else if (entry.type === "elements" && entry.elements) output.push({ type: "elements", elements: entry.elements, meta: cloneMeta(entry.meta) });
      continue;
    }
    const chiefEntry = manualChiefs.get(entry.chiefSatnum);
    if (!chiefEntry) continue;
    const chief = getChiefElements(chiefEntry);
    if (!chief) continue;
    const chiefName = getChiefDisplayName(chiefEntry);
    const count = deputyCountForFormation(entry);
    for (let deputyIndex = 0; deputyIndex < count; deputyIndex += 1) {
      const satnum = Math.min(nextSatnum, MANUAL_SATNUM_MAX);
      nextSatnum += 1;
      const deputyName = `${entry.name || chiefName}-${deputyIndex + 1}`;
      if (entry.formationMode === "gco") {
        const relativeState = relativeStateForFormation(chief, entry, deputyIndex);
        output.push({
          type: "elements",
          elements: buildDeputyElementsFromHillState(chief, relativeState, gcoRelativeVelocity(chief, entry, deputyIndex), satnum, entry.epoch),
          meta: {
            objectName: deputyName,
            noradCatId: satnum,
          },
        });
        continue;
      }
      const roe = canonicalRoeForFormation(chief, entry, deputyIndex);
      addDeputy(output, chief, deputyName, satnum, roe, entry.epoch);
    }
  }
  return output;
}

export function syncFormationRepresentations(config: SatelliteEditorConfig): SatelliteEditorConfig {
  const chiefs = new Map<number, OrbitalElements>();
  for (const entry of config.entries) {
    if (entry.kind === "manual" && entry.type === "elements" && entry.elements) chiefs.set(entry.elements.satnum, entry.elements);
  }
  return {
    entries: config.entries.map((entry) => {
      if (entry.kind !== "formation" || entry.formationMode !== "custom") return entry;
      const chief = chiefs.get(entry.chiefSatnum);
      if (!chief) return entry;
      if (entry.relativeModel === "roe") {
        return { ...entry, relativeState: roeToRelativeState(chief, entry.roe) };
      }
      return { ...entry, roe: relativeStateToRoe(chief, entry.relativeState) };
    }),
  };
}

export function getChiefOptions(config: SatelliteEditorConfig): ManualSatelliteEntry[] {
  return config.entries.filter((entry): entry is ManualSatelliteEntry => entry.kind === "manual" && entry.type === "elements" && !!entry.elements);
}
