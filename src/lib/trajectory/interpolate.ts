/**
 * Cubic Hermite interpolation of tabulated ECEF trajectories.
 *
 * Tangents are the sample velocities when the file supplied them, otherwise
 * non-uniform three-point finite differences (exact for quadratic motion,
 * one-sided at the ends). Tangents are computed on the fly from neighbouring
 * samples, so nothing is cached on the track and per-frame calls allocate only
 * the returned state.
 */
import * as satellite from "satellite.js";
import type { TrajectorySample, TrajectoryState, TrajectoryTrack } from "./types";

const RAD2DEG = 180 / Math.PI;
/** Point cap of a drawn path (see sampleTrajectoryPath). */
const DEFAULT_MAX_POINTS = 50_000;
const DEFAULT_MAX_TURN_DEG = 0.2;
const DEFAULT_MAX_SAG_KM = 0.001;
const MAX_PIECES_PER_SEGMENT = 256;

/** Index i such that samples[i].timeMs <= t <= samples[i+1].timeMs (assumes t inside the span). */
function findSegment(samples: TrajectorySample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].timeMs <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Writes the tangent (km/s) of sample k into out[offset..offset+2]. */
function tangentAt(samples: TrajectorySample[], k: number, out: Float64Array, offset: number): void {
  const s = samples[k];
  if (s.velocity) {
    out[offset] = s.velocity.x;
    out[offset + 1] = s.velocity.y;
    out[offset + 2] = s.velocity.z;
    return;
  }
  const n = samples.length;
  if (k === 0 || k === n - 1) {
    const a = k === 0 ? samples[0] : samples[n - 2];
    const b = k === 0 ? samples[1] : samples[n - 1];
    const h = (b.timeMs - a.timeMs) / 1000;
    out[offset] = (b.position.x - a.position.x) / h;
    out[offset + 1] = (b.position.y - a.position.y) / h;
    out[offset + 2] = (b.position.z - a.position.z) / h;
    return;
  }
  const p0 = samples[k - 1].position;
  const p1 = s.position;
  const p2 = samples[k + 1].position;
  const h0 = (s.timeMs - samples[k - 1].timeMs) / 1000;
  const h1 = (samples[k + 1].timeMs - s.timeMs) / 1000;
  // f'(t_k) ≈ [h0²·f₊ − h1²·f₋ + (h1² − h0²)·f_k] / (h0·h1·(h0 + h1))
  const a = (h0 * h0) / (h0 * h1 * (h0 + h1));
  const b = (h1 * h1) / (h0 * h1 * (h0 + h1));
  const c = b - a;
  out[offset] = a * p2.x - b * p0.x + c * p1.x;
  out[offset + 1] = a * p2.y - b * p0.y + c * p1.y;
  out[offset + 2] = a * p2.z - b * p0.z + c * p1.z;
}

const scratchTangents = new Float64Array(6);

/**
 * Evaluate the Hermite segment i at time t. Writes position (km) into
 * pos[po..po+2] and, when vel is given, velocity (km/s) into vel[vo..vo+2].
 */
function evalSegment(
  samples: TrajectorySample[],
  i: number,
  t: number,
  pos: Float64Array,
  po: number,
  vel?: Float64Array,
  vo = 0,
): void {
  const a = samples[i];
  const b = samples[i + 1];
  const dt = (b.timeMs - a.timeMs) / 1000;
  const s = Math.min(1, Math.max(0, (t - a.timeMs) / (b.timeMs - a.timeMs)));
  tangentAt(samples, i, scratchTangents, 0);
  tangentAt(samples, i + 1, scratchTangents, 3);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = (s3 - 2 * s2 + s) * dt;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = (s3 - s2) * dt;
  const pa = a.position;
  const pb = b.position;
  const m = scratchTangents;
  pos[po] = h00 * pa.x + h10 * m[0] + h01 * pb.x + h11 * m[3];
  pos[po + 1] = h00 * pa.y + h10 * m[1] + h01 * pb.y + h11 * m[4];
  pos[po + 2] = h00 * pa.z + h10 * m[2] + h01 * pb.z + h11 * m[5];
  if (!vel) return;
  // d/dt = (d/ds) / dt
  const d00 = (6 * s2 - 6 * s) / dt;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = (-6 * s2 + 6 * s) / dt;
  const d11 = 3 * s2 - 2 * s;
  vel[vo] = d00 * pa.x + d10 * m[0] + d01 * pb.x + d11 * m[3];
  vel[vo + 1] = d00 * pa.y + d10 * m[1] + d01 * pb.y + d11 * m[4];
  vel[vo + 2] = d00 * pa.z + d10 * m[2] + d01 * pb.z + d11 * m[5];
}

const scratchPos = new Float64Array(3);
const scratchVel = new Float64Array(3);

/**
 * Allocation-free ECEF position (km) and, when `outVel` is given, velocity
 * (km/s) at `timeMs`, written as x, y, z into the given arrays. Same Hermite
 * interpolation as {@link trajectoryStateAt}. False outside the span.
 */
export function trajectoryEcefAt(
  track: TrajectoryTrack,
  timeMs: number,
  outPos: Float64Array,
  outVel?: Float64Array,
): boolean {
  const samples = track.samples;
  const n = samples.length;
  if (n < 2 || !(timeMs >= samples[0].timeMs) || !(timeMs <= samples[n - 1].timeMs)) return false;
  const i = findSegment(samples, timeMs);
  evalSegment(samples, Math.min(i, n - 2), timeMs, outPos, 0, outVel, 0);
  return true;
}

/** Interpolated state, or null when timeMs is outside [first, last] sample time. */
export function trajectoryStateAt(track: TrajectoryTrack, timeMs: number): TrajectoryState | null {
  const samples = track.samples;
  const n = samples.length;
  if (n < 2 || !(timeMs >= samples[0].timeMs) || !(timeMs <= samples[n - 1].timeMs)) return null;
  const i = findSegment(samples, timeMs);
  evalSegment(samples, Math.min(i, n - 2), timeMs, scratchPos, 0, scratchVel, 0);
  const position = { x: scratchPos[0], y: scratchPos[1], z: scratchPos[2] };
  const velocity = { x: scratchVel[0], y: scratchVel[1], z: scratchVel[2] };
  // eciToGeodetic with gmst = 0 is the ECEF → WGS84 geodetic conversion.
  const geo = satellite.eciToGeodetic(position, 0);
  let lonDeg = geo.longitude * RAD2DEG;
  if (lonDeg > 180) lonDeg -= 360;
  else if (lonDeg < -180) lonDeg += 360;
  return {
    timeMs,
    position,
    velocity,
    latDeg: geo.latitude * RAD2DEG,
    lonDeg,
    altKm: geo.height,
    speedKmS: Math.hypot(velocity.x, velocity.y, velocity.z),
  };
}

/** Angle (rad) between two 3-vectors given as components; 0 when either is (near) zero. */
function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (!(la > 1e-12) || !(lb > 1e-12)) return 0;
  const c = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

export interface TrajectoryPathOptions {
  /** Hard cap on the number of points (default {@link DEFAULT_MAX_POINTS}). */
  maxPoints?: number;
  /** Optional time cap: consecutive points at most this far apart (ms). Off by default. */
  maxStepMs?: number;
  /** Largest turn (deg) of the path between consecutive points (default 0.2). */
  maxTurnDeg?: number;
  /** Largest chord-to-curve deviation (km) between consecutive points (default 0.001, 1 m). */
  maxSagKm?: number;
}

/**
 * Densified path for drawing: every source sample plus Hermite-interpolated
 * points where a straight chord would show, so the polyline follows the
 * same curve as the vehicle (positions are ECEF km, xyz interleaved;
 * timesMs strictly increasing).
 *
 * Refinement is by shape, not time: a segment whose path turns by θ over a
 * chord of length L is split into m pieces with θ/m ≤ maxTurnDeg and
 * L·θ/(8m²) ≤ maxSagKm (the sagitta of each piece), at most
 * MAX_PIECES_PER_SEGMENT. Straight coasts and the ~1° steps of a 20 s orbit
 * table get few points; a flip or a bank turn tabulated at 1 s gets many.
 * When the total would exceed maxPoints (default 50 000, ~7 MB of line
 * buffers), both tolerances are relaxed together until it fits, so the
 * tightest curves keep their share; source samples are never dropped unless
 * the table alone has at least maxPoints rows (then it is decimated, both
 * endpoints kept). An explicit maxStepMs also caps the time step.
 */
export function sampleTrajectoryPath(
  track: TrajectoryTrack,
  options: TrajectoryPathOptions = {},
): { timesMs: Float64Array; positions: Float64Array } {
  const samples = track.samples;
  const n = samples.length;
  const maxPoints = Math.max(2, Math.floor(options.maxPoints ?? DEFAULT_MAX_POINTS));
  const maxStepMs = options.maxStepMs && options.maxStepMs > 0 ? options.maxStepMs : 0;
  const maxTurnRad = ((options.maxTurnDeg && options.maxTurnDeg > 0 ? options.maxTurnDeg : DEFAULT_MAX_TURN_DEG) * Math.PI) / 180;
  const maxSagKm = options.maxSagKm && options.maxSagKm > 0 ? options.maxSagKm : DEFAULT_MAX_SAG_KM;

  if (n === 0) return { timesMs: new Float64Array(0), positions: new Float64Array(0) };
  if (n === 1) {
    const p = samples[0].position;
    return { timesMs: Float64Array.of(samples[0].timeMs), positions: Float64Array.of(p.x, p.y, p.z) };
  }

  if (n >= maxPoints) {
    const count = maxPoints;
    const timesMs = new Float64Array(count);
    const positions = new Float64Array(count * 3);
    for (let j = 0; j < count; j += 1) {
      const s = samples[Math.round((j * (n - 1)) / (count - 1))];
      timesMs[j] = s.timeMs;
      positions[j * 3] = s.position.x;
      positions[j * 3 + 1] = s.position.y;
      positions[j * 3 + 2] = s.position.z;
    }
    return { timesMs, positions };
  }

  // Per segment: turn θ (tangent → chord → tangent) and θ·L, the shape measures.
  const turn = new Float64Array(n - 1);
  const turnLength = new Float64Array(n - 1);
  const timeExtras = new Int32Array(n - 1);
  const tangents = new Float64Array(6);
  for (let i = 0; i < n - 1; i += 1) {
    const a = samples[i].position;
    const b = samples[i + 1].position;
    const cx = b.x - a.x;
    const cy = b.y - a.y;
    const cz = b.z - a.z;
    const length = Math.hypot(cx, cy, cz);
    if (maxStepMs > 0) {
      const span = samples[i + 1].timeMs - samples[i].timeMs;
      timeExtras[i] = Math.max(0, Math.ceil(span / maxStepMs) - 1);
    }
    if (!(length > 0)) continue;
    tangentAt(samples, i, tangents, 0);
    tangentAt(samples, i + 1, tangents, 3);
    const theta =
      angleBetween(tangents[0], tangents[1], tangents[2], cx, cy, cz) +
      angleBetween(cx, cy, cz, tangents[3], tangents[4], tangents[5]);
    turn[i] = theta;
    turnLength[i] = theta * length;
  }

  const extras = new Int32Array(n - 1);
  const fill = (relax: number): number => {
    const turnLimit = maxTurnRad * relax;
    const sagLimit = 8 * maxSagKm * relax;
    let total = 0;
    for (let i = 0; i < n - 1; i += 1) {
      const pieces = Math.max(
        1,
        Math.ceil(turn[i] / turnLimit),
        Math.ceil(Math.sqrt(turnLength[i] / sagLimit)),
      );
      const e = Math.max(Math.min(pieces, MAX_PIECES_PER_SEGMENT) - 1, timeExtras[i]);
      extras[i] = e;
      total += e;
    }
    return total;
  };
  const budget = maxPoints - n;
  let totalExtra = fill(1);
  for (let relax = 1.5, tries = 0; totalExtra > budget && tries < 24; relax *= 1.5, tries += 1) {
    totalExtra = fill(relax);
  }
  if (totalExtra > budget) {
    // Only an explicit maxStepMs (or a tiny maxPoints) can get here: scale down evenly.
    const ratio = budget / totalExtra;
    totalExtra = 0;
    for (let i = 0; i < n - 1; i += 1) {
      extras[i] = Math.floor(extras[i] * ratio);
      totalExtra += extras[i];
    }
  }

  const count = n + totalExtra;
  const timesMs = new Float64Array(count);
  const positions = new Float64Array(count * 3);
  let k = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const a = samples[i];
    timesMs[k] = a.timeMs;
    positions[k * 3] = a.position.x;
    positions[k * 3 + 1] = a.position.y;
    positions[k * 3 + 2] = a.position.z;
    k += 1;
    const e = extras[i];
    const span = samples[i + 1].timeMs - a.timeMs;
    for (let j = 1; j <= e; j += 1) {
      const t = a.timeMs + (span * j) / (e + 1);
      timesMs[k] = t;
      evalSegment(samples, i, t, positions, k * 3);
      k += 1;
    }
  }
  const last = samples[n - 1];
  timesMs[k] = last.timeMs;
  positions[k * 3] = last.position.x;
  positions[k * 3 + 1] = last.position.y;
  positions[k * 3 + 2] = last.position.z;
  return { timesMs, positions };
}
