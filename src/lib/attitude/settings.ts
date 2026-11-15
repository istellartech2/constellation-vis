/**
 * Validation of the persisted attitude settings. Dependency-free on purpose:
 * the AI session API bundle (src/server/generated/sessionHandler.mjs) imports
 * it through remoteDisplay.ts and must not pull in three / satellite.js.
 */
import {
  DEFAULT_SATELLITE_ATTITUDE,
  DEFAULT_SOLAR_ARRAY_TYPE,
  type SatelliteAttitudeMode,
  type SatelliteAttitudeSettings,
  type SolarArrayType,
} from "./types";

/** UI order (通信タブ › 姿勢). */
export const SATELLITE_ATTITUDE_MODES: readonly SatelliteAttitudeMode[] = ["lvlh", "yawSteering", "station", "sun", "inertial"];
export const SOLAR_ARRAY_TYPES: readonly SolarArrayType[] = ["fixed", "singleAxis"];

/** Short names, for condition lines such as 「条件: 姿勢 地球指向」. */
export const ATTITUDE_MODE_SHORT_LABELS: Readonly<Record<SatelliteAttitudeMode, string>> = {
  lvlh: "地球指向",
  // Short enough for the satellite card's two-column rows (a longer label
  // widens the label column and pushes the values out of the card).
  yawSteering: "ヨー制御",
  station: "地上局指向",
  sun: "太陽指向",
  inertial: "慣性指向",
};

/** Select labels and one-line descriptions (通信タブ › 衛星の姿勢とセンサ). */
export const ATTITUDE_MODE_OPTIONS: readonly { mode: SatelliteAttitudeMode; label: string; description: string }[] = [
  { mode: "lvlh", label: "地球指向（LVLH）", description: "センサ(+Z)を真下、+Xを進行方向に向けます。従来どおりの向きです。" },
  { mode: "yawSteering", label: "地球指向＋ヨー制御", description: "真下を向いたまま、パネル軸が太陽と直交するよう機体を回します。" },
  { mode: "station", label: "地上局指向", description: "選んだ地上局が見えている間だけセンサを局へ向けます。見えない間は地球指向です。" },
  { mode: "sun", label: "太陽指向", description: "パネル面を太陽へ向けます（充電・セーフモード）。" },
  { mode: "inertial", label: "慣性指向", description: "天球の一点（赤経・赤緯）へセンサを向け続けます。" },
];

export const SOLAR_ARRAY_TYPE_LABELS: Readonly<Record<SolarArrayType, string>> = {
  fixed: "固定（−Z面）",
  singleAxis: "1軸追尾（Y軸まわり）",
};

export const STATION_MISSING_WARNING = "選んだ地上局が見つからないため地球指向で計算しています";
export const SUN_POINTING_ACCESS_WARNING = "この姿勢ではセンサが地球を向く時間が限られるため、地上局アクセスは大きく減ります";

export const INERTIAL_RA_RANGE_DEG = [0, 360] as const;
export const INERTIAL_DEC_RANGE_DEG = [-90, 90] as const;

export function isSatelliteAttitudeMode(v: unknown): v is SatelliteAttitudeMode {
  return typeof v === "string" && (SATELLITE_ATTITUDE_MODES as readonly string[]).includes(v);
}

export function isSolarArrayType(v: unknown): v is SolarArrayType {
  return typeof v === "string" && (SOLAR_ARRAY_TYPES as readonly string[]).includes(v);
}

const ATTITUDE_KEYS = new Set(["mode", "stationName", "inertialRaDeg", "inertialDecDeg"]);

function inRange(v: unknown, [min, max]: readonly [number, number]): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Strict check for the AI session API: an object with a known `mode`;
 * `stationName` a string (or absent/undefined); RA 0–360°, Dec −90–90°.
 * Missing angles take the defaults. Throws with a message naming the field.
 */
export function validateSatelliteAttitude(value: unknown, key = "satelliteAttitude"): SatelliteAttitudeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object`);
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ATTITUDE_KEYS.has(k)) throw new Error(`Unknown ${key} field: ${k}`);
  if (!isSatelliteAttitudeMode(o.mode)) throw new Error(`${key}.mode must be one of ${SATELLITE_ATTITUDE_MODES.join(", ")}`);
  if (o.stationName !== undefined && typeof o.stationName !== "string") throw new Error(`${key}.stationName must be a string`);
  if (o.inertialRaDeg !== undefined && !inRange(o.inertialRaDeg, INERTIAL_RA_RANGE_DEG)) throw new Error(`${key}.inertialRaDeg must be 0–360`);
  if (o.inertialDecDeg !== undefined && !inRange(o.inertialDecDeg, INERTIAL_DEC_RANGE_DEG)) throw new Error(`${key}.inertialDecDeg must be -90–90`);
  return {
    mode: o.mode,
    ...(typeof o.stationName === "string" ? { stationName: o.stationName } : {}),
    inertialRaDeg: (o.inertialRaDeg as number | undefined) ?? DEFAULT_SATELLITE_ATTITUDE.inertialRaDeg,
    inertialDecDeg: (o.inertialDecDeg as number | undefined) ?? DEFAULT_SATELLITE_ATTITUDE.inertialDecDeg,
  };
}

/** Lenient form for stored views: anything unusable becomes null (→ defaults). */
export function sanitizeSatelliteAttitude(value: unknown): SatelliteAttitudeSettings | null {
  try {
    return validateSatelliteAttitude(value);
  } catch {
    return null;
  }
}

export { DEFAULT_SATELLITE_ATTITUDE, DEFAULT_SOLAR_ARRAY_TYPE };
