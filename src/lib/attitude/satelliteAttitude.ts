/**
 * Attitude laws for the editor satellites (SGP4), as a pure function of the
 * ECI (TEME) state and the time. See docs/satellite-attitude.md.
 *
 * Body frame (types.ts): +Z sensor boresight side, +X ram, +Y = Z × X.
 * Every law fixes +Z first and then picks +X as the projection of a "hint"
 * direction onto the plane normal to +Z; when a hint is (nearly) parallel to
 * +Z the next hint in a fixed chain is used, so the result is always a valid
 * rotation and the tie-breaks are deterministic:
 *
 * - lvlh:        +Z nadir, +X = horizontal velocity (W × R, exactly as the
 *                legacy FOV code). Without a usable velocity +X falls back to
 *                celestial north, then ECI +X.
 * - yawSteering: +Z nadir, +X = ± the Sun direction projected onto the local
 *                horizontal plane (so the Sun lies in the X–Z plane and the
 *                panel axis Y is ⟂ Sun). Of the two solutions the one with
 *                +X·(LVLH +X) ≥ 0 (closest to zero yaw) is used; when the Sun
 *                is along ±Z the yaw is undefined and the frame is LVLH.
 * - station:     +Z toward the station while it is at or above its own
 *                minElevationDeg (instant switch), otherwise lvlh. +X as close
 *                to the horizontal velocity as possible.
 * - sun:         panel normal −Z toward the Sun (+Z anti-Sun), +X as close to
 *                the horizontal velocity as possible; when that is parallel to
 *                the Sun line, +Y = −orbit normal (as in LVLH) decides the roll.
 * - inertial:    +Z toward RA/Dec, +X toward celestial north projected onto
 *                the plane ⟂ +Z; at the celestial poles ECI +X is used.
 */
import * as satellite from "satellite.js";
import { sunVectorECI } from "../astronomy";
import type { GroundStation } from "../groundStations";
import type {
  AttitudeQuaternion,
  AttitudeVec3,
  SatelliteAttitudeMode,
  SatelliteAttitudeSettings,
  SolarArrayType,
} from "./types";

const DEG = Math.PI / 180;
/** Below this |sin| between a hint and +Z the hint is treated as parallel. */
const PARALLEL_EPS = 1e-9;

const ECI_X: AttitudeVec3 = Object.freeze({ x: 1, y: 0, z: 0 });
const ECI_Z: AttitudeVec3 = Object.freeze({ x: 0, y: 0, z: 1 });

// ---------------------------------------------------------------- vector math

function v3(x: number, y: number, z: number): AttitudeVec3 {
  return { x, y, z };
}
function dot(a: AttitudeVec3, b: AttitudeVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: AttitudeVec3, b: AttitudeVec3): AttitudeVec3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function norm(a: AttitudeVec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function unit(a: AttitudeVec3): AttitudeVec3 | null {
  const n = norm(a);
  return n > 0 && Number.isFinite(n) ? v3(a.x / n, a.y / n, a.z / n) : null;
}
function finite(a: AttitudeVec3 | undefined | null): a is AttitudeVec3 {
  return !!a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

/** Rotate a body vector into ECI with a unit quaternion. */
export function rotateBodyToEci(q: AttitudeQuaternion, v: AttitudeVec3, out: AttitudeVec3 = v3(0, 0, 0)): AttitudeVec3 {
  // v' = v + w t + q × t, t = 2 q × v
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Rotate an ECI vector into the body frame (inverse rotation). */
export function rotateEciToBody(q: AttitudeQuaternion, v: AttitudeVec3, out: AttitudeVec3 = v3(0, 0, 0)): AttitudeVec3 {
  return rotateBodyToEci({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, v, out);
}

/** Quaternion of the rotation whose matrix columns are the body axes in ECI. */
function quaternionFromAxes(X: AttitudeVec3, Y: AttitudeVec3, Z: AttitudeVec3, out: AttitudeQuaternion): AttitudeQuaternion {
  const m00 = X.x, m01 = Y.x, m02 = Z.x;
  const m10 = X.y, m11 = Y.y, m12 = Z.y;
  const m20 = X.z, m21 = Y.z, m22 = Z.z;
  const trace = m00 + m11 + m22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  // Canonical sign (w ≥ 0) so equal attitudes compare equal.
  const n = Math.hypot(w, x, y, z) * (w < 0 ? -1 : 1);
  out.w = w / n;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/**
 * Body frame with +Z = `z` (unit) and +X = the first hint that is not
 * parallel to +Z, projected onto the plane ⟂ +Z. ECI +X / +Z close the chain,
 * so some hint always works.
 */
function frameFromZ(z: AttitudeVec3, hints: readonly (AttitudeVec3 | null)[], out: AttitudeQuaternion): AttitudeQuaternion {
  for (const h of [...hints, ECI_Z, ECI_X]) {
    if (!h) continue;
    const hu = unit(h);
    if (!hu) continue;
    const d = dot(hu, z);
    const px = v3(hu.x - d * z.x, hu.y - d * z.y, hu.z - d * z.z);
    if (norm(px) <= PARALLEL_EPS) continue;
    const X = unit(px)!;
    const Y = cross(z, X);
    return quaternionFromAxes(X, Y, z, out);
  }
  throw new Error("unreachable: ECI +X and +Z cannot both be parallel to +Z");
}

/**
 * LVLH axes in ECI, built exactly as `buildLVLHFrame` in orbitalCoordinates:
 * W = unit(R × V), +X = unit(W × R̂). Null when the state is degenerate.
 */
function lvlhAxes(pos: AttitudeVec3, vel: AttitudeVec3 | undefined): { nadir: AttitudeVec3 | null; x: AttitudeVec3 | null; w: AttitudeVec3 | null } {
  const r = finite(pos) ? unit(pos) : null;
  const nadir = r ? v3(-r.x, -r.y, -r.z) : null;
  if (!r || !finite(vel)) return { nadir, x: null, w: null };
  const vu = unit(vel);
  if (!vu) return { nadir, x: null, w: null };
  const w = unit(cross(r, vu));
  if (!w || norm(cross(r, vu)) < 1e-12) return { nadir, x: null, w: null };
  return { nadir, x: unit(cross(w, r)), w };
}

// ------------------------------------------------------------ time context

interface PreparedStation {
  ecf: AttitudeVec3;
  /** Geodetic up (as satellite.js' SEZ "Z"). */
  up: AttitudeVec3;
  sinMinElevation: number;
}

/**
 * Everything an attitude law needs that depends only on the time (and the
 * settings), so loops over many satellites at one time step compute it once.
 */
export interface AttitudeTimeContext {
  /** Mode after the station fallback ({@link effectiveAttitudeMode}). */
  mode: SatelliteAttitudeMode;
  gmst: number;
  /** Unit Sun direction in ECI; only for the modes that use it. */
  sunEci: AttitudeVec3 | null;
  station: PreparedStation | null;
  /** Unit boresight for "inertial". */
  inertialZ: AttitudeVec3 | null;
}

/**
 * The mode actually applied: "station" falls back to "lvlh" when the named
 * station is not in `stations` (deleted or renamed). The settings keep the
 * stale name so the UI can say why.
 */
export function effectiveAttitudeMode(
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): SatelliteAttitudeMode {
  if (settings.mode === "station") {
    return stations.some((s) => s.name === settings.stationName) ? "station" : "lvlh";
  }
  return settings.mode;
}

export function prepareAttitudeContext(
  date: Date,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): AttitudeTimeContext {
  const mode = effectiveAttitudeMode(settings, stations);
  const gmst = satellite.gstime(date);
  let station: PreparedStation | null = null;
  if (mode === "station") {
    const gs = stations.find((s) => s.name === settings.stationName)!;
    const lat = gs.latitudeDeg * DEG;
    const lon = gs.longitudeDeg * DEG;
    station = {
      ecf: satellite.geodeticToEcf({ latitude: lat, longitude: lon, height: gs.heightKm }),
      up: v3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)),
      sinMinElevation: Math.sin((gs.minElevationDeg ?? 0) * DEG),
    };
  }
  let inertialZ: AttitudeVec3 | null = null;
  if (mode === "inertial") {
    const ra = (Number.isFinite(settings.inertialRaDeg) ? settings.inertialRaDeg : 0) * DEG;
    const dec = (Number.isFinite(settings.inertialDecDeg) ? settings.inertialDecDeg : 0) * DEG;
    inertialZ = v3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  }
  return {
    mode,
    gmst,
    sunEci: mode === "sun" || mode === "yawSteering" ? sunVectorECI(date) : null,
    station,
    inertialZ,
  };
}

/** Whether the satellite is at or above the station's minimum elevation. */
function stationVisible(pos: AttitudeVec3, gmst: number, st: PreparedStation): boolean {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  // ECI → ECF as satellite.eciToEcf.
  const dx = pos.x * c + pos.y * s - st.ecf.x;
  const dy = -pos.x * s + pos.y * c - st.ecf.y;
  const dz = pos.z - st.ecf.z;
  const range = Math.hypot(dx, dy, dz);
  if (range === 0) return false;
  return dx * st.up.x + dy * st.up.y + dz * st.up.z >= st.sinMinElevation * range;
}

/** {@link satelliteAttitudeEci} with the time-only part precomputed. */
export function satelliteAttitudeFromContext(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3 | undefined,
  ctx: AttitudeTimeContext,
  out: AttitudeQuaternion = { w: 1, x: 0, y: 0, z: 0 },
): AttitudeQuaternion {
  const lv = lvlhAxes(posEciKm, velEciKmS);
  const nadir = lv.nadir ?? v3(0, 0, -1);
  const lvlh = () => frameFromZ(nadir, [lv.x], out);

  switch (ctx.mode) {
    case "yawSteering": {
      const s = ctx.sunEci!;
      const d = dot(s, nadir);
      const sp = v3(s.x - d * nadir.x, s.y - d * nadir.y, s.z - d * nadir.z);
      // Sun along ±Z: any yaw keeps Y ⟂ Sun; keep zero yaw.
      if (norm(sp) <= PARALLEL_EPS) return lvlh();
      const spu = unit(sp)!;
      // Two solutions ±spu; take the one nearer +X of LVLH (zero yaw).
      const sign = lv.x && dot(spu, lv.x) < 0 ? -1 : 1;
      return frameFromZ(nadir, [v3(sign * spu.x, sign * spu.y, sign * spu.z), lv.x], out);
    }
    case "station": {
      const st = ctx.station!;
      if (!lv.nadir || !stationVisible(posEciKm, ctx.gmst, st)) return lvlh();
      const c = Math.cos(ctx.gmst);
      const s = Math.sin(ctx.gmst);
      // ECF → ECI (inverse of the rotation above).
      const stEci = v3(st.ecf.x * c - st.ecf.y * s, st.ecf.x * s + st.ecf.y * c, st.ecf.z);
      const z = unit(v3(stEci.x - posEciKm.x, stEci.y - posEciKm.y, stEci.z - posEciKm.z));
      if (!z) return lvlh();
      return frameFromZ(z, [lv.x, lv.w ? cross(v3(-lv.w.x, -lv.w.y, -lv.w.z), z) : null], out);
    }
    case "sun": {
      const s = ctx.sunEci!;
      const z = v3(-s.x, -s.y, -s.z);
      // Velocity along the Sun line: +Y = −orbit normal decides the roll.
      return frameFromZ(z, [lv.x, lv.w ? cross(v3(-lv.w.x, -lv.w.y, -lv.w.z), z) : null], out);
    }
    case "inertial":
      // Celestial north as the +X hint; at the poles the chain falls to ECI +X.
      return frameFromZ(ctx.inertialZ!, [ECI_Z], out);
    case "lvlh":
    default:
      return lvlh();
  }
}

/** Body → ECI (TEME) attitude quaternion of one satellite at `date`. */
export function satelliteAttitudeEci(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3,
  date: Date,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
  out?: AttitudeQuaternion,
): AttitudeQuaternion {
  return satelliteAttitudeFromContext(posEciKm, velEciKmS, prepareAttitudeContext(date, settings, stations), out);
}

/**
 * Sensor boresight in ECI: body +Z tilted by the mounting angles, in the same
 * order and sign as the legacy LVLH tilts — first `alongTrackDeg` toward +X
 * (about body +Y), then `crossTrackDeg` toward −Y (about body +X), both about
 * the body axes. In body coordinates (sin a, −cos a sin c, cos a cos c).
 */
export function sensorBoresightEci(
  q: AttitudeQuaternion,
  alongTrackDeg: number,
  crossTrackDeg: number,
  out?: AttitudeVec3,
): AttitudeVec3 {
  const a = alongTrackDeg * DEG;
  const c = crossTrackDeg * DEG;
  const body = v3(Math.sin(a), -Math.cos(a) * Math.sin(c), Math.cos(a) * Math.cos(c));
  return rotateBodyToEci(q, body, out);
}

/**
 * Solar array incidence. The panel normal is body −Z. "fixed": cos = max(0,
 * n·s), driveAngleRad = 0. "singleAxis": the array turns about body +Y by
 * `driveAngleRad` (right-handed about +Y; at 0 the normal is −Z, at +π/2 it
 * is −X) to the best angle, so cos = √(1 − (Y·s)²).
 */
export function solarArrayIncidence(
  q: AttitudeQuaternion,
  sunEciUnit: AttitudeVec3,
  type: SolarArrayType,
): { cosIncidence: number; driveAngleRad: number } {
  const s = rotateEciToBody(q, sunEciUnit);
  if (type === "singleAxis") {
    const rho = Math.hypot(s.x, s.z);
    if (rho <= PARALLEL_EPS) return { cosIncidence: 0, driveAngleRad: 0 };
    // n(θ) = R_Y(θ)(0,0,−1) = (−sin θ, 0, −cos θ) ∥ (s.x, 0, s.z)
    return { cosIncidence: Math.min(1, rho), driveAngleRad: Math.atan2(-s.x, -s.z) };
  }
  return { cosIncidence: Math.max(0, Math.min(1, -s.z)), driveAngleRad: 0 };
}

/**
 * Keep the 地上局指向 station reference in step with the scenario's stations
 * (like `reconcileIslEndpoints`). A missing name is *kept* while the mode is
 * "station" so the UI can warn 「選んだ地上局が見つからないため…」 (the
 * effective mode is lvlh meanwhile); it is dropped in other modes. Station
 * mode without a name picks the first station. Returns `settings` itself
 * when nothing changes.
 */
export function reconcileAttitudeStation(
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): SatelliteAttitudeSettings {
  if (settings.mode === "station") {
    if (settings.stationName === undefined && stations.length > 0) {
      return { ...settings, stationName: stations[0].name };
    }
    return settings;
  }
  if (settings.stationName !== undefined && !stations.some((s) => s.name === settings.stationName)) {
    const { stationName: _drop, ...rest } = settings;
    void _drop;
    return rest;
  }
  return settings;
}
