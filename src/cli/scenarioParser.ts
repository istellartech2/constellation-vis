import { readFile } from "node:fs/promises";
import {
  parseConstellationToml,
  parseSatellitesToml,
} from "../lib/tomlParsers";
import type { AnalysisSatellite, LinkDutyAnalysisInput } from "../lib/linkDutyAnalysis";
import type { GroundTerminal, LinkKind } from "../lib/linkGeometry";
import type { VisibilityMode } from "../lib/groundStations";

type TomlValue = string | number | boolean;
type TomlRecord = Record<string, TomlValue>;

export interface ParsedScenario extends LinkDutyAnalysisInput {
  sourcePath: string;
}

function stripComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === '"' || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (character === "#" && quote === null) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}

function parseValue(raw: string): TomlValue {
  const value = stripComment(raw);
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseNamedTable(text: string, tableName: string): TomlRecord {
  const result: TomlRecord = {};
  let active = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      active = line === `[${tableName}]`;
      continue;
    }
    if (!active) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (match) result[match[1]] = parseValue(match[2]);
  }
  return result;
}

function parseArrayTable(text: string, tableName: string): TomlRecord[] {
  const result: TomlRecord[] = [];
  let current: TomlRecord | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[[")) {
      if (current) result.push(current);
      current = line === `[[${tableName}]]` ? {} : null;
      continue;
    }
    if (line.startsWith("[")) {
      if (current) result.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (match) current[match[1]] = parseValue(match[2]);
  }
  if (current) result.push(current);
  return result;
}

function extractArrayTableText(text: string, tableName: string): string {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[[")) {
      if (current) blocks.push(current.join("\n"));
      current = line === `[[${tableName}]]` ? [rawLine] : null;
      continue;
    }
    if (line.startsWith("[") && current) {
      blocks.push(current.join("\n"));
      current = null;
      continue;
    }
    if (current) current.push(rawLine);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks.join("\n\n");
}

function extractConstellationText(text: string): string {
  const lines: string[] = [];
  let active = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      active = line === "[constellation]" || line === "[[constellation.shells]]";
    }
    if (active) lines.push(rawLine);
  }
  return lines.join("\n");
}

function requiredNumber(record: TomlRecord, key: string, context: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value)) throw new Error(`${context}.${key} must be a finite number`);
  return value;
}

function optionalPositiveNumber(record: TomlRecord, key: string, context: string): number | undefined {
  if (record[key] === undefined) return undefined;
  const value = requiredNumber(record, key, context);
  if (value <= 0) throw new Error(`${context}.${key} must be greater than zero`);
  return value;
}

function parseVisibilityMode(value: TomlValue | undefined): VisibilityMode | undefined {
  if (value === undefined) return undefined;
  if (value === "elevation_only" || value === "off_nadir_only" || value === "and") return value;
  throw new Error(`visibilityMode must be elevation_only, off_nadir_only, or and`);
}

function parseKind(value: TomlValue | undefined, context: string): LinkKind {
  if (value === "service" || value === "feeder") return value;
  throw new Error(`${context}.kind must be service or feeder`);
}

function buildTerminals(records: TomlRecord[]): GroundTerminal[] {
  const ids = new Set<string>();
  return records.map((record, index) => {
    const context = `groundstations[${index}]`;
    const id = String(record.id ?? record.name ?? `terminal-${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate ground terminal id: ${id}`);
    ids.add(id);
    const latitudeDeg = requiredNumber(record, "latitudeDeg", context);
    const longitudeDeg = requiredNumber(record, "longitudeDeg", context);
    if (latitudeDeg < -90 || latitudeDeg > 90) throw new Error(`${context}.latitudeDeg must be -90..90`);
    if (longitudeDeg < -180 || longitudeDeg > 180) throw new Error(`${context}.longitudeDeg must be -180..180`);
    return {
      id,
      name: String(record.name ?? id),
      kind: parseKind(record.kind, context),
      latitudeDeg,
      longitudeDeg,
      heightKm: Number(record.heightKm ?? 0),
      minElevationDeg: Number(record.minElevationDeg ?? 0),
      visibilityMode: parseVisibilityMode(record.visibilityMode),
      maxOffNadirDeg: record.maxOffNadirDeg === undefined
        ? undefined
        : requiredNumber(record, "maxOffNadirDeg", context),
      uplinkFrequencyHz: optionalPositiveNumber(record, "uplinkFrequencyHz", context),
      downlinkFrequencyHz: optionalPositiveNumber(record, "downlinkFrequencyHz", context),
    };
  });
}

function satelliteLabel(spec: AnalysisSatellite["spec"], index: number): string {
  return spec.meta?.objectName ??
    (spec.type === "elements" ? `SAT-${spec.elements.satnum}` : `SAT-${index + 1}`);
}

function buildSatellites(text: string): AnalysisSatellite[] {
  const satelliteText = extractArrayTableText(text, "satellites");
  const satelliteRecords = parseArrayTable(text, "satellites");
  const base = satelliteText.trim() ? parseSatellitesToml(satelliteText) : [];
  const constellationText = extractConstellationText(text);
  const generated = constellationText.includes("[[constellation.shells]]")
    ? parseConstellationToml(constellationText)
    : [];
  const ids = new Set<string>();
  return [...base, ...generated].map((spec, index) => {
    const record = index < base.length ? satelliteRecords[index] : undefined;
    const label = satelliteLabel(spec, index);
    let id = String(record?.id ?? label ?? `satellite-${index + 1}`);
    if (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    return { id, label, spec };
  });
}

export function parseScenarioToml(text: string, sourcePath = "<memory>"): ParsedScenario {
  const analysis = parseNamedTable(text, "analysis");
  const startTime = new Date(String(analysis.startTime ?? ""));
  if (Number.isNaN(startTime.getTime())) throw new Error("analysis.startTime must be a valid UTC timestamp");
  const durationHours = Number(analysis.durationHours ?? 24);
  const stepSeconds = Number(analysis.stepSeconds ?? 10);
  const eventToleranceSeconds = Number(analysis.eventToleranceSeconds ?? 0.1);
  if (!Number.isFinite(durationHours) || durationHours <= 0) throw new Error("analysis.durationHours must be greater than zero");
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new Error("analysis.stepSeconds must be greater than zero");
  if (!Number.isFinite(eventToleranceSeconds) || eventToleranceSeconds <= 0 || eventToleranceSeconds > stepSeconds) {
    throw new Error("analysis.eventToleranceSeconds must be greater than zero and no larger than stepSeconds");
  }
  const satellites = buildSatellites(text);
  const terminals = buildTerminals(parseArrayTable(text, "groundstations"));
  if (satellites.length === 0) throw new Error("At least one satellite or constellation shell is required");
  if (terminals.length === 0) throw new Error("At least one ground station is required");
  if (!terminals.some((terminal) => terminal.kind === "service")) {
    throw new Error("At least one service ground station is required");
  }
  if (!terminals.some((terminal) => terminal.kind === "feeder")) {
    throw new Error("At least one feeder ground station is required");
  }
  return {
    sourcePath,
    startTime,
    durationHours,
    stepSeconds,
    eventToleranceSeconds,
    satellites,
    terminals,
  };
}

export async function loadScenario(path: string): Promise<ParsedScenario> {
  return parseScenarioToml(await readFile(path, "utf8"), path);
}
