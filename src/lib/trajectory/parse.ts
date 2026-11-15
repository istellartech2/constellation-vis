/**
 * Parsers for tabulated trajectory files (CSV/TSV and CCSDS OEM KVN).
 *
 * Every accepted file is normalised to Earth-fixed (ECEF, km) samples sorted
 * by time. Format details and conventions: docs/trajectory-layer.md.
 * Error and warning strings are Japanese because they are shown in the UI.
 */
import * as satellite from "satellite.js";
import * as THREE from "three";
import { enuAnglesToQuaternion, enuToEcefQuaternion } from "./attitude";
import type {
  AttitudeMode,
  AttitudeRule,
  BodyQuaternion,
  EcefVector,
  TrajectoryEvent,
  TrajectoryParseResult,
  TrajectorySample,
  TrajectorySourceFrame,
  TrajectoryTrack,
} from "./types";

export interface TrajectoryParseOptions {
  /** Epoch for relative (seconds) time columns when the file has no `# epoch:` header. */
  defaultEpochMs?: number;
}

/** Earth rotation rate used for ECI → ECEF velocity conversion (rad/s). */
export const EARTH_ROTATION_RAD_S = 7.292115e-5;

const DEG2RAD = Math.PI / 180;

type ParsedTrack = Omit<TrajectoryTrack, "id" | "color" | "visible">;

class TrajectoryParseError extends Error {}

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------

const CALENDAR_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d*)?))?)?\s*(Z|UTC|[+-]\d{2}(?::?\d{2})?)?$/i;
const DAY_OF_YEAR_RE =
  /^(\d{4})-(\d{3})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d*)?))?)?\s*(Z|UTC|[+-]\d{2}(?::?\d{2})?)?$/i;

function zoneOffsetMs(zone: string | undefined): number {
  if (!zone) return 0;
  const upper = zone.toUpperCase();
  if (upper === "Z" || upper === "UTC") return 0;
  const sign = zone[0] === "-" ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return sign * (hours * 60 + minutes) * 60_000;
}

/**
 * Parse an ISO-8601 / CCSDS timestamp. Strings without a zone designator are
 * UTC (never local time). Accepts calendar (`2026-02-01T12:00:00`) and
 * day-of-year (`2026-032T12:00:00`) forms. Returns NaN when unparseable.
 */
export function parseUtcTimestamp(text: string): number {
  const s = text.trim();
  let m = CALENDAR_RE.exec(s);
  if (m) {
    const [, y, mo, d, hh, mi, ss, zone] = m;
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
    const base = Date.UTC(Number(y), month - 1, day, Number(hh ?? 0), Number(mi ?? 0), 0);
    return base + Number(ss ?? 0) * 1000 - zoneOffsetMs(zone);
  }
  m = DAY_OF_YEAR_RE.exec(s);
  if (m) {
    const [, y, doy, hh, mi, ss, zone] = m;
    const dayOfYear = Number(doy);
    if (dayOfYear < 1 || dayOfYear > 366) return Number.NaN;
    const base = Date.UTC(Number(y), 0, dayOfYear, Number(hh ?? 0), Number(mi ?? 0), 0);
    return base + Number(ss ?? 0) * 1000 - zoneOffsetMs(zone);
  }
  return Number.NaN;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function parseNumber(text: string | undefined): number {
  if (text === undefined) return Number.NaN;
  const s = text.trim();
  return NUMBER_RE.test(s) ? Number(s) : Number.NaN;
}

// ---------------------------------------------------------------------------
// Frame conversion helpers
// ---------------------------------------------------------------------------

export function llaToEcef(latDeg: number, lonDeg: number, altKm: number): EcefVector {
  const p = satellite.geodeticToEcf({
    latitude: latDeg * DEG2RAD,
    longitude: lonDeg * DEG2RAD,
    height: altKm,
  });
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Convert an ECI (TEME-like) state to ECEF using the scene's GMST convention.
 * Velocity includes the Earth-rotation term: v_ecef = R·v_eci − ω × r_ecef.
 */
export function eciStateToEcef(
  timeMs: number,
  position: EcefVector,
  velocity?: EcefVector,
): { position: EcefVector; velocity?: EcefVector } {
  const gmst = satellite.gstime(new Date(timeMs));
  const r = satellite.eciToEcf(position, gmst);
  const pos = { x: r.x, y: r.y, z: r.z };
  if (!velocity) return { position: pos };
  const v = satellite.eciToEcf(velocity, gmst);
  return {
    position: pos,
    velocity: {
      x: v.x + EARTH_ROTATION_RAD_S * pos.y,
      y: v.y - EARTH_ROTATION_RAD_S * pos.x,
      z: v.z,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared post-processing
// ---------------------------------------------------------------------------

function finalizeSamples(samples: TrajectorySample[], warnings: string[]): TrajectorySample[] {
  const sorted = samples
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.timeMs - b.s.timeMs || a.i - b.i)
    .map(({ s }) => s);
  const out: TrajectorySample[] = [];
  let dropped = 0;
  for (const s of sorted) {
    if (out.length > 0 && out[out.length - 1].timeMs === s.timeMs) {
      dropped += 1;
      continue;
    }
    out.push(s);
  }
  if (dropped > 0) {
    warnings.push(`同じ時刻のサンプルが ${dropped} 件あったため、最初の 1 件だけを使用しました`);
  }
  if (out.length < 2) {
    throw new TrajectoryParseError("有効なサンプルが 2 件以上必要です");
  }
  return out;
}

function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name) || "trajectory";
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

type ColumnRole =
  | "time"
  | "lat"
  | "lon"
  | "alt"
  | "x"
  | "y"
  | "z"
  | "vx"
  | "vy"
  | "vz"
  | "qw"
  | "qx"
  | "qy"
  | "qz"
  | "att_az"
  | "att_el"
  | "att_roll";

interface ColumnSpec {
  role: ColumnRole;
  /** Multiplier to km, km/s or degrees. */
  scale: number;
}

const LENGTH_UNITS: Record<string, number> = { "": 1, km: 1, m: 0.001 };
const SPEED_UNITS: Record<string, number> = {
  "": 1,
  km_s: 1,
  kms: 1,
  km_sec: 1,
  m_s: 0.001,
  ms: 0.001,
  m_sec: 0.001,
};
const ANGLE_UNITS: Record<string, number> = { "": 1, deg: 1, degree: 1, degrees: 1 };
const TIME_UNITS: Record<string, number> = { "": 1, s: 1, sec: 1, utc: 1, iso: 1 };
const UNITLESS: Record<string, number> = { "": 1 };

const ROLE_ALIASES: Array<{ role: ColumnRole; bases: string[]; units: Record<string, number> }> = [
  { role: "time", bases: ["time", "t", "utc", "epoch", "datetime"], units: TIME_UNITS },
  { role: "lat", bases: ["lat", "latitude"], units: ANGLE_UNITS },
  { role: "lon", bases: ["lon", "lng", "long", "longitude"], units: ANGLE_UNITS },
  { role: "alt", bases: ["alt", "altitude", "height", "h"], units: LENGTH_UNITS },
  { role: "x", bases: ["x"], units: LENGTH_UNITS },
  { role: "y", bases: ["y"], units: LENGTH_UNITS },
  { role: "z", bases: ["z"], units: LENGTH_UNITS },
  { role: "vx", bases: ["vx", "x_dot", "xdot"], units: SPEED_UNITS },
  { role: "vy", bases: ["vy", "y_dot", "ydot"], units: SPEED_UNITS },
  { role: "vz", bases: ["vz", "z_dot", "zdot"], units: SPEED_UNITS },
  // Attitude quaternion body → attitude_frame, scalar first (q0 = qw).
  { role: "qw", bases: ["qw", "q0"], units: UNITLESS },
  { role: "qx", bases: ["qx", "q1"], units: UNITLESS },
  { role: "qy", bases: ["qy", "q2"], units: UNITLESS },
  { role: "qz", bases: ["qz", "q3"], units: UNITLESS },
  // Rocket-style attitude angles in local ENU.
  { role: "att_az", bases: ["att_azimuth", "att_az", "heading", "yaw"], units: ANGLE_UNITS },
  { role: "att_el", bases: ["att_elevation", "att_el", "pitch"], units: ANGLE_UNITS },
  { role: "att_roll", bases: ["att_roll", "roll"], units: ANGLE_UNITS },
];

/** "Alt (km)" → "alt_km", "vx [m/s]" → "vx_m_s". */
function normalizeColumnName(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
    .replace(/[[\]()]/g, "_")
    .replace(/[\s/\-.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Exact base + known unit suffix only, so `qx`, `q_x`, `x_quat` stay unknown. */
function classifyColumn(raw: string): ColumnSpec | null {
  const name = normalizeColumnName(raw);
  for (const { role, bases, units } of ROLE_ALIASES) {
    for (const base of bases) {
      if (name === base) return { role, scale: units[""] };
      if (name.startsWith(`${base}_`)) {
        const unit = name.slice(base.length + 1);
        if (Object.hasOwn(units, unit)) return { role, scale: units[unit] };
      }
    }
  }
  return null;
}

function splitRow(line: string, separator: "comma" | "tab" | "space"): string[] {
  const cells =
    separator === "comma" ? line.split(",") : separator === "tab" ? line.split("\t") : line.trim().split(/\s+/);
  return cells.map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
}

function parseFrame(value: string): TrajectorySourceFrame | null {
  const v = value.trim().toUpperCase();
  if (v === "LLA" || v === "GEODETIC" || v === "WGS84") return "LLA";
  if (v === "ECEF" || v === "ECF" || v === "ITRF" || v.startsWith("ITRF")) return "ECEF";
  if (["ECI", "TEME", "J2000", "EME2000", "GCRF", "ICRF"].includes(v)) return "ECI";
  return null;
}

interface PendingEvent {
  line: number;
  time: string;
  label: string;
}

interface PendingAttitudeRule {
  line: number;
  time: string;
  mode: AttitudeMode;
  aoaDeg?: number;
  transitionS?: number;
}

type AttitudeFrame = "ECEF" | "ECI" | "ENU";

const ATTITUDE_MODES: readonly AttitudeMode[] = ["prograde", "retrograde", "vertical", "aoa"];

/** `<time>, <mode>[, aoa=<deg>][, transition=<s>]` → pending rule, or an error message. */
function parseAttitudeHeader(value: string, line: number): PendingAttitudeRule | string {
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length < 2 || !parts[0]) return `${line}行目: attitude は「時刻, モード」の形式で指定してください`;
  const mode = parts[1].toLowerCase() as AttitudeMode;
  if (!ATTITUDE_MODES.includes(mode)) {
    return `${line}行目: 姿勢モード "${parts[1]}" には対応していません（prograde / retrograde / vertical / aoa）`;
  }
  const rule: PendingAttitudeRule = { line, time: parts[0], mode };
  for (const option of parts.slice(2)) {
    const kv = /^([a-z_]+)\s*=\s*(.+)$/i.exec(option);
    const num = kv ? parseNumber(kv[2]) : Number.NaN;
    const key = kv?.[1].toLowerCase();
    if (key === "aoa" && Number.isFinite(num)) rule.aoaDeg = num;
    else if (key === "transition" && Number.isFinite(num) && num >= 0) rule.transitionS = num;
    else return `${line}行目: attitude のオプション "${option}" を読み取れません（aoa=<度>, transition=<秒>）`;
  }
  if (mode === "aoa" && rule.aoaDeg === undefined) return `${line}行目: aoa モードには aoa=<度> が必要です`;
  return rule;
}

/** Relative seconds (needs epoch) or ISO time of a header line; NaN when unreadable. */
function headerTimeMs(time: string, epochMs: number | undefined): number | "no-epoch" {
  const seconds = parseNumber(time);
  if (Number.isFinite(seconds)) return epochMs === undefined ? "no-epoch" : epochMs + seconds * 1000;
  return parseUtcTimestamp(time);
}

const RAD2DEG = 180 / Math.PI;
const scratchQ = new THREE.Quaternion();
const scratchFrameQ = new THREE.Quaternion();

/** Geodetic latitude/longitude (deg) of an ECEF position. */
function ecefLatLon(p: EcefVector): { latDeg: number; lonDeg: number } {
  const geo = satellite.eciToGeodetic(p, 0);
  return { latDeg: geo.latitude * RAD2DEG, lonDeg: geo.longitude * RAD2DEG };
}

/** body → `frame` quaternion (already in scratchQ) → body → ECEF. */
function attitudeToEcef(frame: AttitudeFrame, timeMs: number, position: EcefVector): BodyQuaternion {
  if (frame === "ENU") {
    const { latDeg, lonDeg } = ecefLatLon(position);
    scratchQ.premultiply(enuToEcefQuaternion(latDeg, lonDeg, scratchFrameQ));
  } else if (frame === "ECI") {
    // ECI → ECEF is a rotation by −GMST about +Z (the scene's convention).
    scratchFrameQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -satellite.gstime(new Date(timeMs)));
    scratchQ.premultiply(scratchFrameQ);
  }
  scratchQ.normalize();
  return { w: scratchQ.w, x: scratchQ.x, y: scratchQ.y, z: scratchQ.z };
}

function parseCsv(text: string, fileName: string, options: TrajectoryParseOptions): TrajectoryParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  let name: string | undefined;
  let frameHeader: TrajectorySourceFrame | undefined;
  let epochMs: number | undefined;
  let model: string | undefined;
  let attitudeFrame: AttitudeFrame | undefined;
  const pendingEvents: PendingEvent[] = [];
  const pendingRules: PendingAttitudeRule[] = [];
  let pendingMount: { line: number; time: string; offsetM: number } | undefined;

  let header: { columns: (ColumnSpec | null)[]; line: number } | null = null;
  let separator: "comma" | "tab" | "space" = "comma";
  const rows: Array<{ line: number; cells: string[] }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const meta = /^#\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
      if (!meta) continue;
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === "name") {
        if (value) name = value;
      } else if (key === "frame") {
        const frame = parseFrame(value);
        if (!frame) throw new TrajectoryParseError(`${lineNo}行目: 座標系 "${value}" には対応していません（LLA / ECEF / ECI）`);
        frameHeader = frame;
      } else if (key === "epoch") {
        const ms = parseUtcTimestamp(value);
        if (!Number.isFinite(ms)) throw new TrajectoryParseError(`${lineNo}行目: epoch の時刻を読み取れません`);
        epochMs = ms;
      } else if (key === "model") {
        if (value) model = value;
      } else if (key === "mount") {
        const parts = value.split(",").map((s) => s.trim());
        const offsetM = parseNumber(parts[1] ?? "");
        if (parts.length !== 2 || !Number.isFinite(offsetM)) {
          warnings.push(`${lineNo}行目: mount は「分離時刻, 下段の長さ(m)」の形式で指定してください`);
        } else {
          pendingMount = { line: lineNo, time: parts[0], offsetM };
        }
      } else if (key === "attitude") {
        const rule = parseAttitudeHeader(value, lineNo);
        if (typeof rule === "string") warnings.push(rule);
        else pendingRules.push(rule);
      } else if (key === "attitude_frame") {
        const v = value.trim().toUpperCase();
        if (v === "ECEF" || v === "ECF" || v === "ITRF") attitudeFrame = "ECEF";
        else if (v === "ECI" || v === "TEME" || v === "J2000" || v === "EME2000" || v === "GCRF") attitudeFrame = "ECI";
        else if (v === "ENU") attitudeFrame = "ENU";
        else throw new TrajectoryParseError(`${lineNo}行目: 姿勢の座標系 "${value}" には対応していません（ECEF / ECI / ENU）`);
      } else if (key === "event") {
        const comma = value.indexOf(",");
        if (comma < 0) {
          warnings.push(`${lineNo}行目: event は「時刻, ラベル」の形式で指定してください`);
        } else {
          pendingEvents.push({
            line: lineNo,
            time: value.slice(0, comma).trim(),
            label: value.slice(comma + 1).trim(),
          });
        }
      }
      continue;
    }
    if (!header) {
      separator = line.includes(",") ? "comma" : line.includes("\t") ? "tab" : "space";
      header = { columns: splitRow(line, separator).map(classifyColumn), line: lineNo };
      continue;
    }
    rows.push({ line: lineNo, cells: splitRow(line, separator) });
  }

  if (!header) throw new TrajectoryParseError("ヘッダー行が見つかりません");
  const columnIndex = new Map<ColumnRole, { index: number; scale: number }>();
  header.columns.forEach((spec, index) => {
    if (spec && !columnIndex.has(spec.role)) columnIndex.set(spec.role, { index, scale: spec.scale });
  });
  const timeCol = columnIndex.get("time");
  if (!timeCol) throw new TrajectoryParseError("時刻の列（time, t, utc など）が見つかりません");

  const hasLla = columnIndex.has("lat") && columnIndex.has("lon") && columnIndex.has("alt");
  const hasXyz = columnIndex.has("x") && columnIndex.has("y") && columnIndex.has("z");
  const hasVel = columnIndex.has("vx") && columnIndex.has("vy") && columnIndex.has("vz");
  let frame: TrajectorySourceFrame;
  if (frameHeader) {
    frame = frameHeader;
    if (frame === "LLA" && !hasLla) throw new TrajectoryParseError("frame: LLA ですが lat / lon / alt の列がありません");
    if (frame !== "LLA" && !hasXyz) throw new TrajectoryParseError(`frame: ${frame} ですが x / y / z の列がありません`);
  } else if (hasLla) {
    frame = "LLA";
  } else if (hasXyz) {
    frame = "ECEF";
    warnings.push("座標系の指定（# frame:）がないため、x / y / z を ECEF として読み込みました");
  } else {
    throw new TrajectoryParseError("位置の列（lat / lon / alt または x / y / z）が見つかりません");
  }
  if (rows.length === 0) throw new TrajectoryParseError("データ行がありません");

  const quatRoles = ["qw", "qx", "qy", "qz"] as const;
  const quatCount = quatRoles.filter((r) => columnIndex.has(r)).length;
  const hasQuat = quatCount === 4;
  if (quatCount > 0 && !hasQuat) warnings.push("姿勢クォータニオンの列（qw, qx, qy, qz）が揃っていないため無視しました");
  const hasAngles = !hasQuat && columnIndex.has("att_az") && columnIndex.has("att_el");
  if (!hasQuat && (columnIndex.has("att_az") !== columnIndex.has("att_el"))) {
    warnings.push("姿勢角は方位角と仰角の両方の列が必要なため無視しました");
  }
  if (hasQuat && !attitudeFrame) {
    attitudeFrame = "ECEF";
    warnings.push("姿勢の座標系（# attitude_frame:）がないため、クォータニオンを機体→ECEF として読み込みました");
  }

  // Decide time mode from the first data row.
  const firstTime = rows[0].cells[timeCol.index] ?? "";
  const relative = Number.isFinite(parseNumber(firstTime));
  let timeBaseMs = epochMs;
  if (relative && timeBaseMs === undefined) {
    if (options.defaultEpochMs !== undefined && Number.isFinite(options.defaultEpochMs)) {
      timeBaseMs = options.defaultEpochMs;
      epochMs = options.defaultEpochMs;
      warnings.push("# epoch: がないため、相対時刻（秒）を既定の基準時刻からの経過時間として扱いました");
    } else {
      throw new TrajectoryParseError("時刻が相対秒ですが、基準時刻（# epoch:）が指定されていません");
    }
  }

  const required = [
    ...(frame === "LLA" ? ["lat", "lon", "alt"] : ["x", "y", "z"]),
    ...(hasQuat ? quatRoles : []),
    ...(hasAngles ? ["att_az", "att_el"] : []),
  ] as ColumnRole[];
  const maxIndex = Math.max(
    timeCol.index,
    ...required.map((r) => columnIndex.get(r)!.index),
  );

  const samples: TrajectorySample[] = [];
  let cellsForAttitude: string[] = [];
  const readCell = (role: ColumnRole): number => {
    const col = columnIndex.get(role);
    return col ? parseNumber(cellsForAttitude[col.index]) * col.scale : Number.NaN;
  };
  /** Attitude of the current row (body → ECEF), or undefined when the file has none. */
  const readAttitude = (position: EcefVector, timeMs: number, line: number): BodyQuaternion | undefined => {
    if (hasQuat) {
      const [w, x, y, z] = quatRoles.map(readCell);
      if (![w, x, y, z].every(Number.isFinite)) throw new TrajectoryParseError(`${line}行目: 数値として読めない値があります`);
      if (Math.hypot(w, x, y, z) < 1e-9) throw new TrajectoryParseError(`${line}行目: クォータニオンの大きさが 0 です`);
      scratchQ.set(x, y, z, w).normalize();
      return attitudeToEcef(attitudeFrame ?? "ECEF", timeMs, position);
    }
    if (hasAngles) {
      const az = readCell("att_az");
      const el = readCell("att_el");
      const roll = columnIndex.has("att_roll") ? readCell("att_roll") : 0;
      if (![az, el, roll].every(Number.isFinite)) throw new TrajectoryParseError(`${line}行目: 数値として読めない値があります`);
      enuAnglesToQuaternion(az, el, roll, scratchQ);
      return attitudeToEcef("ENU", timeMs, position);
    }
    return undefined;
  };
  for (const { line, cells } of rows) {
    cellsForAttitude = cells;
    if (cells.length <= maxIndex) throw new TrajectoryParseError(`${line}行目: 列数が足りません`);
    const rawTime = cells[timeCol.index];
    let timeMs: number;
    if (relative) {
      const seconds = parseNumber(rawTime);
      if (!Number.isFinite(seconds)) throw new TrajectoryParseError(`${line}行目: 時刻を数値（秒）として読めません`);
      timeMs = timeBaseMs! + seconds * 1000 * timeCol.scale;
    } else {
      timeMs = parseUtcTimestamp(rawTime);
      if (!Number.isFinite(timeMs)) throw new TrajectoryParseError(`${line}行目: 時刻を読み取れません`);
    }
    const read = (role: ColumnRole): number => {
      const col = columnIndex.get(role)!;
      return parseNumber(cells[col.index]) * col.scale;
    };
    if (frame === "LLA") {
      const lat = read("lat");
      const lon = read("lon");
      const alt = read("alt");
      if (![lat, lon, alt].every(Number.isFinite)) {
        throw new TrajectoryParseError(`${line}行目: 数値として読めない値があります`);
      }
      if (Math.abs(lat) > 90) throw new TrajectoryParseError(`${line}行目: 緯度が範囲外です`);
      const position = llaToEcef(lat, lon, alt);
      const attitude = readAttitude(position, timeMs, line);
      samples.push({ timeMs, position, ...(attitude ? { attitude } : {}) });
      continue;
    }
    const position = { x: read("x"), y: read("y"), z: read("z") };
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new TrajectoryParseError(`${line}行目: 数値として読めない値があります`);
    }
    let velocity: EcefVector | undefined;
    if (hasVel) {
      const v = { x: read("vx"), y: read("vy"), z: read("vz") };
      if (![v.x, v.y, v.z].every(Number.isFinite)) {
        throw new TrajectoryParseError(`${line}行目: 数値として読めない値があります`);
      }
      velocity = v;
    }
    if (frame === "ECI") {
      const converted = eciStateToEcef(timeMs, position, velocity);
      const attitude = readAttitude(converted.position, timeMs, line);
      samples.push({
        timeMs,
        position: converted.position,
        ...(converted.velocity ? { velocity: converted.velocity } : {}),
        ...(attitude ? { attitude } : {}),
      });
    } else {
      const attitude = readAttitude(position, timeMs, line);
      samples.push({ timeMs, position, ...(velocity ? { velocity } : {}), ...(attitude ? { attitude } : {}) });
    }
  }

  const attitudeRules: AttitudeRule[] = [];
  for (const rule of pendingRules) {
    const timeMs = headerTimeMs(rule.time, epochMs);
    if (timeMs === "no-epoch") {
      warnings.push(`${rule.line}行目: 基準時刻がないため、相対時刻の姿勢指定を無視しました`);
      continue;
    }
    if (!Number.isFinite(timeMs)) {
      warnings.push(`${rule.line}行目: 姿勢指定の時刻を読み取れないため無視しました`);
      continue;
    }
    attitudeRules.push({
      timeMs,
      mode: rule.mode,
      ...(rule.aoaDeg !== undefined ? { aoaDeg: rule.aoaDeg } : {}),
      ...(rule.transitionS !== undefined ? { transitionS: rule.transitionS } : {}),
    });
  }
  // Stable sort keeps file order for equal times.
  attitudeRules.sort((a, b) => a.timeMs - b.timeMs);
  if (attitudeRules.length > 0 && (hasQuat || hasAngles)) {
    warnings.push("姿勢の列があるため、# attitude: の指定は使用されません");
  }

  const events: TrajectoryEvent[] = [];
  for (const ev of pendingEvents) {
    const seconds = parseNumber(ev.time);
    let timeMs: number;
    if (Number.isFinite(seconds)) {
      if (epochMs === undefined) {
        warnings.push(`${ev.line}行目: 基準時刻がないため、相対時刻のイベントを無視しました`);
        continue;
      }
      timeMs = epochMs + seconds * 1000;
    } else {
      timeMs = parseUtcTimestamp(ev.time);
      if (!Number.isFinite(timeMs)) {
        warnings.push(`${ev.line}行目: イベントの時刻を読み取れないため無視しました`);
        continue;
      }
    }
    events.push({ timeMs, label: ev.label || "Event" });
  }
  events.sort((a, b) => a.timeMs - b.timeMs);

  let mount: { untilMs: number; offsetM: number } | undefined;
  if (pendingMount) {
    const untilMs = headerTimeMs(pendingMount.time, epochMs);
    if (untilMs === "no-epoch" || !Number.isFinite(untilMs)) {
      warnings.push(`${pendingMount.line}行目: mount の分離時刻を読み取れないため無視しました`);
    } else {
      mount = { untilMs, offsetM: pendingMount.offsetM };
    }
  }

  const finalSamples = finalizeSamples(samples, warnings);
  return {
    ok: true,
    track: {
      name: name ?? baseName(fileName),
      sourceFrame: frame,
      samples: finalSamples,
      events,
      ...(epochMs !== undefined ? { epochMs } : {}),
      attitudeRules,
      ...(model ? { model } : {}),
      ...(mount ? { mount } : {}),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CCSDS OEM (KVN)
// ---------------------------------------------------------------------------

function oemFrame(refFrame: string): "ECEF" | "ECI" | null {
  const v = refFrame.trim().toUpperCase();
  if (v.startsWith("ITRF") || v === "ECEF" || v === "ECF" || v === "EFG") return "ECEF";
  if (["EME2000", "J2000", "GCRF", "ICRF", "TEME", "TOD", "MOD"].includes(v)) return "ECI";
  return null;
}

function parseOem(text: string, fileName: string): TrajectoryParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  const samples: TrajectorySample[] = [];
  const frames = new Set<"ECEF" | "ECI">();
  let name: string | undefined;
  let inMeta = false;
  let inCovariance = false;
  let meta: Record<string, string> = {};
  let segmentFrame: "ECEF" | "ECI" | null = null;
  let warnedEci = false;
  const warnedCenter = new Set<string>();
  const warnedTimeSystem = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === "" || line.startsWith("COMMENT")) continue;
    if (line === "COVARIANCE_START") {
      inCovariance = true;
      continue;
    }
    if (line === "COVARIANCE_STOP") {
      inCovariance = false;
      continue;
    }
    if (inCovariance) continue;
    if (line === "META_START") {
      inMeta = true;
      meta = {};
      continue;
    }
    if (line === "META_STOP") {
      inMeta = false;
      if (!name && meta.OBJECT_NAME) name = meta.OBJECT_NAME;
      const center = (meta.CENTER_NAME ?? "").toUpperCase();
      if (center !== "EARTH" && !warnedCenter.has(center)) {
        warnedCenter.add(center);
        warnings.push(`CENTER_NAME が EARTH ではありません（${meta.CENTER_NAME ?? "未指定"}）。地球中心として表示します`);
      }
      const timeSystem = (meta.TIME_SYSTEM ?? "").toUpperCase();
      if (timeSystem !== "UTC" && !warnedTimeSystem.has(timeSystem)) {
        warnedTimeSystem.add(timeSystem);
        warnings.push(`TIME_SYSTEM が UTC ではありません（${meta.TIME_SYSTEM ?? "未指定"}）。UTC として扱います`);
      }
      segmentFrame = oemFrame(meta.REF_FRAME ?? "");
      if (!segmentFrame) {
        throw new TrajectoryParseError(`${lineNo}行目: REF_FRAME "${meta.REF_FRAME ?? ""}" には対応していません`);
      }
      frames.add(segmentFrame);
      if (segmentFrame === "ECI" && !warnedEci) {
        warnedEci = true;
        warnings.push(
          `REF_FRAME ${meta.REF_FRAME} は慣性系として、シーンと同じ GMST 回転で地球固定系に変換しました（歳差・章動は無視する近似です）`,
        );
      }
      continue;
    }
    if (inMeta) {
      const kv = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].trim();
      continue;
    }
    if (line.includes("=")) continue; // header keywords (CCSDS_OEM_VERS, CREATION_DATE, ...)
    const tokens = line.split(/\s+/);
    if (!segmentFrame) throw new TrajectoryParseError(`${lineNo}行目: META ブロックより前にデータ行があります`);
    if (tokens.length < 7) throw new TrajectoryParseError(`${lineNo}行目: エポックと位置・速度 6 成分が必要です`);
    const timeMs = parseUtcTimestamp(tokens[0]);
    if (!Number.isFinite(timeMs)) throw new TrajectoryParseError(`${lineNo}行目: 時刻を読み取れません`);
    const values = tokens.slice(1, 7).map(parseNumber);
    if (!values.every(Number.isFinite)) throw new TrajectoryParseError(`${lineNo}行目: 数値として読めない値があります`);
    const position = { x: values[0], y: values[1], z: values[2] };
    const velocity = { x: values[3], y: values[4], z: values[5] };
    if (segmentFrame === "ECI") {
      const converted = eciStateToEcef(timeMs, position, velocity);
      samples.push({ timeMs, position: converted.position, velocity: converted.velocity! });
    } else {
      samples.push({ timeMs, position, velocity });
    }
  }

  if (frames.size === 0) throw new TrajectoryParseError("META ブロックが見つかりません");
  if (frames.size > 1) warnings.push("セグメントごとに異なる REF_FRAME が含まれています");
  const finalSamples = finalizeSamples(samples, warnings);
  return {
    ok: true,
    track: {
      name: name ?? baseName(fileName),
      sourceFrame: frames.has("ECI") ? "ECI" : "ECEF",
      samples: finalSamples,
      events: [],
      attitudeRules: [],
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseTrajectoryFile(
  text: string,
  fileName: string,
  options: TrajectoryParseOptions = {},
): TrajectoryParseResult {
  try {
    const body = text.replace(/^\uFEFF/, "");
    if (/^\s*</.test(body)) {
      return { ok: false, error: "XML 形式には対応していません（CSV または CCSDS OEM の KVN 形式を使用してください）" };
    }
    if (/^\s*CCSDS_OEM_VERS\s*=/m.test(body)) return parseOem(body, fileName);
    return parseCsv(body, fileName, options);
  } catch (error) {
    if (error instanceof TrajectoryParseError) return { ok: false, error: error.message };
    return { ok: false, error: `ファイルを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Colours chosen to stay legible over the dark globe; cycled by index. */
export const TRAJECTORY_PALETTE = [
  "#ff7a45",
  "#40c4ff",
  "#ffd740",
  "#69f0ae",
  "#ff4081",
  "#b388ff",
  "#ffab40",
  "#18ffff",
] as const;

let trackCounter = 0;

/** Assign id, colour (from a fixed palette, cycling by index) and visible=true. */
export function toTrajectoryTrack(parsed: ParsedTrack, index: number): TrajectoryTrack {
  trackCounter += 1;
  const paletteIndex = ((index % TRAJECTORY_PALETTE.length) + TRAJECTORY_PALETTE.length) % TRAJECTORY_PALETTE.length;
  return {
    ...parsed,
    attitudeRules: parsed.attitudeRules ?? [],
    id: `trajectory-${index}-${trackCounter.toString(36)}`,
    color: TRAJECTORY_PALETTE[paletteIndex],
    visible: true,
  };
}
