/**
 * Satellite attitude laws applied to the editor satellites (SGP4). One global
 * setting today (like the sensor FOV pointing it generalises); the settings
 * object is passed per satellite so per-shell attitude later is plumbing only.
 *
 * Body frame: +Z = sensor boresight side (nadir under Earth pointing),
 * +X = ram (velocity side), +Y = Z × X (≈ −orbit normal). Solar array wings
 * along ±Y; the panel face normal is −Z when body-fixed, or rotates about Y
 * with a single-axis drive.
 */

/**
 * - "lvlh":        地球指向（LVLH） — +Z nadir, +X along velocity (today's behaviour).
 * - "yawSteering": 地球指向＋ヨー制御 — nadir, yawed about Z so the Sun lies in the X–Z plane.
 * - "station":     地上局指向 — +Z toward the named station while it is above its
 *                  minimum elevation, otherwise "lvlh".
 * - "sun":         太陽指向 — panel normal (−Z) toward the Sun, +X as close to velocity as possible.
 * - "inertial":    慣性指向 — +Z toward a fixed RA/Dec.
 */
export type SatelliteAttitudeMode = "lvlh" | "yawSteering" | "station" | "sun" | "inertial";

export interface SatelliteAttitudeSettings {
  /** 基本の姿勢. */
  mode: SatelliteAttitudeMode;
  /** Ground station name for "station" and for `trackStationDuringPass` (reconciled like the ISL endpoints). */
  stationName?: string;
  /** Boresight right ascension / declination for "inertial", degrees. */
  inertialRaDeg: number;
  inertialDecDeg: number;
  /**
   * Scheduling (運用スケジュール). Priority, highest first:
   *  1. `trackStationDuringPass` and the station is above its minimum
   *     elevation → "station" pointing;
   *  2. `eclipseMode` set and the satellite is in Earth's shadow → that mode;
   *  3. otherwise `mode`.
   * Undefined fields keep today's single-mode behaviour.
   */
  eclipseMode?: SatelliteAttitudeMode;
  trackStationDuringPass?: boolean;
  /**
   * Maximum slew rate, deg/s. Undefined or ≤ 0 → mode switches are instant.
   * When set, a switch blends from the previous mode's attitude to the new
   * one at this rate (still a pure function of time, so scrubbing is exact).
   */
  maxSlewRateDegS?: number;
}

/**
 * Per-shell / per-satellite override stored with the scenario
 * (`SatelliteSpec.attitude`, constellation shell TOML keys `attitude_*`).
 * Any field left undefined inherits the global setting (通信タブ). An
 * override with `mode` set replaces the whole attitude law.
 */
export type SatelliteAttitudeOverride = Partial<SatelliteAttitudeSettings>;

/** 固定（−Z面） / 1軸追尾（Y軸まわり）. */
export type SolarArrayType = "fixed" | "singleAxis";

export const DEFAULT_SATELLITE_ATTITUDE: SatelliteAttitudeSettings = Object.freeze({
  mode: "lvlh",
  inertialRaDeg: 0,
  inertialDecDeg: 0,
}) as SatelliteAttitudeSettings;

export const DEFAULT_SOLAR_ARRAY_TYPE: SolarArrayType = "fixed";

/** Unit quaternion rotating body vectors into ECI (TEME, as satellite.js). */
export interface AttitudeQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface AttitudeVec3 {
  x: number;
  y: number;
  z: number;
}
