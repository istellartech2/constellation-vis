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
 *
 * 運用スケジュール (optional): station pass > eclipse > base mode, with an
 * optional slew-rate limit between laws; see
 * {@link satelliteAttitudeStateFromContext}. Without it the single-law path
 * is the exact code from before scheduling.
 */
import * as satellite from "satellite.js";
import { sunVectorECI } from "../astronomy";
import { earthShadowFraction } from "../illumination";
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
 * Past satellite state for the slew scan: ECI (TEME) position km and velocity
 * km/s at `ms` (epoch milliseconds), or null when propagation fails.
 */
export type AttitudeStateProvider = (ms: number) => { position: AttitudeVec3; velocity: AttitudeVec3 } | null;

/**
 * The 運用スケジュール part of a context. Present only when the settings can
 * switch between laws over time (pass tracking, an eclipse mode that differs
 * from the base, or a slew rate on a law that switches by itself); absent, the
 * single-law fast path runs exactly as before scheduling existed.
 */
export interface AttitudeSchedule {
  /** Time of this context (epoch ms). */
  ms: number;
  /** Mode in eclipse after the station fallback; null when unused or equal to the base. */
  eclipseMode: SatelliteAttitudeMode | null;
  /** 地上局が見えている間は地上局指向 (the station exists). */
  trackPass: boolean;
  /** deg/s; 0 = instant switches. */
  slewRateDegS: number;
  settings: SatelliteAttitudeSettings;
  stations: readonly GroundStation[];
  /** Contexts of past scan times (shared by every satellite using this context). */
  cache: Map<number, AttitudeTimeContext>;
}

/**
 * Everything an attitude law needs that depends only on the time (and the
 * settings), so loops over many satellites at one time step compute it once.
 */
export interface AttitudeTimeContext {
  /** Base mode after the station fallback ({@link effectiveAttitudeMode}). */
  mode: SatelliteAttitudeMode;
  gmst: number;
  /** Unit Sun direction in ECI; only when some candidate mode uses it. */
  sunEci: AttitudeVec3 | null;
  station: PreparedStation | null;
  /** Unit boresight for "inertial". */
  inertialZ: AttitudeVec3 | null;
  /** Scheduling / slew; absent or null → the single-law path. */
  schedule?: AttitudeSchedule | null;
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
  return modeWithFallback(settings.mode, settings, stations);
}

function modeWithFallback(
  mode: SatelliteAttitudeMode,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): SatelliteAttitudeMode {
  if (mode === "station") {
    return stations.some((s) => s.name === settings.stationName) ? "station" : "lvlh";
  }
  return mode;
}

interface ScheduleParts {
  eclipseMode: SatelliteAttitudeMode | null;
  trackPass: boolean;
  slewRateDegS: number;
}

/** The effective scheduling of `settings`, or null when it is a single law with instant switches. */
function scheduleParts(settings: SatelliteAttitudeSettings, stations: readonly GroundStation[]): ScheduleParts | null {
  const base = effectiveAttitudeMode(settings, stations);
  const stationFound = stations.some((s) => s.name === settings.stationName);
  const eclipse = settings.eclipseMode ? modeWithFallback(settings.eclipseMode, settings, stations) : null;
  const eclipseMode = eclipse && eclipse !== base ? eclipse : null;
  // With base 地上局指向 the pass already points at the station, except in
  // eclipse (an eclipse mode would otherwise win), so keep it only then.
  const trackPass = !!settings.trackStationDuringPass && stationFound && (base !== "station" || !!eclipseMode);
  const rate = settings.maxSlewRateDegS;
  const slewRateDegS = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 0;
  // A single law can still switch by itself: 地上局指向 (局が見えたら局へ) and
  // the yaw-steering 180° flip. Others never switch, so a rate alone is moot.
  const selfSwitching = base === "station" || base === "yawSteering";
  if (!eclipseMode && !trackPass && !(slewRateDegS > 0 && selfSwitching)) return null;
  return { eclipseMode, trackPass, slewRateDegS };
}

/**
 * Whether these settings reduce to the legacy 地球指向 (LVLH) pointing at all
 * times: base mode LVLH (after the station fallback) and no 運用スケジュール
 * that could switch it. Callers that keep a bit-identical LVLH path must test
 * this instead of `settings.mode === "lvlh"`.
 */
export function isPlainLvlhAttitude(
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): boolean {
  return effectiveAttitudeMode(settings, stations) === "lvlh" && !scheduleParts(settings, stations);
}

/** Context counterpart of {@link isPlainLvlhAttitude}. */
export function isPlainLvlhContext(ctx: AttitudeTimeContext): boolean {
  return ctx.mode === "lvlh" && !ctx.schedule;
}

/** Whether the settings switch laws over time (pass / eclipse / slew). */
export function hasAttitudeSchedule(
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): boolean {
  return !!scheduleParts(settings, stations);
}

function buildContext(
  date: Date,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
  mode: SatelliteAttitudeMode,
  parts: ScheduleParts | null,
): AttitudeTimeContext {
  const gmst = satellite.gstime(date);
  const modes = new Set<SatelliteAttitudeMode>([mode]);
  if (parts?.eclipseMode) modes.add(parts.eclipseMode);
  if (parts?.trackPass) modes.add("station");
  let station: PreparedStation | null = null;
  if (modes.has("station")) {
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
  if (modes.has("inertial")) {
    const ra = (Number.isFinite(settings.inertialRaDeg) ? settings.inertialRaDeg : 0) * DEG;
    const dec = (Number.isFinite(settings.inertialDecDeg) ? settings.inertialDecDeg : 0) * DEG;
    inertialZ = v3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  }
  return {
    mode,
    gmst,
    sunEci: modes.has("sun") || modes.has("yawSteering") ? sunVectorECI(date) : null,
    station,
    inertialZ,
    schedule: parts
      ? { ms: date.getTime(), ...parts, settings, stations, cache: new Map() }
      : null,
  };
}

export function prepareAttitudeContext(
  date: Date,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): AttitudeTimeContext {
  return buildContext(date, settings, stations, effectiveAttitudeMode(settings, stations), scheduleParts(settings, stations));
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

/** The single-law attitude (no scheduling): the code path from before 運用スケジュール. */
function singleLawAttitude(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3 | undefined,
  ctx: AttitudeTimeContext,
  out: AttitudeQuaternion,
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

// ------------------------------------------------------------- scheduling

/**
 * The law actually in force, resolved to a discrete state: 地上局指向 split
 * into "station" (局が見えている) and "lvlh", the yaw-steering solution by its
 * sign. A change of key is a switch the slew limit applies to.
 */
type LawKey = "lvlh" | "station" | "sun" | "inertial" | "yaw+" | "yaw-";

/** Why the active mode applies: the base mode, a station pass, or eclipse. */
export type AttitudeModeReason = "base" | "pass" | "eclipse";

interface ResolvedLaw {
  key: LawKey;
  /** The mode chosen by the schedule (before 地上局指向's own fallback to LVLH). */
  mode: SatelliteAttitudeMode;
  reason: AttitudeModeReason;
}

function keyMode(key: LawKey): SatelliteAttitudeMode {
  return key === "yaw+" || key === "yaw-" ? "yawSteering" : key;
}

/** Discrete key of `mode` at this state (station visibility, yaw sign). */
function lawKeyOf(mode: SatelliteAttitudeMode, pos: AttitudeVec3, lv: ReturnType<typeof lvlhAxes>, ctx: AttitudeTimeContext): LawKey {
  switch (mode) {
    case "station":
      return lv.nadir && ctx.station && stationVisible(pos, ctx.gmst, ctx.station) ? "station" : "lvlh";
    case "yawSteering": {
      const nadir = lv.nadir ?? v3(0, 0, -1);
      const s = ctx.sunEci!;
      const d = dot(s, nadir);
      const sp = v3(s.x - d * nadir.x, s.y - d * nadir.y, s.z - d * nadir.z);
      if (norm(sp) <= PARALLEL_EPS) return "lvlh";
      return lv.x && dot(unit(sp)!, lv.x) < 0 ? "yaw-" : "yaw+";
    }
    default:
      return mode;
  }
}

/** Shadow test shared with the rest of the app (`isInEarthShadow`: Sun midpoint behind the limb). */
function inEarthShadow(pos: AttitudeVec3, ms: number): boolean {
  return earthShadowFraction(pos, new Date(ms)) >= 0.5;
}

function resolveLaw(pos: AttitudeVec3, lv: ReturnType<typeof lvlhAxes>, ctx: AttitudeTimeContext, sch: AttitudeSchedule): ResolvedLaw {
  if (sch.trackPass && lv.nadir && ctx.station && stationVisible(pos, ctx.gmst, ctx.station)) {
    return { key: "station", mode: "station", reason: "pass" };
  }
  if (sch.eclipseMode && inEarthShadow(pos, sch.ms)) {
    return { key: lawKeyOf(sch.eclipseMode, pos, lv, ctx), mode: sch.eclipseMode, reason: "eclipse" };
  }
  return { key: lawKeyOf(ctx.mode, pos, lv, ctx), mode: ctx.mode, reason: "base" };
}

/** Attitude of one discrete law (the same frames as {@link singleLawAttitude}). */
function lawAttitude(
  key: LawKey,
  pos: AttitudeVec3,
  lv: ReturnType<typeof lvlhAxes>,
  ctx: AttitudeTimeContext,
  out: AttitudeQuaternion,
): AttitudeQuaternion {
  const nadir = lv.nadir ?? v3(0, 0, -1);
  const lvlh = () => frameFromZ(nadir, [lv.x], out);
  switch (key) {
    case "yaw+":
    case "yaw-": {
      const s = ctx.sunEci!;
      const d = dot(s, nadir);
      const sp = v3(s.x - d * nadir.x, s.y - d * nadir.y, s.z - d * nadir.z);
      if (norm(sp) <= PARALLEL_EPS) return lvlh();
      const spu = unit(sp)!;
      const sign = key === "yaw-" ? -1 : 1;
      return frameFromZ(nadir, [v3(sign * spu.x, sign * spu.y, sign * spu.z), lv.x], out);
    }
    case "station": {
      const st = ctx.station;
      if (!st || !lv.nadir) return lvlh();
      const c = Math.cos(ctx.gmst);
      const s = Math.sin(ctx.gmst);
      const stEci = v3(st.ecf.x * c - st.ecf.y * s, st.ecf.x * s + st.ecf.y * c, st.ecf.z);
      const z = unit(v3(stEci.x - pos.x, stEci.y - pos.y, stEci.z - pos.z));
      if (!z) return lvlh();
      return frameFromZ(z, [lv.x, lv.w ? cross(v3(-lv.w.x, -lv.w.y, -lv.w.z), z) : null], out);
    }
    case "sun": {
      const s = ctx.sunEci!;
      const z = v3(-s.x, -s.y, -s.z);
      return frameFromZ(z, [lv.x, lv.w ? cross(v3(-lv.w.x, -lv.w.y, -lv.w.z), z) : null], out);
    }
    case "inertial":
      return frameFromZ(ctx.inertialZ!, [ECI_Z], out);
    case "lvlh":
    default:
      return lvlh();
  }
}

/** Rotation angle between two unit quaternions (rad, 0–π). */
export function quaternionAngle(a: AttitudeQuaternion, b: AttitudeQuaternion): number {
  const d = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2 * Math.acos(Math.min(1, d));
}

/** Shortest-path slerp, canonical sign (w ≥ 0). */
function slerp(a: AttitudeQuaternion, b: AttitudeQuaternion, f: number, out: AttitudeQuaternion): AttitudeQuaternion {
  let bw = b.w, bx = b.x, by = b.y, bz = b.z;
  let d = a.w * bw + a.x * bx + a.y * by + a.z * bz;
  if (d < 0) {
    d = -d;
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
  }
  let ka: number, kb: number;
  if (d > 0.9999995) {
    ka = 1 - f;
    kb = f;
  } else {
    const th = Math.acos(d);
    const s = Math.sin(th);
    ka = Math.sin((1 - f) * th) / s;
    kb = Math.sin(f * th) / s;
  }
  const w = ka * a.w + kb * bw;
  const x = ka * a.x + kb * bx;
  const y = ka * a.y + kb * by;
  const z = ka * a.z + kb * bz;
  const n = Math.hypot(w, x, y, z) * (w < 0 ? -1 : 1);
  out.w = w / n;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/** `q ⊗ R_Z(angle)`: rotate the body about its own +Z. Canonical sign. */
function rotateAboutBodyZ(q: AttitudeQuaternion, angle: number, out: AttitudeQuaternion): AttitudeQuaternion {
  const c = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);
  const w = q.w * c - q.z * s;
  const x = q.x * c + q.y * s;
  const y = q.y * c - q.x * s;
  const z = q.z * c + q.w * s;
  const n = Math.hypot(w, x, y, z) * (w < 0 ? -1 : 1);
  out.w = w / n;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/** Scan step of the slew search (s). A switch shorter than this can be missed. */
export const SLEW_SCAN_STEP_S = 10;
/** Resolution of the switch time (s). */
export const SLEW_SWITCH_RESOLUTION_S = 0.1;

function contextAt(sch: AttitudeSchedule, ms: number, base: AttitudeTimeContext): AttitudeTimeContext {
  let c = sch.cache.get(ms);
  if (!c) {
    const parts: ScheduleParts = { eclipseMode: sch.eclipseMode, trackPass: sch.trackPass, slewRateDegS: sch.slewRateDegS };
    c = buildContext(new Date(ms), sch.settings, sch.stations, base.mode, parts);
    // Past contexts only resolve laws; they share the parent cache key space.
    c.schedule!.cache = sch.cache;
    sch.cache.set(ms, c);
  }
  return c;
}

interface PastLaw {
  key: LawKey;
  ctx: AttitudeTimeContext;
  pos: AttitudeVec3;
  lv: ReturnType<typeof lvlhAxes>;
}

function pastLaw(ms: number, sch: AttitudeSchedule, base: AttitudeTimeContext, stateAt: AttitudeStateProvider): PastLaw | null {
  const st = stateAt(ms);
  if (!st || !finite(st.position)) return null;
  const ctx = contextAt(sch, ms, base);
  const lv = lvlhAxes(st.position, st.velocity);
  return { key: resolveLaw(st.position, lv, ctx, ctx.schedule!).key, ctx, pos: st.position, lv };
}

/** Slew in progress: from which law, to which, how far along. */
export interface AttitudeSlewInfo {
  fromMode: SatelliteAttitudeMode;
  toMode: SatelliteAttitudeMode;
  /** 0–1. */
  progress: number;
  /** Seconds left. */
  remainingS: number;
  /** Total slew angle (deg). */
  angleDeg: number;
  /** Switch time (epoch ms). */
  switchMs: number;
}

/** Active attitude with the scheduling decision, for readouts (satellite card). */
export interface AttitudeState {
  q: AttitudeQuaternion;
  /** Mode chosen by the schedule (地上局指向 keeps its name while the station is hidden). */
  mode: SatelliteAttitudeMode;
  reason: AttitudeModeReason;
  /** Whether the settings switch laws over time at all. */
  scheduled: boolean;
  slew: AttitudeSlewInfo | null;
}

/**
 * {@link satelliteAttitudeFromContext} with the scheduling decision.
 *
 * Slew (maxSlewRateDegS > 0, `stateAt` given): find the latest switch t_s of
 * the discrete law by scanning back on the absolute 10 s grid over 180°/rate,
 * bisect the bracketing cell (fixed endpoints, so t_s does not depend on the
 * query time) to 0.1 s, and blend from the previous law's attitude to the new
 * one over T = angle(q_prev(t_s), q_new(t_s)) / rate. The yaw-steering flip
 * (two solutions 180° apart) turns about body +Z instead of a slerp, whose
 * shortest path is undefined there. A switch during an unfinished slew starts
 * from the previous law's own attitude (not chained).
 */
export function satelliteAttitudeStateFromContext(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3 | undefined,
  ctx: AttitudeTimeContext,
  stateAt?: AttitudeStateProvider,
  out: AttitudeQuaternion = { w: 1, x: 0, y: 0, z: 0 },
): AttitudeState {
  const sch = ctx.schedule;
  if (!sch) {
    return { q: singleLawAttitude(posEciKm, velEciKmS, ctx, out), mode: ctx.mode, reason: "base", scheduled: false, slew: null };
  }
  const lv = lvlhAxes(posEciKm, velEciKmS);
  const now = resolveLaw(posEciKm, lv, ctx, sch);
  const base: AttitudeState = { q: out, mode: now.mode, reason: now.reason, scheduled: true, slew: null };
  if (!(sch.slewRateDegS > 0) || !stateAt || !finite(posEciKm)) {
    lawAttitude(now.key, posEciKm, lv, ctx, out);
    return base;
  }

  const rate = sch.slewRateDegS;
  const stepMs = Math.min(SLEW_SCAN_STEP_S * 1000, Math.max(1000, (180 / rate) * 1000));
  const windowMs = (180 / rate) * 1000;
  const t = sch.ms;
  // Scan back over the absolute grid (multiples of the step, all < t), so
  // every query time sees the same cells.
  let g = Math.ceil(t / stepMs) * stepMs - stepMs;
  let old: PastLaw | null = null;
  const minMs = t - windowMs - stepMs;
  for (; g >= minMs; g -= stepMs) {
    const p = pastLaw(g, sch, ctx, stateAt);
    if (!p) break;
    if (p.key !== now.key) {
      old = p;
      break;
    }
  }
  if (!old) {
    lawAttitude(now.key, posEciKm, lv, ctx, out);
    return base;
  }
  // Bisect the cell [g, g + step] on fixed endpoints: key(lo) is the old law.
  const oldKey = old.key;
  let lo = g;
  let hi = g + stepMs;
  const resMs = SLEW_SWITCH_RESOLUTION_S * 1000;
  while (hi - lo > resMs) {
    const mid = (lo + hi) / 2;
    const p = pastLaw(mid, sch, ctx, stateAt);
    if (p && p.key === oldKey) lo = mid;
    else hi = mid;
  }
  const ts = Math.min(hi, t);
  const atSwitch = pastLaw(ts, sch, ctx, stateAt);
  const flip = (oldKey === "yaw+" && now.key === "yaw-") || (oldKey === "yaw-" && now.key === "yaw+");
  let angle: number;
  if (flip) angle = Math.PI;
  else if (atSwitch) {
    const qa = lawAttitude(oldKey, atSwitch.pos, atSwitch.lv, atSwitch.ctx, { w: 1, x: 0, y: 0, z: 0 });
    const qb = lawAttitude(now.key, atSwitch.pos, atSwitch.lv, atSwitch.ctx, { w: 1, x: 0, y: 0, z: 0 });
    angle = quaternionAngle(qa, qb);
  } else angle = 0;
  const durationMs = (angle / DEG / rate) * 1000;
  const elapsed = t - ts;
  if (!(durationMs > 0) || elapsed >= durationMs) {
    lawAttitude(now.key, posEciKm, lv, ctx, out);
    return base;
  }
  const f = Math.max(0, elapsed / durationMs);
  const qPrev = lawAttitude(oldKey, posEciKm, lv, ctx, { w: 1, x: 0, y: 0, z: 0 });
  if (flip) rotateAboutBodyZ(qPrev, Math.PI * f, out);
  else slerp(qPrev, lawAttitude(now.key, posEciKm, lv, ctx, { w: 1, x: 0, y: 0, z: 0 }), f, out);
  base.slew = {
    fromMode: keyMode(oldKey),
    toMode: keyMode(now.key),
    progress: f,
    remainingS: (durationMs - elapsed) / 1000,
    angleDeg: angle / DEG,
    switchMs: ts,
  };
  return base;
}

/**
 * {@link satelliteAttitudeEci} with the time-only part precomputed. Without a
 * 運用スケジュール this is the single-law code path unchanged. `stateAt`
 * (past states of this satellite) is needed only for the slew limit; without
 * it, switches are instant.
 */
export function satelliteAttitudeFromContext(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3 | undefined,
  ctx: AttitudeTimeContext,
  out: AttitudeQuaternion = { w: 1, x: 0, y: 0, z: 0 },
  stateAt?: AttitudeStateProvider,
): AttitudeQuaternion {
  if (!ctx.schedule) return singleLawAttitude(posEciKm, velEciKmS, ctx, out);
  return satelliteAttitudeStateFromContext(posEciKm, velEciKmS, ctx, stateAt, out).q;
}

/** Body → ECI (TEME) attitude quaternion of one satellite at `date`. */
export function satelliteAttitudeEci(
  posEciKm: AttitudeVec3,
  velEciKmS: AttitudeVec3,
  date: Date,
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
  out?: AttitudeQuaternion,
  stateAt?: AttitudeStateProvider,
): AttitudeQuaternion {
  return satelliteAttitudeFromContext(posEciKm, velEciKmS, prepareAttitudeContext(date, settings, stations), out, stateAt);
}

/** {@link AttitudeStateProvider} from an SGP4 record (null when propagation fails). */
export function attitudeStateProviderFromSatrec(rec: satellite.SatRec): AttitudeStateProvider {
  return (ms) => {
    try {
      const pv = satellite.propagate(rec, new Date(ms));
      if (!pv?.position || !pv.velocity) return null;
      return { position: pv.position, velocity: pv.velocity };
    } catch {
      return null;
    }
  };
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
 * (like `reconcileIslEndpoints`). A missing name is *kept* while the station
 * is in use (mode or eclipse mode "station", or 地上局が見えている間は地上局指向)
 * so the UI can warn 「選んだ地上局が見つからないため…」 (the station part
 * is ignored meanwhile); otherwise it is dropped. In use without a name picks
 * the first station. Returns `settings` itself
 * when nothing changes.
 */
export function reconcileAttitudeStation(
  settings: SatelliteAttitudeSettings,
  stations: readonly GroundStation[],
): SatelliteAttitudeSettings {
  if (attitudeUsesStation(settings)) {
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

/** Whether any part of the settings points at the station (base, eclipse or pass). */
export function attitudeUsesStation(settings: SatelliteAttitudeSettings): boolean {
  return settings.mode === "station" || settings.eclipseMode === "station" || !!settings.trackStationDuringPass;
}
