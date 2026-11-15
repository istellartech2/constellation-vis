/**
 * Per-shell / per-satellite attitude (シェル／衛星ごとの姿勢).
 *
 * A satellite's attitude is the global setting (通信タブ › 衛星の姿勢とセンサ)
 * unless its scenario entry carries an override (`SatelliteSpec.attitude`,
 * from the `attitude_*` keys of a `[[constellation.shells]]` or
 * `[[satellites]]` block). Resolution rules:
 *
 * - No override, or an empty one → the global settings object itself (same
 *   reference, so callers that dedupe by identity and the legacy LVLH fast
 *   paths are unaffected).
 * - Override with `mode` → the attitude *law* is replaced: `mode`,
 *   `eclipseMode` and `trackStationDuringPass` come from the override only
 *   (omitted = off). The law's parameters — `stationName`, RA/Dec — and the
 *   spacecraft's `maxSlewRateDegS` fall back to the global values when the
 *   override omits them.
 * - Override without `mode` → field-wise merge over the global settings (e.g.
 *   only `maxSlewRateDegS` for one shell, or `trackStationDuringPass = false`
 *   to switch a global station-pass schedule off).
 *
 * Dependency-free on purpose (types + settings only): `tomlParsers.ts` imports
 * it and is bundled into the AI session API (src/server/generated).
 */
import {
  ATTITUDE_MODE_SHORT_LABELS,
  INERTIAL_DEC_RANGE_DEG,
  INERTIAL_RA_RANGE_DEG,
  MAX_SLEW_RATE_RANGE_DEG_S,
  isSatelliteAttitudeMode,
} from "./settings";
import type {
  SatelliteAttitudeOverride,
  SatelliteAttitudeSettings,
} from "./types";

/** Where a spec's override came from (`SatelliteSpec.attitudeSource`). */
export type AttitudeOverrideSource = "shell" | "satellite";

/** The part of `SatelliteSpec` the resolver reads (keeps this module type-light). */
export interface AttitudeOverrideCarrier {
  attitude?: SatelliteAttitudeOverride;
  attitudeSource?: AttitudeOverrideSource;
}

const OVERRIDE_FIELDS = [
  "mode",
  "stationName",
  "inertialRaDeg",
  "inertialDecDeg",
  "eclipseMode",
  "trackStationDuringPass",
  "maxSlewRateDegS",
] as const satisfies readonly (keyof SatelliteAttitudeSettings)[];

/** True when the override sets at least one field. */
export function hasAttitudeOverride(override: SatelliteAttitudeOverride | undefined | null): override is SatelliteAttitudeOverride {
  if (!override) return false;
  for (const key of OVERRIDE_FIELDS) if (override[key] !== undefined) return true;
  return false;
}

/** {@link resolveSatelliteAttitude} for a bare override. */
export function applyAttitudeOverride(
  override: SatelliteAttitudeOverride | undefined | null,
  global: SatelliteAttitudeSettings,
): SatelliteAttitudeSettings {
  if (!hasAttitudeOverride(override)) return global;
  if (override.mode !== undefined) {
    const out: SatelliteAttitudeSettings = {
      mode: override.mode,
      inertialRaDeg: override.inertialRaDeg ?? global.inertialRaDeg,
      inertialDecDeg: override.inertialDecDeg ?? global.inertialDecDeg,
    };
    const stationName = override.stationName ?? global.stationName;
    if (stationName !== undefined) out.stationName = stationName;
    if (override.eclipseMode !== undefined) out.eclipseMode = override.eclipseMode;
    if (override.trackStationDuringPass !== undefined) out.trackStationDuringPass = override.trackStationDuringPass;
    const slew = override.maxSlewRateDegS ?? global.maxSlewRateDegS;
    if (slew !== undefined) out.maxSlewRateDegS = slew;
    return out;
  }
  const out: SatelliteAttitudeSettings = { ...global };
  for (const key of OVERRIDE_FIELDS) {
    const value = override[key];
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The attitude settings that apply to one satellite. */
export function resolveSatelliteAttitude(
  spec: AttitudeOverrideCarrier | undefined | null,
  global: SatelliteAttitudeSettings,
): SatelliteAttitudeSettings {
  return applyAttitudeOverride(spec?.attitude, global);
}

/** 「シェル設定」 / 「衛星設定」, or null when the satellite follows the global setting. */
export function attitudeOverrideLabel(spec: AttitudeOverrideCarrier | undefined | null): string | null {
  if (!spec || !hasAttitudeOverride(spec.attitude)) return null;
  return spec.attitudeSource === "shell" ? "シェル設定" : "衛星設定";
}

/** Number of satellites whose attitude comes from a shell / satellite override. */
export function countAttitudeOverrides(satellites: readonly AttitudeOverrideCarrier[]): number {
  let n = 0;
  for (const s of satellites) if (hasAttitudeOverride(s.attitude)) n++;
  return n;
}

/** Stable key for grouping satellites with equal resolved settings. */
export function attitudeSettingsKey(settings: SatelliteAttitudeSettings): string {
  return OVERRIDE_FIELDS.map((k) => String(settings[k] ?? "")).join("|");
}

/**
 * One-line summary of an override for badges / list subtitles, e.g.
 * 「太陽指向 · 日陰: 地球指向 · 最大 1°/s」, or null without one.
 */
export function attitudeOverrideSummary(override: SatelliteAttitudeOverride | undefined | null): string | null {
  if (!hasAttitudeOverride(override)) return null;
  const parts: string[] = [];
  parts.push(override.mode !== undefined ? ATTITUDE_MODE_SHORT_LABELS[override.mode] : "全体設定を一部変更");
  if (override.trackStationDuringPass !== undefined) parts.push(override.trackStationDuringPass ? "通過中: 地上局指向" : "通過中の局指向なし");
  if (override.eclipseMode !== undefined) parts.push(`日陰: ${ATTITUDE_MODE_SHORT_LABELS[override.eclipseMode]}`);
  if (override.maxSlewRateDegS !== undefined) parts.push(override.maxSlewRateDegS > 0 ? `最大 ${override.maxSlewRateDegS}°/s` : "切替即時");
  return parts.join(" · ");
}

// ------------------------------------------------------------------- TOML

/**
 * TOML keys shared by `[[constellation.shells]]` and `[[satellites]]`
 * (`[[satellites]]` formation entries apply theirs to every deputy).
 */
export const ATTITUDE_TOML_KEYS = {
  mode: "attitude_mode",
  stationName: "attitude_station",
  inertialRaDeg: "attitude_ra_deg",
  inertialDecDeg: "attitude_dec_deg",
  eclipseMode: "attitude_eclipse_mode",
  trackStationDuringPass: "attitude_track_station",
  maxSlewRateDegS: "attitude_slew_deg_s",
} as const satisfies Record<(typeof OVERRIDE_FIELDS)[number], string>;

export type AttitudeTomlKey = (typeof ATTITUDE_TOML_KEYS)[keyof typeof ATTITUDE_TOML_KEYS];

export const ATTITUDE_TOML_KEY_LIST: readonly AttitudeTomlKey[] = Object.values(ATTITUDE_TOML_KEYS);

function toBool(raw: unknown): boolean | undefined {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return undefined;
}

function toFinite(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "" || typeof raw === "boolean") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function inRange(n: number | undefined, [min, max]: readonly [number, number]): n is number {
  return n !== undefined && n >= min && n <= max;
}

/**
 * Lenient TOML record → override for the runtime parsers: unknown modes,
 * out-of-range angles and negative slew rates are dropped (the editors'
 * validation reports them). Undefined when no `attitude_*` key is usable.
 */
export function attitudeOverrideFromRecord(record: Readonly<Record<string, unknown>>): SatelliteAttitudeOverride | undefined {
  const o: SatelliteAttitudeOverride = {};
  const mode = record[ATTITUDE_TOML_KEYS.mode];
  if (isSatelliteAttitudeMode(mode)) o.mode = mode;
  const station = record[ATTITUDE_TOML_KEYS.stationName];
  if (typeof station === "string" && station !== "") o.stationName = station;
  const ra = toFinite(record[ATTITUDE_TOML_KEYS.inertialRaDeg]);
  if (inRange(ra, INERTIAL_RA_RANGE_DEG)) o.inertialRaDeg = ra;
  const dec = toFinite(record[ATTITUDE_TOML_KEYS.inertialDecDeg]);
  if (inRange(dec, INERTIAL_DEC_RANGE_DEG)) o.inertialDecDeg = dec;
  const eclipse = record[ATTITUDE_TOML_KEYS.eclipseMode];
  if (isSatelliteAttitudeMode(eclipse)) o.eclipseMode = eclipse;
  const track = toBool(record[ATTITUDE_TOML_KEYS.trackStationDuringPass]);
  if (track !== undefined) o.trackStationDuringPass = track;
  const slew = toFinite(record[ATTITUDE_TOML_KEYS.maxSlewRateDegS]);
  // 0 is kept: it overrides a global rate with 「即時」.
  if (inRange(slew, MAX_SLEW_RATE_RANGE_DEG_S)) o.maxSlewRateDegS = slew;
  return hasAttitudeOverride(o) ? o : undefined;
}

function formatNumber(value: number): string {
  // Raw, so user-entered values survive a save/load round trip unchanged.
  return String(value);
}

/** Override → `key = value` TOML lines (empty for no override), in key order. */
export function attitudeOverrideTomlLines(override: SatelliteAttitudeOverride | undefined | null): string[] {
  if (!hasAttitudeOverride(override)) return [];
  const lines: string[] = [];
  const k = ATTITUDE_TOML_KEYS;
  if (override.mode !== undefined) lines.push(`${k.mode} = ${JSON.stringify(override.mode)}`);
  if (override.stationName !== undefined) lines.push(`${k.stationName} = ${JSON.stringify(override.stationName)}`);
  if (override.inertialRaDeg !== undefined) lines.push(`${k.inertialRaDeg} = ${formatNumber(override.inertialRaDeg)}`);
  if (override.inertialDecDeg !== undefined) lines.push(`${k.inertialDecDeg} = ${formatNumber(override.inertialDecDeg)}`);
  if (override.eclipseMode !== undefined) lines.push(`${k.eclipseMode} = ${JSON.stringify(override.eclipseMode)}`);
  if (override.trackStationDuringPass !== undefined) lines.push(`${k.trackStationDuringPass} = ${override.trackStationDuringPass}`);
  if (override.maxSlewRateDegS !== undefined) lines.push(`${k.maxSlewRateDegS} = ${formatNumber(override.maxSlewRateDegS)}`);
  return lines;
}

/**
 * Strict check of the raw `attitude_*` values in one TOML record, for the
 * editors' validation (messages in Japanese). `fieldPrefix` is prepended to
 * the TOML key in each error's `field`.
 */
export function validateAttitudeRecord(
  record: Readonly<Record<string, unknown>>,
  fieldPrefix: string,
): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  const k = ATTITUDE_TOML_KEYS;
  const modeCheck = (key: string, label: string) => {
    const v = record[key];
    if (v !== undefined && v !== "" && !isSatelliteAttitudeMode(v)) {
      errors.push({ field: `${fieldPrefix}${key}`, message: `${label}「${String(v)}」は使えません（lvlh / yawSteering / station / sun / inertial）` });
    }
  };
  modeCheck(k.mode, "姿勢モード");
  modeCheck(k.eclipseMode, "日陰の間の姿勢");
  const station = record[k.stationName];
  if (station !== undefined && typeof station !== "string") {
    errors.push({ field: `${fieldPrefix}${k.stationName}`, message: "姿勢の地上局名は文字列で入力してください" });
  }
  const angle = (key: string, range: readonly [number, number], label: string) => {
    const v = record[key];
    if (v === undefined || v === "") return;
    const n = toFinite(v);
    if (!inRange(n, range)) errors.push({ field: `${fieldPrefix}${key}`, message: `${label}は ${range[0]}〜${range[1]}° の範囲で入力してください` });
  };
  angle(k.inertialRaDeg, INERTIAL_RA_RANGE_DEG, "慣性指向の赤経");
  angle(k.inertialDecDeg, INERTIAL_DEC_RANGE_DEG, "慣性指向の赤緯");
  const track = record[k.trackStationDuringPass];
  if (track !== undefined && toBool(track) === undefined) {
    errors.push({ field: `${fieldPrefix}${k.trackStationDuringPass}`, message: "地上局通過中の指向は true / false で入力してください" });
  }
  const slew = record[k.maxSlewRateDegS];
  if (slew !== undefined && slew !== "") {
    const [min, max] = MAX_SLEW_RATE_RANGE_DEG_S;
    if (!inRange(toFinite(slew), MAX_SLEW_RATE_RANGE_DEG_S)) errors.push({ field: `${fieldPrefix}${k.maxSlewRateDegS}`, message: `姿勢変更の最大レートは ${min}〜${max}°/s の範囲で入力してください（0 は即時）` });
  }
  return errors;
}

/** Check of a typed override (editor state); same messages as {@link validateAttitudeRecord}. */
export function validateAttitudeOverride(
  override: SatelliteAttitudeOverride | undefined | null,
  fieldPrefix: string,
): { field: string; message: string }[] {
  if (!override) return [];
  const record: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(ATTITUDE_TOML_KEYS)) {
    record[key] = (override as Record<string, unknown>)[field];
  }
  return validateAttitudeRecord(record, fieldPrefix);
}

/** Override → the flat `attitude_*` record used by the shell editor state. */
export function attitudeOverrideToRecord(override: SatelliteAttitudeOverride | undefined | null): Partial<Record<AttitudeTomlKey, unknown>> {
  const record: Partial<Record<AttitudeTomlKey, unknown>> = {};
  if (!override) return record;
  for (const [field, key] of Object.entries(ATTITUDE_TOML_KEYS) as [keyof SatelliteAttitudeOverride, AttitudeTomlKey][]) {
    if (override[field] !== undefined) record[key] = override[field];
  }
  return record;
}

