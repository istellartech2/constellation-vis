import type { OrbitalElements, SatelliteMetadata, SatelliteSpec } from "./satellites";
import {
  createDefaultManualEntry,
  DEFAULT_RELATIVE_STATE,
  DEFAULT_ROE,
  type FormationPreset,
  type FormationRelativeModel,
  type FormationSatelliteEntry,
  type ManualSatelliteEntry,
  type SatelliteEditorConfig,
  type SatelliteEditorEntry,
  type SatelliteEditorMetadata,
  type SatelliteEditorRelativeState,
  type SatelliteEditorRoe,
} from "./satelliteEditorTypes";

const MANUAL_SATNUM_MIN = 90000;
const MANUAL_SATNUM_MAX = 99999;
const NEAR_CIRCULAR_ECC_MAX = 0.02;

export interface SatelliteEditorValidationError {
  field: string;
  message: string;
}

export interface SatelliteEditorValidationResult {
  isValid: boolean;
  errors: SatelliteEditorValidationError[];
}

type TomlRecord = Record<string, string | number | Date>;

function parseValue(raw: string): string | number | Date {
  const s = raw.trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
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
    if (!current) {
      current = { [key]: value };
    } else {
      current[key] = value;
    }
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

function relativeStateToRoe(
  chief: OrbitalElements,
  relativeState: SatelliteEditorRelativeState,
): SatelliteEditorRoe {
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

function buildDeputyElements(
  chief: OrbitalElements,
  roe: SatelliteEditorRoe,
  satnum: number,
  epoch?: Date,
): OrbitalElements {
  const chiefEx = chief.eccentricity * Math.cos(degToRad(chief.argPerigeeDeg));
  const chiefEy = chief.eccentricity * Math.sin(degToRad(chief.argPerigeeDeg));
  const deputyEx = chiefEx + roe.deltaEx;
  const deputyEy = chiefEy + roe.deltaEy;
  const deputyEcc = Math.min(0.999, Math.hypot(deputyEx, deputyEy));
  const deputyArgPerigee = deputyEcc > 1e-9 ? normalizeAngleDeg(radToDeg(Math.atan2(deputyEy, deputyEx))) : chief.argPerigeeDeg;

  const deputyMeanAnomaly =
    chief.meanAnomalyDeg + roe.deltaLambdaDeg - roe.deltaEx * 180;

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

function shouldScaleFormationPreset(preset: FormationPreset): boolean {
  return preset !== "custom";
}

function scaleRoe(roe: SatelliteEditorRoe, factor: number): SatelliteEditorRoe {
  return {
    deltaAkm: roe.deltaAkm * factor,
    deltaLambdaDeg: roe.deltaLambdaDeg * factor,
    deltaEx: roe.deltaEx * factor,
    deltaEy: roe.deltaEy * factor,
    deltaIxDeg: roe.deltaIxDeg * factor,
    deltaIyDeg: roe.deltaIyDeg * factor,
  };
}

function scaleRelativeState(
  relativeState: SatelliteEditorRelativeState,
  factor: number,
): SatelliteEditorRelativeState {
  return {
    radialKm: relativeState.radialKm * factor,
    alongTrackKm: relativeState.alongTrackKm * factor,
    crossTrackKm: relativeState.crossTrackKm * factor,
    phaseOffsetDeg: relativeState.phaseOffsetDeg,
  };
}

export function applyFormationPreset(preset: FormationPreset) {
  switch (preset) {
    case "along-track-train":
      return {
        roe: { ...DEFAULT_ROE, deltaLambdaDeg: 0.2 },
        relativeState: { ...DEFAULT_RELATIVE_STATE, radialKm: 0, alongTrackKm: 15, crossTrackKm: 0, phaseOffsetDeg: 0 },
      };
    case "projected-circular":
      return {
        roe: { ...DEFAULT_ROE, deltaEx: 0.0012, deltaIyDeg: 0.08 },
        relativeState: { ...DEFAULT_RELATIVE_STATE, radialKm: 8, alongTrackKm: 0, crossTrackKm: 8, phaseOffsetDeg: 90 },
      };
    case "general-circular-orbit":
      return {
        // GCO is a 3D circular periodic relative orbit with z = sqrt(3) x.
        roe: { ...DEFAULT_ROE, deltaEx: 0.0012, deltaIyDeg: 0.1386 },
        relativeState: { ...DEFAULT_RELATIVE_STATE, radialKm: 8, alongTrackKm: 0, crossTrackKm: 13.856, phaseOffsetDeg: 90 },
      };
    case "in-plane-ellipse":
      return {
        roe: { ...DEFAULT_ROE, deltaEx: 0.0015, deltaLambdaDeg: 0.15 },
        relativeState: { ...DEFAULT_RELATIVE_STATE, radialKm: 10, alongTrackKm: 12, crossTrackKm: 0, phaseOffsetDeg: 0 },
      };
    case "cross-track-only":
      return {
        roe: { ...DEFAULT_ROE, deltaIxDeg: 0.1 },
        relativeState: { ...DEFAULT_RELATIVE_STATE, radialKm: 0, alongTrackKm: 0, crossTrackKm: 12, phaseOffsetDeg: 0 },
      };
    case "custom":
    default:
      return {
        roe: { ...DEFAULT_ROE },
        relativeState: { ...DEFAULT_RELATIVE_STATE, alongTrackKm: 0 },
      };
  }
}

export function getEntryDisplayName(entry: SatelliteEditorEntry, index: number): string {
  if (entry.kind === "manual") {
    const label = entry.meta?.objectName || entry.name;
    if (label) return label;
    if (entry.type === "elements" && entry.elements) return `Satellite ${entry.elements.satnum}`;
    return `TLE ${index + 1}`;
  }
  return entry.name || `Formation ${index + 1}`;
}

export function parseSatelliteEditorConfig(text: string): SatelliteEditorConfig {
  if (!text.trim()) {
    return { entries: [] };
  }

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
        tle: {
          line1: String(entry.line1 ?? ""),
          line2: String(entry.line2 ?? ""),
        },
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
      const chiefSatnum = Number(entry.chiefSatnum ?? 0);
      const preset = String(entry.preset ?? "custom") as FormationPreset;
      return {
        id: crypto.randomUUID(),
        kind: "formation",
        name: String(entry.name ?? "Formation"),
        chiefSatnum,
        deputyCount: Number(entry.deputyCount ?? 1),
        epoch: entry.epoch instanceof Date ? entry.epoch : entry.epoch ? new Date(String(entry.epoch)) : undefined,
        relativeModel: String(entry.relativeModel ?? "roe") as FormationRelativeModel,
        preset,
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
          alongTrackKm: Number(entry.alongTrackKm ?? 10),
          crossTrackKm: Number(entry.crossTrackKm ?? 0),
          phaseOffsetDeg: Number(entry.phaseOffsetDeg ?? 0),
        },
      } satisfies FormationSatelliteEntry;
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
      lines.push('type = "formation"');
      lines.push(`name = ${JSON.stringify(entry.name)}`);
      lines.push(`chiefSatnum = ${entry.chiefSatnum}`);
      lines.push(`deputyCount = ${entry.deputyCount}`);
      if (entry.epoch) lines.push(`epoch = ${formatTomlDate(entry.epoch)}`);
      lines.push(`relativeModel = ${JSON.stringify(entry.relativeModel)}`);
      lines.push(`preset = ${JSON.stringify(entry.preset)}`);
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
        if (!entry.tle?.line1 || !entry.tle?.line2) {
          errors.push({ field: `entry.${index}.tle`, message: "TLE 2行が必要です" });
        }
      } else {
        const el = entry.elements;
        if (!el) {
          errors.push({ field: `entry.${index}.elements`, message: "軌道要素が必要です" });
          return;
        }
        if (usedSatnums.has(el.satnum)) {
          errors.push({ field: `entry.${index}.elements.satnum`, message: "satnum が重複しています" });
        }
        usedSatnums.add(el.satnum);
        if (!(el.epoch instanceof Date) || Number.isNaN(el.epoch.getTime())) {
          errors.push({ field: `entry.${index}.elements.epoch`, message: "epoch が不正です" });
        }
        if (!Number.isFinite(el.semiMajorAxisKm) || el.semiMajorAxisKm <= 0) {
          errors.push({ field: `entry.${index}.elements.semiMajorAxisKm`, message: "semiMajorAxisKm は正の値が必要です" });
        }
        if (!Number.isFinite(el.eccentricity) || el.eccentricity < 0 || el.eccentricity >= 1) {
          errors.push({ field: `entry.${index}.elements.eccentricity`, message: "離心率は 0 以上 1 未満が必要です" });
        }
      }
      return;
    }

    if (!entry.name.trim()) {
      errors.push({ field: `entry.${index}.name`, message: "編隊名は必須です" });
    }
    if (entry.deputyCount < 1 || !Number.isInteger(entry.deputyCount)) {
      errors.push({ field: `entry.${index}.deputyCount`, message: "deputyCount は 1 以上の整数が必要です" });
    }
    const chief = manualElements.get(entry.chiefSatnum);
    if (!chief) {
      errors.push({ field: `entry.${index}.chiefSatnum`, message: "chiefSatnum に対応する単独衛星がありません" });
    } else if (chief.type !== "elements" || !chief.elements) {
      errors.push({ field: `entry.${index}.chiefSatnum`, message: "chief には軌道要素型の衛星のみ使用できます" });
    } else if (chief.elements.eccentricity > NEAR_CIRCULAR_ECC_MAX) {
      errors.push({ field: `entry.${index}.chiefSatnum`, message: "chief は near-circular 前提のため離心率 0.02 以下が必要です" });
    }
    if (entry.relativeModel === "relativeState") {
      const values = Object.values(entry.relativeState);
      if (values.some((value) => !Number.isFinite(value))) {
        errors.push({ field: `entry.${index}.relativeState`, message: "相対距離入力に数値以外が含まれています" });
      }
    } else {
      const values = Object.values(entry.roe);
      if (values.some((value) => !Number.isFinite(value))) {
        errors.push({ field: `entry.${index}.roe`, message: "ROE 入力に数値以外が含まれています" });
      }
    }
  });

  return { isValid: errors.length === 0, errors };
}

export function expandSatelliteEditorConfig(config: SatelliteEditorConfig): SatelliteSpec[] {
  const output: SatelliteSpec[] = [];
  const manualChiefs = new Map<number, ManualSatelliteEntry>();
  config.entries.forEach((entry) => {
    if (entry.kind === "manual" && entry.type === "elements" && entry.elements) {
      manualChiefs.set(entry.elements.satnum, entry);
    }
  });
  let nextSatnum = Math.max(
    MANUAL_SATNUM_MIN,
    ...config.entries
      .filter((entry): entry is ManualSatelliteEntry => entry.kind === "manual" && entry.type === "elements" && !!entry.elements)
      .map((entry) => entry.elements!.satnum + 1),
  );

  for (const entry of config.entries) {
    if (entry.kind === "manual") {
      if (entry.type === "tle" && entry.tle) {
        output.push({
          type: "tle",
          lines: [entry.tle.line1, entry.tle.line2],
          meta: cloneMeta(entry.meta),
        });
        continue;
      }
      if (entry.type === "elements" && entry.elements) {
        output.push({
          type: "elements",
          elements: entry.elements,
          meta: cloneMeta(entry.meta),
        });
      }
      continue;
    }

    const chiefEntry = manualChiefs.get(entry.chiefSatnum);
    const chief = chiefEntry ? getChiefElements(chiefEntry) : null;
    if (!chief || !chiefEntry) continue;
    const chiefName = getChiefDisplayName(chiefEntry);

    const canonicalRoeBase =
      entry.relativeModel === "roe" ? entry.roe : relativeStateToRoe(chief, entry.relativeState);

    for (let deputyIndex = 0; deputyIndex < entry.deputyCount; deputyIndex += 1) {
      const factor = shouldScaleFormationPreset(entry.preset) ? deputyIndex + 1 : 1;
      const scaledRoe =
        entry.relativeModel === "roe"
          ? scaleRoe(canonicalRoeBase, factor)
          : relativeStateToRoe(chief, scaleRelativeState(entry.relativeState, factor));
      const satnum = Math.min(nextSatnum, MANUAL_SATNUM_MAX);
      nextSatnum += 1;
      const elements = buildDeputyElements(
        chief,
        scaledRoe,
        satnum,
        entry.epoch,
      );
      output.push({
        type: "elements",
        elements,
        meta: {
          objectName: entry.name
            ? `${entry.name}-${deputyIndex + 1}`
            : `${chiefName}-${deputyIndex + 1}`,
          noradCatId: satnum,
        },
      });
    }
  }

  return output;
}

export function syncFormationRepresentations(config: SatelliteEditorConfig): SatelliteEditorConfig {
  const chiefs = new Map<number, OrbitalElements>();
  for (const entry of config.entries) {
    if (entry.kind === "manual" && entry.type === "elements" && entry.elements) {
      chiefs.set(entry.elements.satnum, entry.elements);
    }
  }

  return {
    entries: config.entries.map((entry) => {
      if (entry.kind !== "formation") return entry;
      const chief = chiefs.get(entry.chiefSatnum);
      if (!chief) return entry;
      if (entry.relativeModel === "roe") {
        return {
          ...entry,
          relativeState: roeToRelativeState(chief, entry.roe),
        };
      }
      return {
        ...entry,
        roe: relativeStateToRoe(chief, entry.relativeState),
      };
    }),
  };
}

export function getChiefOptions(config: SatelliteEditorConfig): ManualSatelliteEntry[] {
  return config.entries.filter(
    (entry): entry is ManualSatelliteEntry =>
      entry.kind === "manual" && entry.type === "elements" && !!entry.elements,
  );
}
