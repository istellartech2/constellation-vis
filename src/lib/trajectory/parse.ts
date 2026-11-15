/**
 * Parsers for tabulated trajectory files (CSV/TSV and CCSDS OEM KVN).
 *
 * Every accepted file is normalised to Earth-fixed (ECEF, km) samples sorted
 * by time. Format details and conventions: docs/trajectory-layer.md.
 * Error and warning strings are Japanese because they are shown in the UI.
 */
import * as satellite from "satellite.js";
import type {
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

function llaToEcef(latDeg: number, lonDeg: number, altKm: number): EcefVector {
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
  | "vz";

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

function parseCsv(text: string, fileName: string, options: TrajectoryParseOptions): TrajectoryParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  let name: string | undefined;
  let frameHeader: TrajectorySourceFrame | undefined;
  let epochMs: number | undefined;
  const pendingEvents: PendingEvent[] = [];

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

  const required = (frame === "LLA" ? ["lat", "lon", "alt"] : ["x", "y", "z"]) as ColumnRole[];
  const maxIndex = Math.max(
    timeCol.index,
    ...required.map((r) => columnIndex.get(r)!.index),
  );

  const samples: TrajectorySample[] = [];
  for (const { line, cells } of rows) {
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
      samples.push({ timeMs, position: llaToEcef(lat, lon, alt) });
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
      samples.push({ timeMs, position: converted.position, ...(converted.velocity ? { velocity: converted.velocity } : {}) });
    } else {
      samples.push({ timeMs, position, ...(velocity ? { velocity } : {}) });
    }
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

  const finalSamples = finalizeSamples(samples, warnings);
  return {
    ok: true,
    track: {
      name: name ?? baseName(fileName),
      sourceFrame: frame,
      samples: finalSamples,
      events,
      ...(epochMs !== undefined ? { epochMs } : {}),
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
    id: `trajectory-${index}-${trackCounter.toString(36)}`,
    color: TRAJECTORY_PALETTE[paletteIndex],
    visible: true,
  };
}
