/**
 * Vehicle attitude for tabulated trajectory tracks (body → ECEF quaternions).
 *
 * Body frame (see `BodyQuaternion` in ./types.ts): +X nose, +Z belly, +Y = Z × X.
 *
 * Sources, in order of precedence:
 *  1. Tabulated attitude on the samples: slerp (shortest path) between the
 *     two bracketing samples, linear in time.
 *  2. `track.attitudeRules`: each rule's attitude is evaluated from the
 *     current interpolated state, and a rule change is blended from the
 *     previous attitude over `transitionS` (smoothstep weight). The whole
 *     thing is a pure function of time, so scrubbing backwards is exact.
 *  3. No rules: prograde.
 *
 * Velocity-based modes (prograde / retrograde / aoa) blend to "vertical" as
 * the Earth-relative speed falls from 150 to 30 m/s (smoothstep), so a
 * vehicle stands upright on the pad and at a catch, and a zero velocity never
 * produces NaN.
 *
 * Roll reference: belly (+Z) = component of local "down" perpendicular to the
 * nose (belly toward Earth when flying horizontally). Near a vertical nose
 * this is undefined, so a small multiple of the track's downrange direction
 * (perpendicular to the nose) is added before normalising. That is the limit
 * of "down ⟂ nose" for a nose pitching over downrange, so the roll does not
 * snap at lift-off. The downrange direction is the great circle through the
 * first sample and the sample farthest from it (computed once per sample
 * array), evaluated at the current position — stable even when the
 * horizontal velocity reverses (boostback).
 */
import * as THREE from "three";
import type { AttitudeMode, AttitudeRule, BodyQuaternion, TrajectorySample, TrajectoryState, TrajectoryTrack } from "./types";

const DEG2RAD = Math.PI / 180;
export const DEFAULT_ATTITUDE_TRANSITION_S = 8;
/** Earth-relative speed (m/s) below which velocity modes are fully vertical. */
export const LOW_SPEED_VERTICAL_MS = 30;
/** Earth-relative speed (m/s) above which velocity modes are fully velocity-based. */
export const LOW_SPEED_FULL_MS = 150;
/** Weight of the downrange roll fallback relative to |down ⟂ nose| (≈ 1° crossover). */
const ROLL_FALLBACK_WEIGHT = 0.02;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** WGS84 geodetic normal ("up") in ECEF for a geodetic latitude/longitude. */
export function geodeticUpEcef(latDeg: number, lonDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  return out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
}

/** Rotation ENU → ECEF at a geodetic latitude/longitude. */
export function enuToEcefQuaternion(latDeg: number, lonDeg: number, out: THREE.Quaternion): THREE.Quaternion {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  scratchMatrix.set(
    -sLon, -sLat * cLon, cLat * cLon, 0,
    cLon, -sLat * sLon, cLat * sLon, 0,
    0, cLat, sLat, 0,
    0, 0, 0, 1,
  );
  return out.setFromRotationMatrix(scratchMatrix);
}

// ---------------------------------------------------------------------------
// Per-track context (downrange great circle), memoised on the samples array
// ---------------------------------------------------------------------------

interface AttitudeContext {
  /** Unit normal of the downrange great circle, or null when degenerate. */
  planeNormal: THREE.Vector3 | null;
}

const contextCache = new WeakMap<TrajectorySample[], AttitudeContext>();

function contextFor(samples: TrajectorySample[]): AttitudeContext {
  let ctx = contextCache.get(samples);
  if (ctx) return ctx;
  const p0 = samples[0].position;
  let best = -1;
  let far = p0;
  for (const s of samples) {
    const d = (s.position.x - p0.x) ** 2 + (s.position.y - p0.y) ** 2 + (s.position.z - p0.z) ** 2;
    if (d > best) {
      best = d;
      far = s.position;
    }
  }
  const n = new THREE.Vector3(p0.x, p0.y, p0.z).cross(new THREE.Vector3(far.x, far.y, far.z));
  const scale = Math.hypot(p0.x, p0.y, p0.z) * Math.hypot(far.x, far.y, far.z);
  ctx = { planeNormal: scale > 0 && n.length() > 1e-9 * scale ? n.normalize() : null };
  contextCache.set(samples, ctx);
  return ctx;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpDownrange = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();

/** Horizontal downrange unit vector at the state's position (north when unknown). */
function downrangeAt(ctx: AttitudeContext, state: TrajectoryState, up: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (ctx.planeNormal) {
    out.copy(ctx.planeNormal).cross(tmpA.set(state.position.x, state.position.y, state.position.z));
    out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() > 1e-12) return out.normalize();
  }
  // Local north.
  const lat = state.latDeg * DEG2RAD;
  const lon = state.lonDeg * DEG2RAD;
  return out.set(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
}

/** Body → ECEF quaternion from orthonormal nose (X) and belly (Z). */
function quaternionFromNoseBelly(nose: THREE.Vector3, belly: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = tmpC.copy(belly).cross(nose); // Y = Z × X
  scratchMatrix.makeBasis(nose, y, belly);
  return out.setFromRotationMatrix(scratchMatrix);
}

/**
 * Body → ECEF for a given nose direction (unit, ECEF), with the belly from the
 * down-⟂-nose reference plus the downrange fallback (see module comment).
 */
function quaternionFromNose(
  nose: THREE.Vector3,
  up: THREE.Vector3,
  downrange: THREE.Vector3,
  out: THREE.Quaternion,
): THREE.Quaternion {
  // down ⟂ nose = −up + (up·n) n
  const belly = tmpB.copy(nose).multiplyScalar(up.dot(nose)).sub(up);
  // + w · (f − (f·n) n)
  belly.addScaledVector(downrange, ROLL_FALLBACK_WEIGHT);
  belly.addScaledVector(nose, -ROLL_FALLBACK_WEIGHT * downrange.dot(nose));
  if (belly.lengthSq() < 1e-18) {
    // Exactly cancelling (nose ~1° off vertical, leaning uprange): any perpendicular.
    belly.set(1, 0, 0).addScaledVector(nose, -nose.x);
    if (belly.lengthSq() < 1e-12) belly.set(0, 1, 0).addScaledVector(nose, -nose.y);
  }
  belly.normalize();
  return quaternionFromNoseBelly(nose, belly, out);
}

const qVertical = new THREE.Quaternion();
const qMode = new THREE.Quaternion();
const tmpNose = new THREE.Vector3();
const tmpBelly = new THREE.Vector3();

/** Attitude of one rule mode at `state`, written into `out`. */
function modeAttitude(
  mode: AttitudeMode,
  aoaDeg: number,
  state: TrajectoryState,
  ctx: AttitudeContext,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const up = geodeticUpEcef(state.latDeg, state.lonDeg, tmpUp);
  const downrange = downrangeAt(ctx, state, up, tmpDownrange);
  quaternionFromNose(up, up, downrange, qVertical);
  if (mode === "vertical") return out.copy(qVertical);
  const speedMs = state.speedKmS * 1000;
  const w = smoothstep(LOW_SPEED_VERTICAL_MS, LOW_SPEED_FULL_MS, speedMs);
  if (!(w > 0)) return out.copy(qVertical);
  const v = tmpVel.set(state.velocity.x, state.velocity.y, state.velocity.z).normalize();
  if (mode === "prograde") {
    quaternionFromNose(tmpNose.copy(v), up, downrange, qMode);
  } else if (mode === "retrograde") {
    quaternionFromNose(tmpNose.copy(v).negate(), up, downrange, qMode);
  } else {
    // aoa: nose rotated from v toward up in the (v, up) plane; belly faces the flow.
    const uPerp = tmpA.copy(up).addScaledVector(v, -up.dot(v));
    if (uPerp.lengthSq() < 1e-12) {
      quaternionFromNose(tmpNose.copy(v), up, downrange, qMode);
    } else {
      uPerp.normalize();
      const a = aoaDeg * DEG2RAD;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      tmpNose.copy(v).multiplyScalar(ca).addScaledVector(uPerp, sa).normalize();
      tmpBelly.copy(v).multiplyScalar(sa).addScaledVector(uPerp, -ca).normalize();
      quaternionFromNoseBelly(tmpNose, tmpBelly, qMode);
    }
  }
  if (w >= 1) return out.copy(qMode);
  return out.copy(qVertical).slerp(qMode, w);
}

function transitionMs(rule: AttitudeRule): number {
  const s = rule.transitionS ?? DEFAULT_ATTITUDE_TRANSITION_S;
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

const qAccum = new THREE.Quaternion();
const qRule = new THREE.Quaternion();
const qTabA = new THREE.Quaternion();
const qTabB = new THREE.Quaternion();

/** Index i with samples[i].timeMs <= t < samples[i+1].timeMs, clamped to [0, n-2]. */
function findSegment(samples: TrajectorySample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].timeMs <= t) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, samples.length - 2);
}

/**
 * Body → ECEF attitude at `timeMs`. `state` must be the interpolated state at
 * that time (`trajectoryStateAt`). Null when the track has fewer than two
 * samples or the state is not finite. The returned object is fresh unless
 * `out` is given.
 */
export function trajectoryAttitudeAt(
  track: TrajectoryTrack,
  timeMs: number,
  state: TrajectoryState,
  out?: BodyQuaternion,
): BodyQuaternion | null {
  const samples = track.samples;
  if (samples.length < 2) return null;
  if (![state.position.x, state.position.y, state.position.z, state.latDeg, state.lonDeg].every(Number.isFinite)) {
    return null;
  }

  // 1. Tabulated attitude.
  if (samples[0].attitude) {
    const i = findSegment(samples, timeMs);
    const a = samples[i];
    const b = samples[i + 1];
    if (a.attitude && b.attitude) {
      const f = b.timeMs > a.timeMs ? Math.min(1, Math.max(0, (timeMs - a.timeMs) / (b.timeMs - a.timeMs))) : 0;
      qTabA.set(a.attitude.x, a.attitude.y, a.attitude.z, a.attitude.w).normalize();
      qTabB.set(b.attitude.x, b.attitude.y, b.attitude.z, b.attitude.w).normalize();
      qTabA.slerp(qTabB, f); // three.js slerp takes the shortest path
      return writeOut(qTabA, out);
    }
  }

  // 2./3. Rules (default prograde).
  const ctx = contextFor(samples);
  const rules = track.attitudeRules ?? [];
  const startMs = samples[0].timeMs;
  // Start from the last rule whose transition has completed (or that applies from the start).
  let start = -1;
  for (let j = rules.length - 1; j >= 0; j -= 1) {
    const r = rules[j];
    if (r.timeMs > timeMs) continue;
    if (r.timeMs <= startMs || timeMs >= r.timeMs + transitionMs(r)) {
      start = j;
      break;
    }
  }
  if (start >= 0) modeAttitude(rules[start].mode, rules[start].aoaDeg ?? 0, state, ctx, qAccum);
  else modeAttitude("prograde", 0, state, ctx, qAccum);
  for (let j = start + 1; j < rules.length; j += 1) {
    const r = rules[j];
    if (r.timeMs > timeMs) break;
    const dur = transitionMs(r);
    const s = r.timeMs <= startMs || dur === 0 ? 1 : smoothstep(0, 1, (timeMs - r.timeMs) / dur);
    modeAttitude(r.mode, r.aoaDeg ?? 0, state, ctx, qRule);
    qAccum.slerp(qRule, s);
  }
  return writeOut(qAccum, out);
}

function writeOut(q: THREE.Quaternion, out?: BodyQuaternion): BodyQuaternion {
  q.normalize();
  if (out) {
    out.w = q.w;
    out.x = q.x;
    out.y = q.y;
    out.z = q.z;
    return out;
  }
  return { w: q.w, x: q.x, y: q.y, z: q.z };
}

/**
 * Body → ENU quaternion for a nose given by azimuth (clockwise from north)
 * and elevation (above the local horizon), rolled by `rollDeg` about the
 * nose (right-handed about +X) from the belly-down reference. The reference
 * belly is −∂nose/∂elevation = (sin e·sin a, sin e·cos a, −cos e) in ENU:
 * straight down for a horizontal nose, toward the azimuth for a vertical one.
 */
export function enuAnglesToQuaternion(
  azimuthDeg: number,
  elevationDeg: number,
  rollDeg: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const a = azimuthDeg * DEG2RAD;
  const e = elevationDeg * DEG2RAD;
  const r = rollDeg * DEG2RAD;
  const nose = tmpNose.set(Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e));
  const belly0 = tmpBelly.set(Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), -Math.cos(e));
  // Rodrigues about the nose: b = b0 cos r + (n × b0) sin r (b0 ⟂ n).
  const nxb = tmpA.copy(nose).cross(belly0);
  const belly = tmpB.copy(belly0).multiplyScalar(Math.cos(r)).addScaledVector(nxb, Math.sin(r)).normalize();
  return quaternionFromNoseBelly(nose, belly, out);
}

/**
 * Body → ECEF attitude of an object standing upright at a geodetic point
 * (landmarks such as a launch tower): body +X along the local vertical,
 * body +Y horizontal toward bearing `headingDeg` (from north, clockwise),
 * body +Z = X × Y.
 */
export function uprightBodyQuaternion(
  latDeg: number,
  lonDeg: number,
  headingDeg: number,
  out: BodyQuaternion = { w: 1, x: 0, y: 0, z: 0 },
): BodyQuaternion {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const h = (Number.isFinite(headingDeg) ? headingDeg : 0) * DEG2RAD;
  const up = tmpA.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const east = tmpB.set(-Math.sin(lon), Math.cos(lon), 0);
  const north = tmpC.set(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
  const y = tmpVel.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  const z = tmpDownrange.crossVectors(up, y);
  scratchMatrix.makeBasis(up, y, z);
  return writeOut(qAccum.setFromRotationMatrix(scratchMatrix), out);
}
