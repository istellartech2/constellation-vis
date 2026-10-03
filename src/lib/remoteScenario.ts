import { parse, stringify } from "smol-toml";
import { parseTomlValue } from "./tomlParsers";
import { buildConstellation, parseSatellitesToml, parseGroundStationsToml } from "./tomlParsers";
import { parseSatelliteEditorConfig, validateSatelliteEditorConfig } from "./satelliteEditorSerializer";
import { parseConstellationConfig, validateConfig, isBlockingError } from "./constellationSerializer";
import { toSatrec } from "./satellites";
import { isPatternId } from "./constellationPatterns/types";
import { socDesign } from "./constellationPatterns/streetsOfCoverage";
import { resolvePattern } from "./constellationPatterns/registry";
import { validateGroundStations } from "./groundStationSerializer";
import type { CommittedScenario } from "./scenario";

export const MAX_SCENARIO_BYTES = 256 * 1024;
export const MAX_SATELLITES = 2000;
export interface RemoteScenario {
  satText: string;
  constText: string;
  gsText: string;
  startTime: string;
}
export type ScenarioSection = "satellites" | "constellation" | "groundstations";
export type ScenarioOperation =
  | { type: "replace"; scenario: RemoteScenario }
  | { type: "bundle"; text: string }
  | { type: "append"; section: ScenarioSection; text: string }
  | { type: "remove"; section: ScenarioSection; index: number }
  | { type: "clear"; section?: ScenarioSection };
export const SECTION_FIELDS = { satellites: "satText", constellation: "constText", groundstations: "gsText" } as const;

export function emptyScenario(): RemoteScenario {
  return { satText: "", constText: "", gsText: "", startTime: new Date().toISOString() };
}

function document(text: string, section: ScenarioSection) {
  const doc = parse(text);
  const keys = Object.keys(doc);
  if (keys.some((key) => key !== section)) throw new Error(`Unexpected table in ${section}`);
  const rows = section === "constellation" ? (doc.constellation as { shells?: unknown } | undefined)?.shells : doc[section];
  if (rows !== undefined && (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row)))) throw new Error(`${section} requires array-table entries`);
  if (section === "constellation" && Array.isArray(rows)) {
    for (const row of rows) if (row.pattern !== undefined && !isPatternId(row.pattern)) throw new Error("Unknown constellation pattern");
  }
  return doc;
}

/** Strict envelope and domain validation before expanding any satellite arrays. */
export function commitRemoteScenario(value: unknown): CommittedScenario {
  if (!value || typeof value !== "object") throw new Error("scenario must be an object");
  const s = value as RemoteScenario;
  if ([s.satText, s.constText, s.gsText, s.startTime].some((v) => typeof v !== "string")) {
    throw new Error("scenario requires satText, constText, gsText and startTime strings");
  }
  if (new TextEncoder().encode(JSON.stringify(s)).length > MAX_SCENARIO_BYTES) throw new Error("Scenario exceeds 256 KiB");
  if (!s.startTime.endsWith("Z") || !Number.isFinite(new Date(s.startTime).getTime())) throw new Error("startTime must be an ISO UTC timestamp ending in Z");
  for (const section of Object.keys(SECTION_FIELDS) as ScenarioSection[]) document(s[SECTION_FIELDS[section]], section);
  const manual = parseSatelliteEditorConfig(s.satText);
  const manualErrors = validateSatelliteEditorConfig(manual).errors;
  if (manualErrors.length) throw new Error(manualErrors[0].message);
  let count = manual.entries.reduce((total, entry) => total + (entry.kind === "manual" ? 1 : ("deputyCount" in entry ? entry.deputyCount : 1)), 0);
  const constellation = s.constText.trim() ? parseConstellationConfig(s.constText) : null;
  if (constellation) {
    if (!Number.isFinite(constellation.epoch.getTime())) throw new Error("Invalid constellation epoch");
    // Bound inputs before pattern validation/derivation, which may allocate planes.
    for (const shell of constellation.shells) {
      for (const [key, v] of Object.entries(shell)) {
        if (typeof v === "number" && (!Number.isFinite(v) || ((/count|planes|lfc_nc|nec_pearls|flower_(np|nd|fd)|soc_coverage_fold|soc_sats_per_plane/.test(key)) && Math.abs(v) > MAX_SATELLITES))) {
          throw new Error(`Invalid or excessive shell field: ${key}`);
        }
      }
    }
    for (const shell of constellation.shells) {
      if (shell.pattern === "streets_of_coverage") {
        const design = socDesign(shell);
        if (design.feasible && design.count > MAX_SATELLITES) throw new Error(`Maximum ${MAX_SATELLITES} satellites per session`);
      }
    }
    const errors = validateConfig(constellation).errors.filter(isBlockingError);
    if (errors.length) throw new Error(errors[0].message);
    for (const shell of constellation.shells) count += resolvePattern(shell).derive(shell).totalSats;
  }
  if (!Number.isFinite(count) || count > MAX_SATELLITES) throw new Error(`Maximum ${MAX_SATELLITES} satellites per session`);
  const satellites = parseSatellitesToml(s.satText);
  const generated = s.constText.trim() ? buildConstellation(s.constText, satellites.length) : { satellites: [], ranges: [] };
  for (const spec of [...satellites, ...generated.satellites]) {
    if (spec.type === "elements") {
      const el = spec.elements;
      if (!Number.isFinite(el.epoch.getTime()) || Object.entries(el).some(([key, v]) => key !== "epoch" && typeof v === "number" && !Number.isFinite(v))) throw new Error("Invalid orbital elements");
      if (el.inclinationDeg < 0 || el.inclinationDeg > 180) throw new Error("Inclination must be 0–180 degrees");
    }
    const rec = toSatrec(spec);
    if (rec.error || !Number.isFinite(rec.no) || rec.no <= 0 || !Number.isFinite(rec.ecco) || rec.ecco < 0 || rec.ecco >= 1) throw new Error("Invalid satellite orbit or TLE");
  }
  const groundStations = parseGroundStationsToml(s.gsText);
  if (groundStations.length > 500) throw new Error("Maximum 500 ground stations");
  const groundErrors = validateGroundStations(groundStations.map((g, i) => ({ ...g, id: String(i) })));
  if (groundErrors.length) throw new Error(groundErrors[0].message);
  return { satellites: [...satellites, ...generated.satellites], groundStations, startTime: new Date(s.startTime), islShellRanges: generated.ranges };
}

export function applyScenarioOperation(current: RemoteScenario, value: unknown): RemoteScenario {
  if (!value || typeof value !== "object") throw new Error("operation must be an object");
  const operation = value as ScenarioOperation;
  let next = { ...current };
  if (operation.type === "replace") next = operation.scenario;
  else if (operation.type === "bundle") {
    if (typeof operation.text !== "string") throw new Error("text is required");
    if (new TextEncoder().encode(operation.text).length > MAX_SCENARIO_BYTES) throw new Error("Bundle exceeds 256 KiB");
    const sections = { satellites: [] as string[], constellation: [] as string[], groundstations: [] as string[] };
    let section: ScenarioSection | null = null;
    let startTime = current.startTime;
    for (const line of operation.text.split(/\r?\n/)) {
      const marker = line.trim().match(/^# ===\s*(satellites|constellation|groundstations)\s*===\s*$/i);
      if (marker) { section = marker[1].toLowerCase() as ScenarioSection; continue; }
      if (/^startTime\s*=/.test(line.trim())) {
        const parsed = parseTomlValue(line.slice(line.indexOf("=") + 1));
        startTime = parsed instanceof Date ? parsed.toISOString() : String(parsed);
        section = null;
      } else if (section) sections[section].push(line);
      else if (line.trim() && !line.trim().startsWith("#")) throw new Error("Use the application's settings.toml bundle format");
    }
    next = { satText: sections.satellites.join("\n"), constText: sections.constellation.join("\n"), gsText: sections.groundstations.join("\n"), startTime };
  } else if (operation.type === "clear" && operation.section === undefined) {
    next = { ...next, satText: "", constText: "", gsText: "" };
  } else {
    if (!("section" in operation) || !operation.section || !Object.hasOwn(SECTION_FIELDS, operation.section)) throw new Error("Invalid section");
    const field = SECTION_FIELDS[operation.section];
    if (operation.type === "clear") next[field] = "";
    else if (operation.type === "append") {
      if (typeof operation.text !== "string") throw new Error("text is required");
      const added = document(operation.text, operation.section);
      const doc = document(next[field], operation.section);
      if (operation.section === "constellation") {
        const existing = (doc.constellation ?? {}) as { shells?: unknown[]; epoch?: unknown };
        const extra = added.constellation as { shells?: unknown[]; epoch?: unknown } | undefined;
        if (!extra?.shells?.length) throw new Error("append requires constellation.shells");
        if (existing.epoch !== undefined && extra.epoch !== undefined && String(existing.epoch) !== String(extra.epoch)) throw new Error("Constellation epochs must match");
        doc.constellation = { ...extra, ...existing, shells: [...(existing.shells ?? []), ...extra.shells] } as typeof doc.constellation;
      } else {
        const rows = added[operation.section];
        if (!Array.isArray(rows) || !rows.length) throw new Error("append requires array table entries");
        doc[operation.section] = [...((doc[operation.section] as unknown[]) ?? []), ...rows] as typeof rows;
      }
      next[field] = stringify(doc);
    } else if (operation.type === "remove") {
      const doc = document(next[field], operation.section);
      const rows = operation.section === "constellation" ? (doc.constellation as { shells?: unknown[] } | undefined)?.shells : doc[operation.section];
      if (!Array.isArray(rows) || !Number.isInteger(operation.index) || operation.index < 0 || operation.index >= rows.length) throw new Error("Entry index does not exist");
      rows.splice(operation.index, 1);
      next[field] = rows.length ? stringify(doc) : "";
    } else throw new Error("Unknown operation type");
  }
  commitRemoteScenario(next);
  return { satText: next.satText, constText: next.constText, gsText: next.gsText, startTime: next.startTime };
}
