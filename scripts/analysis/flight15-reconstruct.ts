/**
 * Starship Flight 15 — reconstruction of the booster and ship trajectories from
 * public information (event times, orbit, landing/catch narrative). NOT flight
 * data: webcast telemetry, launch azimuth, TLEs, the booster impact point and
 * the OLP-2 pad coordinates were not published, so those are estimated here.
 * See docs/demos/flight15.md for what is sourced and what is estimated.
 *
 * Run:  bun scripts/analysis/flight15-reconstruct.ts
 * Out:  public/demos/flight15/booster.csv, public/demos/flight15/ship.csv
 *
 * Method (deterministic, no random numbers):
 *  - 3D point mass in an Earth-centred inertial frame (z = Earth axis, x at
 *    GMST(T0) → ECEF via θ(t) = GMST(T0) + ω t), J2 gravity, piecewise
 *    exponential atmosphere, RK4.
 *  - Ascent: stack thrust/throttle model with a pitch kick + gravity turn to
 *    hot staging (T+141 s). The ship's track point is its own base: booster
 *    base + stack axis · 72.3 m while stacked, and its ascent integration
 *    starts from that state, so it separates continuously. Ship: linear-tangent
 *    pitch law and yaw steering into the i = 30.5° plane, shot (Newton) onto
 *    the published orbit: coast to apogee, ≈92 m/s insertion burn at
 *    T+26:10–26:30 → 276 × 278 km.
 *  - Booster return: boostback (T+2:26–3:02) solved by Newton so the ballistic
 *    arc (with drag) falls toward the OFFSHORE contingency point (the normal
 *    Super Heavy profile; the late divert to the tower was cancelled by the
 *    automatic abort). Landing burn there with continuous, thrust/tilt-limited
 *    acceleration profiles, hover above the water, shut-down, free fall.
 *  - Ship orbit: numerical propagation (J2 + drag) for ~22 h; a retrograde
 *    deorbit burn at 21:35:57–21:36:07 solved so the trajectory crosses the
 *    entry interface at 22:10:46; lifting entry (physics) to a gate 150 s
 *    before transonic; then a kinematic terminal phase (speed / altitude
 *    fitted to the published transonic, subsonic, landing burn and catch
 *    times) with ONE bank-limited right turn (continuous heading rate) that
 *    crosses the coast north of South Padre Island and ends at the tower.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as satellite from "satellite.js";
import * as THREE from "three";
import { parseTrajectoryFile, toTrajectoryTrack } from "../../src/lib/trajectory/parse";
import { trajectoryStateAt } from "../../src/lib/trajectory/interpolate";
import { trajectoryAttitudeAt } from "../../src/lib/trajectory/attitude";
import type { AttitudeRule, TrajectoryTrack } from "../../src/lib/trajectory/types";

// ---------------------------------------------------------------------------
// Published facts (sources in docs/demos/flight15.md)
// ---------------------------------------------------------------------------

export const EPOCH_ISO = "2026-11-13T22:47:36Z";
const EPOCH_MS = Date.parse(EPOCH_ISO);
const hms = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;

/** Published event times, seconds after lift-off. */
export const T = {
  maxQ: hms(0, 0, 58),
  meco: hms(0, 2, 19),
  hotStaging: hms(0, 2, 21),
  boostbackStart: hms(0, 2, 26),
  boostbackEnd: hms(0, 3, 2),
  boosterLandingBurn: hms(0, 6, 10),
  catchAbort: hms(0, 6, 35),
  seco: hms(0, 8, 9),
  insertionStart: hms(0, 26, 10),
  insertionEnd: hms(0, 26, 30),
  starlinkStart: hms(0, 35, 1),
  starlinkEnd: hms(1, 17, 40),
  deorbitStart: hms(21, 35, 57),
  deorbitEnd: hms(21, 36, 7),
  entry: hms(22, 10, 46),
  transonic: hms(22, 29, 34),
  subsonic: hms(22, 30, 13),
  shipLandingBurn: hms(22, 32, 16),
  flip: hms(22, 32, 18),
  shipCatch: hms(22, 32, 28),
} as const;

/** Published orbit after the insertion burn (km above the equatorial radius; deg). */
export const ORBIT = { perigeeKm: 276, apogeeKm: 278, inclinationDeg: 30.5, insertionDvKmS: 0.092 } as const;

// ---------------------------------------------------------------------------
// Estimates (all flagged in the doc)
// ---------------------------------------------------------------------------

/** OLP-2 at Starbase — ESTIMATED (exact pad coordinates were not published). */
export const PAD = { latDeg: 25.9963, lonDeg: -97.1567 } as const;
/**
 * Height of the vehicle base above the drawn ground at lift-off, km. The globe
 * and the launch-site imagery are the WGS84 ellipsoid (h = 0, imagery +2 m)
 * with no geoid or terrain, and the launch-tower landmark's origin is the
 * launch-mount axis at ground level, so the pad is h = 0 in this display
 * convention (true ellipsoidal height of the ground at Boca Chica is about
 * −25 m because of the geoid; using it would sink the pad below the imagery).
 */
const PAD_BASE_ALT_KM = 0;
/** Ship base height when held by the tower arms (estimate), km. */
const SHIP_CATCH_ALT_KM = 0.065;
/**
 * Booster offshore contingency (aim) point — ESTIMATED (not published): ~3.5 km
 * east of the pad, i.e. ~2.5–3 km off the Boca Chica beach. Far enough out that
 * a booster failing during the landing burn falls clear of the pad and the
 * beach, close enough that the normal late divert to the tower is a ~3–4 km
 * translation during the landing burn.
 */
export const BOOSTER_END = { latDeg: 25.9945, lonDeg: -97.1217 } as const;
/** Entry interface altitude used for the "entry" event (convention), km. */
export const ENTRY_INTERFACE_KM = 100;

// ---------------------------------------------------------------------------
// Constants and small vector helpers
// ---------------------------------------------------------------------------

const MU = 398600.4418; // km^3/s^2
const RE = 6378.137; // km
const FLAT = 1 / 298.257223563;
const J2 = 1.08262668e-3;
const OMEGA = 7.292115e-5; // rad/s
const G0 = 9.80665e-3; // km/s^2
const DEG = Math.PI / 180;
const THETA0 = satellite.gstime(new Date(EPOCH_MS));

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / norm(a));
const axpy = (a: V3, s: number, b: V3): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

const theta = (t: number) => THETA0 + OMEGA * t;
function rotZ(a: V3, ang: number): V3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [c * a[0] - s * a[1], s * a[0] + c * a[1], a[2]];
}
const ecefToEci = (r: V3, t: number) => rotZ(r, theta(t));
const eciToEcef = (r: V3, t: number) => rotZ(r, -theta(t));
const omegaCross = (r: V3): V3 => [-OMEGA * r[1], OMEGA * r[0], 0];
/** Earth-relative velocity (ECI axes). */
const vRelEci = (r: V3, v: V3) => sub(v, omegaCross(r));
/** ECEF (Earth-relative) velocity from an ECI state. */
const vEcefOf = (r: V3, v: V3, t: number) => eciToEcef(vRelEci(r, v), t);

interface Lla {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}
function llaToEcef(lla: Lla): V3 {
  const p = satellite.geodeticToEcf({ latitude: lla.latDeg * DEG, longitude: lla.lonDeg * DEG, height: lla.altKm });
  return [p.x, p.y, p.z];
}
function ecefToLla(r: V3): Lla {
  const g = satellite.eciToGeodetic({ x: r[0], y: r[1], z: r[2] }, 0);
  let lon = g.longitude / DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { latDeg: g.latitude / DEG, lonDeg: lon, altKm: g.height };
}
/** East / north / up unit vectors (ECEF) at a geodetic lat/lon. */
function enu(latDeg: number, lonDeg: number): { e: V3; n: V3; u: V3 } {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return {
    e: [-Math.sin(lo), Math.cos(lo), 0],
    n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}
/** Fast altitude for the atmosphere model (≲0.1 km from geodetic). */
function altFast(r: V3): number {
  const rn = norm(r);
  const s = r[2] / rn;
  return rn - RE * (1 - FLAT * s * s);
}

// ---------------------------------------------------------------------------
// Atmosphere (piecewise exponential, Vallado table) and speed of sound
// ---------------------------------------------------------------------------

const ATMO: [number, number, number][] = [
  // base km, density kg/m^3, scale height km
  [0, 1.225, 7.249],
  [25, 3.899e-2, 6.349],
  [30, 1.774e-2, 6.682],
  [40, 3.972e-3, 7.554],
  [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714],
  [70, 8.77e-5, 6.549],
  [80, 1.905e-5, 5.799],
  [90, 3.396e-6, 5.382],
  [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473],
  [130, 8.484e-9, 12.636],
  [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74],
  [200, 2.789e-10, 37.105],
  [250, 7.248e-11, 45.546],
  [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298],
];
export function density(hKm: number): number {
  if (hKm > 1000) return 0;
  const h = Math.max(0, hKm);
  let i = ATMO.length - 1;
  while (i > 0 && ATMO[i][0] > h) i -= 1;
  const [h0, rho0, H] = ATMO[i];
  return rho0 * Math.exp(-(h - h0) / H);
}
/** Speed of sound (km/s), US-76 temperature profile up to 47 km, isothermal above. */
export function speedOfSound(hKm: number): number {
  const h = Math.max(0, hKm);
  let temp: number;
  if (h < 11) temp = 288.15 - 6.5 * h;
  else if (h < 20) temp = 216.65;
  else if (h < 32) temp = 216.65 + (h - 20);
  else if (h < 47) temp = 228.65 + 2.8 * (h - 32);
  else temp = 270.65;
  return Math.sqrt(1.4 * 287.05 * temp) / 1000;
}

// ---------------------------------------------------------------------------
// Dynamics
// ---------------------------------------------------------------------------

function gravity(r: V3): V3 {
  const r2 = dot(r, r);
  const rn = Math.sqrt(r2);
  const k = (1.5 * J2 * MU * RE * RE) / (r2 * r2 * rn);
  const zr2 = (5 * r[2] * r[2]) / r2;
  const c = -MU / (r2 * rn);
  return [c * r[0] + k * r[0] * (zr2 - 1), c * r[1] + k * r[1] * (zr2 - 1), c * r[2] + k * r[2] * (zr2 - 3)];
}
/** Drag acceleration (km/s^2) for ballistic coefficient beta = m/(Cd·A) in kg/m^2. */
function drag(r: V3, v: V3, beta: number): V3 {
  const rho = density(altFast(r));
  if (rho === 0) return [0, 0, 0];
  const vr = vRelEci(r, v);
  return scale(vr, (-0.5 * rho * 1000 * norm(vr)) / beta);
}

interface State {
  t: number;
  r: V3; // ECI km
  v: V3; // ECI km/s
}
type AccelFn = (t: number, r: V3, v: V3) => V3;

function rk4(s: State, dt: number, f: AccelFn): State {
  const { t, r, v } = s;
  const a1 = f(t, r, v);
  const r2 = axpy(r, dt / 2, v);
  const v2 = axpy(v, dt / 2, a1);
  const a2 = f(t + dt / 2, r2, v2);
  const r3 = axpy(r, dt / 2, v2);
  const v3 = axpy(v, dt / 2, a2);
  const a3 = f(t + dt / 2, r3, v3);
  const r4 = axpy(r, dt, v3);
  const v4 = axpy(v, dt, a3);
  const a4 = f(t + dt, r4, v4);
  return {
    t: t + dt,
    r: add(r, scale(add(add(v, scale(add(v2, v3), 2)), v4), dt / 6)),
    v: add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), dt / 6)),
  };
}
/** Integrate from s to tEnd with step ≤ dt, calling `onStep` after every step. */
function propagate(s: State, tEnd: number, dt: number, f: AccelFn, onStep?: (s: State) => void): State {
  let cur = s;
  while (cur.t < tEnd - 1e-9) {
    const h = Math.min(dt, tEnd - cur.t);
    cur = rk4(cur, h, f);
    onStep?.(cur);
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Ascent (stack to hot staging, then ship to SECO)
// ---------------------------------------------------------------------------

const PAD_ECEF = llaToEcef({ ...PAD, altKm: PAD_BASE_ALT_KM });
const LAUNCH_AZ_DEG = 180 - Math.asin(Math.cos(ORBIT.inclinationDeg * DEG) / Math.cos(PAD.latDeg * DEG)) / DEG;

/** Stack (Booster + Ship) parameters — ESTIMATED. */
const STACK = {
  massT: 5000, // lift-off mass, t
  burnFraction: 0.63, // propellant fraction burned by MECO
  cdA: 0.5 * 63.6, // m^2 (9 m diameter)
  maxAccelG: 3.2,
  bucket: { down0: 44, down1: 52, up0: 64, up1: 72, depth: 0.22 }, // max-Q throttle bucket
  kickStart: 10,
  kickEnd: 20,
};

interface AscentParams {
  kickDeg: number;
  tw0: number;
}

function stackThrottle(t: number): number {
  const b = STACK.bucket;
  return 1 - b.depth * (smoothstep(b.down0, b.down1, t) - smoothstep(b.up0, b.up1, t));
}
function stackMassKg(t: number): number {
  return STACK.massT * 1000 * (1 - (STACK.burnFraction * Math.min(t, T.meco)) / T.meco);
}

function stackAccel(p: AscentParams): AccelFn {
  return (t, r, v) => {
    const g = gravity(r);
    const m = stackMassKg(t);
    const d = drag(r, v, m / STACK.cdA);
    if (t >= T.meco) return add(g, d);
    const aT = Math.min((p.tw0 * G0 * stackThrottle(t) * STACK.massT * 1000) / m, STACK.maxAccelG * G0);
    const rE = eciToEcef(r, t);
    const lla = ecefToLla(rE);
    const { e, n, u } = enu(lla.latDeg, lla.lonDeg);
    const az = LAUNCH_AZ_DEG * DEG;
    const dr = add(scale(n, Math.cos(az)), scale(e, Math.sin(az)));
    const kick = p.kickDeg * DEG * smoothstep(STACK.kickStart, STACK.kickEnd, t);
    let dirE = add(scale(u, Math.cos(kick)), scale(dr, Math.sin(kick)));
    const w = smoothstep(STACK.kickEnd, STACK.kickEnd + 6, t);
    if (w > 0) {
      const vE = vEcefOf(r, v, t);
      dirE = unit(add(scale(dirE, 1 - w), scale(unit(vE), w)));
    }
    return add(add(g, d), scale(ecefToEci(dirE, t), aT));
  };
}

function launchState(): State {
  const r = ecefToEci(PAD_ECEF, 0);
  return { t: 0, r, v: omegaCross(r) };
}

/**
 * Super Heavy V3 length, m. The ship's track point is the SHIP's base, i.e. the
 * top of the booster: booster base + stack axis · 72.3 m during the joint
 * ascent (no `# mount:` header).
 */
export const BOOSTER_LENGTH_M = 72.3;
/** Starship V3 (ship) length, m — only used for the separation-gap report. */
export const SHIP_LENGTH_M = 52.1;
/**
 * Ship state at hot staging: the stack state moved 72.3 m along the stack axis
 * (the nose = Earth-relative velocity direction, as the `prograde` rule draws
 * the booster). The velocity is the stack's (the axis turns at ≈0.3°/s, which
 * adds < 0.5 m/s at the ship's base).
 */
function shipStateAtStaging(staging: State): State {
  const axis = ecefToEci(unit(vEcefOf(staging.r, staging.v, staging.t)), staging.t);
  return { t: staging.t, r: axpy(staging.r, BOOSTER_LENGTH_M / 1000, axis), v: staging.v };
}

interface Sampled {
  t: number;
  r: V3;
  v: V3;
}

function flyStack(p: AscentParams, dt = 0.1, log?: Sampled[]): State {
  return propagate(launchState(), T.hotStaging, dt, stackAccel(p), log ? (s) => log.push(s) : undefined);
}

/** Ship ascent parameters: initial thrust accel (km/s^2) and linear-tangent pitch law tanθ = p1 + p2·x. */
interface ShipParams {
  a0: number;
  p1: number;
  p2: number;
}
const SHIP_TAU = 400; // s, burn-out time constant (mass ratio ≈ 0.13 at SECO) — estimate
const SHIP_MAX_G = 3.5;
const SHIP_BURN = T.seco - T.hotStaging;

/** Inertial in-plane horizontal direction for the i = 30.5° descending pass at r. */
function planeFrame(r: V3): { d: V3; up: V3; nrm: V3 } {
  const up = unit(r);
  const east = unit(cross([0, 0, 1], up));
  const north = cross(up, east);
  const latc = Math.asin(up[2]);
  const sA = clamp(Math.cos(ORBIT.inclinationDeg * DEG) / Math.cos(latc), -1, 1);
  const A = Math.PI - Math.asin(sA); // descending branch (heading ESE from Starbase)
  const d = add(scale(north, Math.cos(A)), scale(east, Math.sin(A)));
  return { d, up, nrm: cross(up, d) };
}

function shipAscentAccel(p: ShipParams): AccelFn {
  return (t, r, v) => {
    const g = gravity(r);
    const x = (t - T.hotStaging) / SHIP_BURN;
    const aT = Math.min(p.a0 / (1 - (t - T.hotStaging) / SHIP_TAU), SHIP_MAX_G * G0);
    const { d, up, nrm } = planeFrame(r);
    const th = Math.atan(p.p1 + p.p2 * x);
    const yaw = clamp(-dot(v, nrm) / (aT * 25), -0.3, 0.3);
    const dir = unit(add(add(scale(d, Math.cos(th)), scale(up, Math.sin(th))), scale(nrm, yaw)));
    return add(add(g, drag(r, v, 2e4)), scale(dir, aT));
  };
}

function flyShipAscent(s0: State, p: ShipParams, dt = 0.25, log?: Sampled[]): State {
  return propagate(s0, T.seco, dt, shipAscentAccel(p), log ? (s) => log.push(s) : undefined);
}

/** Radius, inertial speed and inertial flight-path angle. */
function rvg(s: State): [number, number, number] {
  const rn = norm(s.r);
  const vn = norm(s.v);
  return [rn, vn, Math.asin(dot(s.r, s.v) / (rn * vn))];
}

/** Generic damped Newton with a finite-difference Jacobian. */
function newton(x0: number[], f: (x: number[]) => number[], h: number[], iters = 30, tol = 1e-9): number[] {
  let x = x0.slice();
  for (let it = 0; it < iters; it += 1) {
    const f0 = f(x);
    if (Math.max(...f0.map(Math.abs)) < tol) break;
    const n = x.length;
    const J: number[][] = f0.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j += 1) {
      const xp = x.slice();
      xp[j] += h[j];
      const fp = f(xp);
      for (let i = 0; i < f0.length; i += 1) J[i][j] = (fp[i] - f0[i]) / h[j];
    }
    const dx = solveLinear(J, f0.map((y) => -y));
    let lambda = 1;
    const n0 = Math.hypot(...f0);
    for (let k = 0; k < 8; k += 1) {
      const xn = x.map((xi, i) => xi + lambda * dx[i]);
      const fn = f(xn);
      if (Math.hypot(...fn) < n0 || k === 7) {
        x = xn;
        break;
      }
      lambda /= 2;
    }
  }
  return x;
}
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Kepler: (r, v, γ) at `dtBefore` seconds before apogee of the orbit (rp, ra). */
function keplerBeforeApogee(rp: number, ra: number, dtBefore: number): [number, number, number] {
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const n = Math.sqrt(MU / (a * a * a));
  const M = Math.PI - n * dtBefore;
  let E = M;
  for (let k = 0; k < 50; k += 1) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const r = a * (1 - e * Math.cos(E));
  const v = Math.sqrt(MU * (2 / r - 1 / a));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const gam = Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu));
  return [r, v, gam];
}

/** Osculating elements from an ECI state. */
function elements(r: V3, v: V3) {
  const rn = norm(r);
  const vn = norm(v);
  const a = 1 / (2 / rn - (vn * vn) / MU);
  const h = cross(r, v);
  const evec = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rn));
  const e = norm(evec);
  const inc = Math.acos(h[2] / norm(h));
  return { a, e, inc, rp: a * (1 - e), ra: a * (1 + e) };
}

// ---------------------------------------------------------------------------
// Ascent solve
// ---------------------------------------------------------------------------

export function solveAscent() {
  // 1. Stack: kick angle and lift-off T/W → staging at ~66 km, ~1.56 km/s (estimate).
  const STAGING_ALT = 66;
  const STAGING_VREL = 1.56;
  const stackSol = newton(
    [6, 1.5],
    ([kickDeg, tw0]) => {
      const s = flyStack({ kickDeg, tw0 }, 0.2);
      const alt = altFast(s.r);
      const vr = norm(vRelEci(s.r, s.v));
      return [(alt - STAGING_ALT) / 10, (vr - STAGING_VREL) / 0.2];
    },
    [0.05, 0.005],
    30,
    1e-7,
  );
  const stackP: AscentParams = { kickDeg: stackSol[0], tw0: stackSol[1] };
  const staging = flyStack(stackP);
  const shipStart = shipStateAtStaging(staging);

  // 2. Ship: back-solve the SECO state from the published orbit (Kepler) as
  //    the first guess, then shoot directly on the J2 + drag result: after the
  //    insertion burn min/max radius = RE + 276 / RE + 278 and zero radial
  //    velocity at the burn midpoint (burn at apogee).
  const rpT = RE + ORBIT.perigeeKm;
  const raT = RE + ORBIT.apogeeKm;
  const aPost = (rpT + raT) / 2;
  const vPost = Math.sqrt(MU * (2 / raT - 1 / aPost));
  const vPre = vPost - ORBIT.insertionDvKmS;
  const aPre = 1 / (2 / raT - (vPre * vPre) / MU);
  const rpPre = 2 * aPre - raT;
  const tBurnMid = (T.insertionStart + T.insertionEnd) / 2;
  const [rS, vS, gS] = keplerBeforeApogee(rpPre, raT, tBurnMid - T.seco);
  const guess = newton(
    [0.9 * G0, 0.4, -0.6],
    ([a0, p1, p2]) => {
      const [r, v, g] = rvg(flyShipAscent(shipStart, { a0, p1, p2 }, 0.5));
      return [(r - rS) / 1, (v - vS) / 0.01, (g - gS) / 0.002];
    },
    [1e-6, 1e-3, 1e-3],
    40,
    1e-6,
  );
  const evalShip = (p: ShipParams, dt: number) => {
    const seco = flyShipAscent(shipStart, p, dt);
    const mid = propagate(seco, tBurnMid, 5, coastAccel(SHIP_ORBIT_BETA));
    const post = coastAndInsert(seco);
    const mean = meanOrbit(post, 11000);
    return { seco, post, mean, vr: dot(mid.r, mid.v) / norm(mid.r) };
  };
  const sol = newton(
    guess,
    ([a0, p1, p2]) => {
      const e = evalShip({ a0, p1, p2 }, 0.5);
      return [e.mean.rp - rpT, e.mean.ra - raT, e.vr / 0.002];
    },
    [1e-7, 1e-4, 1e-4],
    30,
    0.02,
  );
  const shipP: ShipParams = { a0: sol[0], p1: sol[1], p2: sol[2] };
  const result = evalShip(shipP, 0.5);
  return { stackP, staging, shipStart, shipP, ...result };
}

const SHIP_ORBIT_BETA = 1000; // kg/m^2, nose-first in orbit (estimate)
function coastAccel(beta: number): AccelFn {
  return (_t, r, v) => add(gravity(r), drag(r, v, beta));
}
/** Coast from SECO, fly the ≈92 m/s prograde insertion burn, return the state at its end. */
function coastAndInsert(seco: State, log?: Sampled[]): State {
  const onStep = log ? (s: State) => log.push(s) : undefined;
  let s = propagate(seco, T.insertionStart, 5, coastAccel(SHIP_ORBIT_BETA), onStep);
  const aB = ORBIT.insertionDvKmS / (T.insertionEnd - T.insertionStart);
  s = propagate(s, T.insertionEnd, 0.5, (t, r, v) => add(coastAccel(SHIP_ORBIT_BETA)(t, r, v), scale(unit(v), aB)), onStep);
  return s;
}
/**
 * Perigee / apogee as the min / max geocentric radius over `span` seconds
 * (km from the centre; altitude = value − RE) and the mean inclination of the
 * inertial velocity. Osculating rp/ra are not used: J2 inflates the osculating
 * eccentricity of a near-circular orbit by several km.
 */
function meanOrbit(s0: State, span: number) {
  let rp = Infinity;
  let ra = -Infinity;
  let inc = 0;
  let n = 0;
  propagate(s0, s0.t + span, 5, coastAccel(SHIP_ORBIT_BETA), (s) => {
    const rn = norm(s.r);
    rp = Math.min(rp, rn);
    ra = Math.max(ra, rn);
    inc += elements(s.r, s.v).inc;
    n += 1;
  });
  return { rp, ra, inc: inc / n / DEG };
}

// ---------------------------------------------------------------------------
// Ship: orbit, deorbit, hypersonic entry (physics)
// ---------------------------------------------------------------------------

/** Route point where the ship crosses the coast, north of South Padre Island (estimate). */
export const COAST_CROSSING = { latDeg: 26.3, lonDeg: -97.19 } as const;
const ENTRY_LD = 0.5; // hypersonic lift-to-drag at aoa ≈ 65–70° (estimate)
/** End of the physics entry ("gate"): speed and distance before the coast crossing. */
const GATE = { t: T.transonic - 150, speedKmS: 1.3, distToCoastKm: 65 };

function orbitAccel(dvKmS: number): AccelFn {
  const coast = coastAccel(SHIP_ORBIT_BETA);
  const aB = dvKmS / (T.deorbitEnd - T.deorbitStart);
  return (t, r, v) => {
    const a = coast(t, r, v);
    if (t >= T.deorbitStart && t < T.deorbitEnd) return axpy(a, -aB, unit(v));
    return a;
  };
}

/** Deorbit Δv (km/s) so that the ballistic arc crosses the entry interface at T.entry. */
function solveDeorbit(preBurn: State): number {
  const crossing = (dv: number) => {
    let tc = Infinity;
    const f = orbitAccel(dv);
    let s = propagate(preBurn, T.deorbitEnd, 0.5, f);
    while (s.t < T.entry + 3000) {
      const n = rk4(s, 2, f);
      if (altFast(n.r) < ENTRY_INTERFACE_KM) {
        // linear interpolation of the crossing
        const h0 = altFast(s.r);
        const h1 = altFast(n.r);
        tc = s.t + (2 * (h0 - ENTRY_INTERFACE_KM)) / (h0 - h1);
        break;
      }
      s = n;
    }
    return tc;
  };
  let lo = 0.005;
  let hi = 0.4;
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2;
    if (crossing(mid) > T.entry) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface LatLon {
  latDeg: number;
  lonDeg: number;
}
/**
 * Lifting entry: vertical-lift fraction cv0 (with ḣ damping) and lateral lift
 * steering toward `aim` (a point north of the coast crossing, solved so that
 * the bank-limited terminal turn that follows crosses the coast at
 * COAST_CROSSING).
 */
function entryAccel(dv: number, cv0: number, beta: number, aim: LatLon): AccelFn {
  const orbit = orbitAccel(dv);
  const target = llaToEcef({ ...aim, altKm: 0 });
  return (t, r, v) => {
    const h = altFast(r);
    if (h > 130) return orbit(t, r, v);
    const g = gravity(r);
    const vr = vRelEci(r, v);
    const vn = norm(vr);
    const rho = density(h);
    const dMag = (0.5 * rho * 1000 * vn * vn) / beta;
    const vhat = scale(vr, 1 / vn);
    const up = unit(r);
    const lv = unit(sub(up, scale(vhat, dot(up, vhat))));
    const right = cross(vhat, lv);
    // heading error toward the target (positive = target to the right)
    const tgt = ecefToEci(target, t);
    const toT = sub(tgt, r);
    const b = unit(sub(toT, scale(up, dot(toT, up))));
    const hv = unit(sub(vhat, scale(up, dot(vhat, up))));
    const dpsi = -Math.atan2(dot(cross(hv, b), up), dot(hv, b));
    const hdot = dot(vr, up);
    const cv = clamp(cv0 - 4 * hdot, -1, 1);
    const cl = Math.sqrt(Math.max(0, 1 - cv * cv)) * Math.tanh(dpsi / 0.03);
    const lMag = ENTRY_LD * dMag;
    return add(add(g, scale(vhat, -dMag)), add(scale(lv, lMag * cv), scale(right, lMag * cl)));
  };
}

function flyEntry(preBurn: State, dv: number, cv0: number, beta: number, aim: LatLon, onStep?: (s: State) => void): State {
  const f = entryAccel(dv, cv0, beta, aim);
  let s = propagate(preBurn, T.deorbitEnd, 0.5, f, onStep);
  s = propagate(s, T.entry - 200, 5, f, onStep);
  return propagate(s, GATE.t, 0.5, f, onStep);
}

function gateResidual(s: State, aim: LatLon): number[] {
  const rE = eciToEcef(s.r, s.t);
  const lla = ecefToLla(rE);
  const d = groundDistanceKm(lla, aim);
  // signed: positive while the coast crossing is still ahead
  const b = enu(lla.latDeg, lla.lonDeg);
  const vE = vEcefOf(s.r, s.v, s.t);
  const toC = sub(llaToEcef({ ...aim, altKm: 0 }), rE);
  const ahead = dot(sub(vE, scale(b.u, dot(vE, b.u))), sub(toC, scale(b.u, dot(toC, b.u)))) >= 0 ? 1 : -1;
  return [(norm(vRelEci(s.r, s.v)) - GATE.speedKmS) / 0.05, (ahead * d - GATE.distToCoastKm) / 10];
}

/** Great-circle distance on the mean sphere, km. */
export function groundDistanceKm(a: { latDeg: number; lonDeg: number }, b: { latDeg: number; lonDeg: number }): number {
  const p1 = a.latDeg * DEG;
  const p2 = b.latDeg * DEG;
  const dl = (b.lonDeg - a.lonDeg) * DEG;
  const x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(x)));
}

// ---------------------------------------------------------------------------
// Orbit coast with the documented phase adjustment
// ---------------------------------------------------------------------------

/**
 * The published orbit, propagated from the reconstructed insertion, puts the
 * ship too far uprange at the entry time for any plausible glide to reach
 * Starbase by the catch time. The adjustment advances the ship along its own
 * orbit by `shift` seconds, spread smoothly over the coast (≈0.4 % faster
 * apparent motion; the orbit plane and shape are unchanged).
 */
const PHASE_RAMP = { start: T.starlinkEnd + 1800, end: T.deorbitStart - 1800 };
const phaseWeight = (t: number) => smoothstep(PHASE_RAMP.start, PHASE_RAMP.end, t);

class CoastTable {
  private readonly states: State[] = [];
  private readonly step = 10;
  constructor(post: State, tEnd: number) {
    this.states.push(post);
    propagate(post, tEnd, this.step, coastAccel(SHIP_ORBIT_BETA), (s) => this.states.push(s));
  }
  /** Exact (re-integrated) ECI state at simulation time tau. */
  at(tau: number): State {
    const t0 = this.states[0].t;
    const i = clamp(Math.floor((tau - t0) / this.step), 0, this.states.length - 1);
    return propagate(this.states[i], tau, 2, coastAccel(SHIP_ORBIT_BETA));
  }
}

/** Displayed ship state at time t: simulated state at t + shift·w(t), relabelled to t. */
function coastStateAt(table: CoastTable, t: number, shift: number): State {
  const s = table.at(t + shift * phaseWeight(t));
  return { t, r: s.r, v: s.v };
}

export function solveEntry(table: CoastTable, aim: LatLon, x0: [number, number] = [200, 0.3]) {
  const BETA = 250; // kg/m^2, belly-first (estimate)
  const run = (shift: number, cv0: number) => {
    const preBurn = coastStateAt(table, T.deorbitStart - 60, shift);
    const dv = solveDeorbit(preBurn);
    return { preBurn, dv, gate: flyEntry(preBurn, dv, cv0, BETA, aim) };
  };
  const sol = newton(x0, ([shift, cv0]) => gateResidual(run(shift, cv0).gate, aim), [1, 1e-3], 40, 1e-4);
  const [shift, cv0] = sol;
  const { preBurn, dv, gate } = run(shift, cv0);
  return { shift, cv0, beta: BETA, dv, preBurn, gate, aim };
}

// ---------------------------------------------------------------------------
// Local tangent plane at the pad (for the kinematic terminal phases)
// ---------------------------------------------------------------------------

const PAD_LAT = PAD.latDeg * DEG;
const R_MER = (RE * (1 - (2 * FLAT - FLAT * FLAT))) / Math.pow(1 - (2 * FLAT - FLAT * FLAT) * Math.sin(PAD_LAT) ** 2, 1.5);
const R_PV = RE / Math.sqrt(1 - (2 * FLAT - FLAT * FLAT) * Math.sin(PAD_LAT) ** 2);
/** Local east/north (km) ↔ lat/lon around the pad. */
function enToLatLon(e: number, n: number): { latDeg: number; lonDeg: number } {
  return { latDeg: PAD.latDeg + n / R_MER / DEG, lonDeg: PAD.lonDeg + e / (R_PV * Math.cos(PAD_LAT)) / DEG };
}
function latLonToEn(p: { latDeg: number; lonDeg: number }): [number, number] {
  return [(p.lonDeg - PAD.lonDeg) * DEG * R_PV * Math.cos(PAD_LAT), (p.latDeg - PAD.latDeg) * DEG * R_MER];
}
/** ECI state → local (e, n, h) and their rates (km, km/s). */
function toLocal(s: State): { p: [number, number, number]; v: [number, number, number] } {
  const rE = eciToEcef(s.r, s.t);
  const vE = vEcefOf(s.r, s.v, s.t);
  const lla = ecefToLla(rE);
  const [e, n] = latLonToEn(lla);
  const b = enu(lla.latDeg, lla.lonDeg);
  return { p: [e, n, lla.altKm], v: [dot(vE, b.e), dot(vE, b.n), dot(vE, b.u)] };
}

/** Cubic Hermite scalar on [t0, t1]. */
function hermite(t0: number, t1: number, p0: number, m0: number, p1: number, m1: number) {
  const d = t1 - t0;
  return {
    p: (t: number) => {
      const u = (t - t0) / d;
      return (2 * u ** 3 - 3 * u * u + 1) * p0 + (u ** 3 - 2 * u * u + u) * d * m0 + (-2 * u ** 3 + 3 * u * u) * p1 + (u ** 3 - u * u) * d * m1;
    },
    v: (t: number) => {
      const u = (t - t0) / d;
      return (6 * u * u - 6 * u) * (p0 - p1) / d + (3 * u * u - 4 * u + 1) * m0 + (3 * u * u - 2 * u) * m1;
    },
  };
}
// ---------------------------------------------------------------------------
// Ship: kinematic terminal phase (gate → coast → turn south → tower)
// ---------------------------------------------------------------------------

const BELLYFLOP_GLIDE = { atSubsonic: 0.5, atLandingBurn: 0.2 }; // horizontal / vertical speed (estimate)
const TRANSONIC_MACH = 1.2;
const SUBSONIC_MACH = 0.8;
/** Heading (deg from north) of the final leg: toward the tower from bearing 15° (NNE), i.e. SSW. */
const FINAL_HEADING_DEG = 195;
/** Roll-in / roll-out time of the terminal turn's bank, s (estimate). */
const TURN_ROLL_IN_S = 25;
const TURN_ROLL_OUT_S = 30;

interface Planar {
  e: number;
  n: number;
}

/** Terminal fall at (near-)terminal velocity: |ḣ| = vt0·sqrt(ρ0/ρ(h)). */
const fallRate = (vt0: number, h: number) => vt0 * Math.sqrt(1.225 / density(h));

/**
 * Ship terminal phase (kinematic, from the end of the physics entry to the
 * catch). Vertical: glide to the belly flop, terminal-velocity fall, landing
 * burn. Horizontal: speed profile fitted to the published Mach times, and ONE
 * bank-limited right turn — lateral acceleration rolled in from the entry's
 * value at the gate over TURN_ROLL_IN_S, held at A, rolled out over
 * TURN_ROLL_OUT_S ending at tE — integrated as heading rate ψ̇ = a_lat / v.
 * A, tE and the mid-course speed vm are solved so the track ends at the pad
 * on the final heading. Heading rate is continuous (C¹ bank), so the turn
 * radius r = v² / a_lat changes smoothly with speed.
 *
 * `stateAt(t)` is the physics entry state (valid slightly beyond the gate).
 */
export function buildShipTerminal(gate: State, stateAt: (t: number) => State) {
  const g = toLocal(gate);
  const tG = gate.t;
  // --- vertical: belly flop (subsonic → landing burn) at terminal velocity, fitted to Mach 0.8 at subsonic.
  const tLB = T.shipLandingBurn;
  const tS = T.subsonic;
  const tTr = T.transonic;
  const tC = T.shipCatch;
  const solveFall = (vt0: number) => {
    // fixed point on the landing-burn altitude (constant deceleration to the catch)
    let hLB = 0.6;
    for (let k = 0; k < 20; k += 1) hLB = SHIP_CATCH_ALT_KM + 0.5 * fallRate(vt0, hLB) * (tC - tLB);
    // integrate backward from the landing burn to subsonic
    const hs: number[] = [];
    const ts: number[] = [];
    let h = hLB;
    const dt = 0.25;
    for (let t = tLB; t >= tS - 1e-9; t -= dt) {
      ts.push(t);
      hs.push(h);
      h = Math.min(60, h + fallRate(vt0, h) * dt); // backward in time → higher
    }
    ts.reverse();
    hs.reverse();
    const hS = hs[0];
    const vS = fallRate(vt0, hS) * Math.hypot(1, BELLYFLOP_GLIDE.atSubsonic);
    return { hLB, ts, hs, hS, mach: vS / speedOfSound(hS) };
  };
  let lo = 0.04;
  let hi = 0.12;
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2;
    if (solveFall(mid).mach < SUBSONIC_MACH) lo = mid;
    else hi = mid;
  }
  const vt0 = (lo + hi) / 2;
  const fall = solveFall(vt0);
  const hFall = (t: number) => {
    const x = (t - fall.ts[0]) / 0.25;
    const i = clamp(Math.floor(x), 0, fall.ts.length - 2);
    const w = x - i;
    return fall.hs[i] * (1 - w) + fall.hs[i + 1] * w;
  };
  const hdS = -fallRate(vt0, fall.hS);
  const hdLB = -fallRate(vt0, fall.hLB);
  const hGlide = hermite(tG, tS, g.p[2], g.v[2], fall.hS, hdS);
  const hBurn = hermite(tLB, tC, fall.hLB, hdLB, SHIP_CATCH_ALT_KM, 0);
  const altAt = (t: number) => (t <= tS ? hGlide.p(t) : t <= tLB ? hFall(t) : hBurn.p(t));
  const hdotAt = (t: number) => (t <= tS ? hGlide.v(t) : t <= tLB ? -fallRate(vt0, hFall(t)) : hBurn.v(t));

  // --- horizontal state at the gate in the pad plane (central differences of the physics positions)
  const plane = (s: State): Planar => {
    const [e, n] = latLonToEn(llaOf(s));
    return { e, n };
  };
  const H = 0.25;
  const pm = plane(stateAt(tG - H));
  const p0 = plane(gate);
  const pp = plane(stateAt(tG + H));
  const ve = (pp.e - pm.e) / (2 * H);
  const vn = (pp.n - pm.n) / (2 * H);
  const ae = (pp.e - 2 * p0.e + pm.e) / (H * H);
  const an = (pp.n - 2 * p0.n + pm.n) / (H * H);
  const gh = Math.hypot(ve, vn);
  const psi0 = Math.atan2(ve, vn);
  const vhDot0 = (ve * ae + vn * an) / gh;
  const aLat0 = (vn * ae - ve * an) / gh; // + = turning right (clockwise heading)

  // --- horizontal speed
  const glideK = (t: number) =>
    BELLYFLOP_GLIDE.atSubsonic + (BELLYFLOP_GLIDE.atLandingBurn - BELLYFLOP_GLIDE.atSubsonic) * smoothstep(tS, tLB, t);
  const hTr = hGlide.p(tTr);
  const hdTr = hGlide.v(tTr);
  const vhTr = Math.sqrt((TRANSONIC_MACH * speedOfSound(hTr)) ** 2 - hdTr * hdTr);
  const vhS = BELLYFLOP_GLIDE.atSubsonic * -hdS;
  const vhLB = BELLYFLOP_GLIDE.atLandingBurn * -hdLB;
  const lateSlope = (vhS - vhTr) / (tS - tTr);
  const vhLate = (t: number) => {
    if (t <= tS) return vhTr + lateSlope * (t - tTr);
    if (t <= tLB) return glideK(t) * fallRate(vt0, hFall(t));
    return vhLB * (1 - smoothstep(tLB, tC, t));
  };
  // gate → transonic: two monotone cubic Hermite pieces through (tG, gh), (tM, vm), (tTr, vhTr);
  // the end slopes match the physics deceleration at the gate and the post-transonic slope.
  const tM = (tG + tTr) / 2;
  const earlyProfile = (vm: number) => {
    const d1 = (vm - gh) / (tM - tG);
    const d2 = (vhTr - vm) / (tTr - tM);
    const mM = d1 * d2 > 0 ? (2 * d1 * d2) / (d1 + d2) : 0;
    const m0 = clamp(vhDot0, 3 * Math.min(d1, 0), 0);
    const m2 = clamp(lateSlope, 3 * Math.min(d2, 0), 0);
    const s1 = hermite(tG, tM, gh, m0, vm, mM);
    const s2 = hermite(tM, tTr, vm, mM, vhTr, m2);
    return (t: number) => (t <= tM ? s1.p(t) : s2.p(t));
  };
  const psiF = FINAL_HEADING_DEG * DEG;
  const DT = 0.1;
  const fly = (A: number, tE: number, vm: number) => {
    const early = earlyProfile(vm);
    const vh = (t: number) => (t <= tTr ? early(t) : vhLate(t));
    const aLat = (t: number) => {
      const rin = smoothstep(tG, tG + TURN_ROLL_IN_S, t);
      const rout = smoothstep(tE - TURN_ROLL_OUT_S, tE, t);
      return aLat0 * (1 - rin) + A * rin * (1 - rout);
    };
    const f = (t: number, y: number[]) => {
      const v = vh(t);
      return [v * Math.sin(y[2]), v * Math.cos(y[2]), v > 1e-6 ? aLat(t) / v : 0];
    };
    const ts: number[] = [tG];
    const ys: number[][] = [[p0.e, p0.n, psi0]];
    let y = [p0.e, p0.n, psi0];
    let t = tG;
    while (t < tC - 1e-9) {
      const h = Math.min(DT, tC - t);
      const k1 = f(t, y);
      const k2 = f(t + h / 2, y.map((yi, i) => yi + (h / 2) * k1[i]));
      const k3 = f(t + h / 2, y.map((yi, i) => yi + (h / 2) * k2[i]));
      const k4 = f(t + h, y.map((yi, i) => yi + h * k3[i]));
      y = y.map((yi, i) => yi + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      t += h;
      ts.push(t);
      ys.push(y);
    }
    return { ts, ys, vh, aLat };
  };
  const residual = ([A, tE, vm]: number[]) => {
    const r = fly(A, tE, vm);
    const end = r.ys[r.ys.length - 1];
    return [end[0], end[1], (end[2] - psiF) * 20];
  };
  const [A, tE, vm] = newton([0.25 * G0, tS + 20, 0.43], residual, [1e-5, 0.5, 1e-3], 40, 1e-6);
  const route = fly(A, tE, vm);
  const planarAt = (t: number): Planar => {
    const x = (clamp(t, tG, tC) - tG) / DT;
    const i = clamp(Math.floor(x), 0, route.ts.length - 2);
    const w = clamp((clamp(t, tG, tC) - route.ts[i]) / (route.ts[i + 1] - route.ts[i]), 0, 1);
    const a = route.ys[i];
    const b = route.ys[i + 1];
    return { e: a[0] * (1 - w) + b[0] * w, n: a[1] * (1 - w) + b[1] * w };
  };
  const positionAt = (t: number): Lla => {
    const pl = planarAt(t);
    return { ...enToLatLon(pl.e, pl.n), altKm: altAt(t) };
  };
  // diagnostics: turn limits and the coast crossing
  let maxLat = 0;
  let minRadius = Infinity;
  let crossLatDeg = NaN;
  let prevLon = -Infinity;
  for (let i = 0; i < route.ts.length; i += 1) {
    const t = route.ts[i];
    const a = Math.abs(route.aLat(t));
    const v = route.vh(t);
    maxLat = Math.max(maxLat, a);
    if (a > 1e-7 && t < tE) minRadius = Math.min(minRadius, (v * v) / a);
    const ll = enToLatLon(route.ys[i][0], route.ys[i][1]);
    if (Number.isNaN(crossLatDeg) && prevLon < COAST_CROSSING.lonDeg && ll.lonDeg >= COAST_CROSSING.lonDeg) crossLatDeg = ll.latDeg;
    prevLon = ll.lonDeg;
  }
  return {
    positionAt,
    hdotAt,
    vhAt: route.vh,
    crossLatDeg,
    diag: {
      gate: g,
      gateHeadingDeg: psi0 / DEG,
      gateLatAccG: aLat0 / G0,
      turnLatAccG: A / G0,
      turnEndT: tE,
      maxLatAccG: maxLat / G0,
      maxBankDeg: Math.atan(maxLat / G0) / DEG,
      minTurnRadiusKm: minRadius,
      finalHeadingDeg: route.ys[route.ys.length - 1][2] / DEG,
      crossLatDeg,
      vt0,
      hLB: fall.hLB,
      hS: fall.hS,
      hTr,
      vhTr,
      vm,
      gh,
    },
  };
}

// ---------------------------------------------------------------------------
// Booster return (physics boostback, kinematic landing burn / abort / divert)
// ---------------------------------------------------------------------------

const BOOSTER_BETA = 2000; // kg/m^2 (≈280 t, engines first with grid fins, Cd·A ≈ 140 m²) — estimate
const BOOSTER_LB_ALT_KM = 3.8; // landing-burn ignition altitude (estimate; from ~395 m/s a 3.0 km start cannot stop at ≲3.5 g thrust by the hover time)
/**
 * Booster landing burn → hover over the contingency point → shut-down → fall
 * (estimates shaped on the reports: catch aborted automatically, booster flew
 * to its offshore contingency point, hovered, shut down, FTS just before
 * water impact). The boostback aims the booster at the offshore point (as the
 * real booster does until a "go" for the tower divert), so the abort needs
 * no large translation; the landing burn only removes the residual drift.
 */
const BOOSTER_TERMINAL = {
  rampUpS: 1.5, // engine start-up (13 engines): acceleration blends from the ballistic value to the burn level
  hoverStart: T.catchAbort - 4, // hover reached (estimate)
  hoverAltKm: 0.02, // base above the water while hovering
  hLateralTaperS: 5, // translation braked to zero over the last seconds before the hover
  cutoff: T.catchAbort, // engine shut-down at the reported automatic abort, T+6:35
  cutoffRampS: 0.6, // thrust tail-off
};

interface BoostbackParams {
  acc: number;
  pitch: number;
  yaw: number;
}
function boosterAccel(p: BoostbackParams): AccelFn {
  return (t, r, v) => {
    const a = add(gravity(r), drag(r, v, BOOSTER_BETA));
    if (t < T.boostbackStart || t >= T.boostbackEnd) return a;
    const rE = eciToEcef(r, t);
    const lla = ecefToLla(rE);
    const b = enu(lla.latDeg, lla.lonDeg);
    const az = LAUNCH_AZ_DEG * DEG;
    const down: V3 = add(scale(b.n, Math.cos(az)), scale(b.e, Math.sin(az)));
    const right = cross(down, b.u);
    const dir = add(add(scale(down, -Math.cos(p.pitch) * Math.cos(p.yaw)), scale(right, Math.cos(p.pitch) * Math.sin(p.yaw))), scale(b.u, Math.sin(p.pitch)));
    return add(a, scale(ecefToEci(dir, t), p.acc));
  };
}
function flyBooster(staging: State, p: BoostbackParams, dt = 0.25, onStep?: (s: State) => void): State {
  return propagate(staging, T.boosterLandingBurn, dt, boosterAccel(p), onStep);
}
/** Boostback (acceleration, pitch, yaw) so the ballistic arc is at `aim` (local e, n km; altitude BOOSTER_LB_ALT_KM) at the landing burn. */
export function solveBooster(staging: State, aim: Planar, x0: number[] = [2.5 * G0, 0.3, 0]) {
  const target = (s: State) => {
    const l = toLocal(s);
    return [(l.p[0] - aim.e) / 0.1, (l.p[1] - aim.n) / 0.1, (l.p[2] - BOOSTER_LB_ALT_KM) / 0.1];
  };
  const sol = newton(x0, ([acc, pitch, yaw]) => target(flyBooster(staging, { acc, pitch, yaw }, 0.25)), [1e-6, 1e-4, 1e-4], 40, 1e-5);
  return { acc: sol[0], pitch: sol[1], yaw: sol[2] };
}

/**
 * Booster terminal phase from the landing-burn ignition state (local pad
 * frame; `stateAt` gives the ballistic physics around ignition). Each axis
 * has a continuous acceleration profile:
 *   a(t) = a_ballistic·(1 − S_up) + B·S_up·(1 − S_down)
 * (S = smoothstep). Vertical: B and the start of S_down are solved so the
 * booster stops at the hover height exactly at the hover time. Horizontal: B
 * stops the drift at the hover time (S_down over the last
 * `hLateralTaperS`); the resulting displacement tells the boostback where to
 * aim. Hover, thrust tail-off over `cutoffRampS`, free fall to the water.
 */
export function buildBoosterTerminal(stateAt: (t: number) => State) {
  const P = BOOSTER_TERMINAL;
  const t0 = T.boosterLandingBurn;
  const tH = P.hoverStart;
  const l0 = toLocal(stateAt(t0));
  const lm = toLocal(stateAt(t0 - 0.1));
  const lp = toLocal(stateAt(t0 + 0.1));
  const a0 = [0, 1, 2].map((i) => (lp.v[i] - lm.v[i]) / 0.2);
  const sUp = (t: number) => smoothstep(t0, t0 + P.rampUpS, t);
  const DT = 0.01;
  /** Integrate a(t) from t0 to tH; returns final velocity and displacement. */
  const run = (acc: (t: number) => number, v0: number, tEnd: number) => {
    let v = v0;
    let x = 0;
    for (let t = t0; t < tEnd - 1e-9; t += DT) {
      const h = Math.min(DT, tEnd - t);
      const am = acc(t + h / 2);
      x += v * h + 0.5 * am * h * h;
      v += am * h;
    }
    return { v, x };
  };
  const axisProfile = (i: number, tDown: number, tEnd = tH) => {
    const shape = (t: number) => sUp(t) * (1 - smoothstep(tDown, tEnd, t));
    const base = (t: number) => a0[i] * (1 - sUp(t));
    const r0 = run(base, l0.v[i], tEnd);
    const r1 = run(shape, 0, tEnd);
    const B = -r0.v / r1.v;
    return { B, acc: (t: number) => base(t) + B * shape(t), dx: r0.x + B * r1.x };
  };
  // vertical: solve the start of the taper so the hover height is reached exactly
  const dh = P.hoverAltKm - l0.p[2];
  let lo = t0 + P.rampUpS + 0.5;
  let hi = tH - 1;
  const resLo = axisProfile(2, lo).dx - dh;
  if (resLo * (axisProfile(2, hi).dx - dh) > 0) throw new Error(`booster landing burn: hover height not bracketed ${JSON.stringify({ dh, lo: axisProfile(2, lo), hi: axisProfile(2, hi), l0, a0 })}`);
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2;
    if ((axisProfile(2, mid).dx - dh) * resLo > 0) lo = mid;
    else hi = mid;
  }
  const vert = axisProfile(2, (lo + hi) / 2);
  // horizontal: the residual drift is braked until the shut-down (the hover drifts by a few metres)
  const horiz = [0, 1].map((i) => axisProfile(i, P.cutoff - P.hLateralTaperS, P.cutoff));
  const accAt = (t: number): [number, number, number] => {
    const h: [number, number] = t <= P.cutoff ? [horiz[0].acc(t), horiz[1].acc(t)] : [0, 0];
    if (t <= tH) return [h[0], h[1], vert.acc(t)];
    return [h[0], h[1], -G0 * smoothstep(P.cutoff, P.cutoff + P.cutoffRampS, t)];
  };
  // tabulate position / velocity until the water
  const ts: number[] = [t0];
  const ps: [number, number, number][] = [[l0.p[0], l0.p[1], l0.p[2]]];
  const vs: [number, number, number][] = [[l0.v[0], l0.v[1], l0.v[2]]];
  let t = t0;
  let p: [number, number, number] = [...ps[0]];
  let v: [number, number, number] = [...vs[0]];
  while (t < tH + 60) {
    const am = accAt(t + DT / 2);
    const pn = p.map((x, i) => x + v[i] * DT + 0.5 * am[i] * DT * DT) as [number, number, number];
    const vn = v.map((x, i) => x + am[i] * DT) as [number, number, number];
    if (pn[2] <= 0) {
      // water contact inside this step
      const f = p[2] / (p[2] - pn[2]);
      t += f * DT;
      p = p.map((x, i) => x + f * (pn[i] - x)) as [number, number, number];
      p[2] = 0;
      v = v.map((x, i) => x + f * (vn[i] - x)) as [number, number, number];
      ts.push(t);
      ps.push(p);
      vs.push(v);
      break;
    }
    t += DT;
    p = pn;
    v = vn;
    ts.push(t);
    ps.push(p);
    vs.push(v);
  }
  const tEnd = t;
  const local = (tq: number): [number, number, number] => {
    const x = (clamp(tq, t0, tEnd) - t0) / DT;
    const i = clamp(Math.floor(x), 0, ts.length - 2);
    const w = clamp((clamp(tq, t0, tEnd) - ts[i]) / (ts[i + 1] - ts[i]), 0, 1);
    return [0, 1, 2].map((k) => ps[i][k] * (1 - w) + ps[i + 1][k] * w) as [number, number, number];
  };
  // diagnostics. Thrust = kinematic acceleration − gravity − drag (β as in the ballistic phase, so the
  // aerodynamic braking of the first seconds is not counted as engine thrust); "kinematic" = a − gravity.
  let peakThrustG = 0;
  let maxTiltDeg = 0;
  let maxThrustLatG = 0;
  let maxKinLatG = 0;
  for (let i = 0; i < ts.length && ts[i] <= P.cutoff; i += 5) {
    const a = accAt(ts[i]);
    const vv = vs[i];
    const sp = Math.hypot(...vv);
    const k = (0.5 * density(ps[i][2]) * 1000 * sp) / BOOSTER_BETA;
    const th = [a[0] + k * vv[0], a[1] + k * vv[1], a[2] + G0 + k * vv[2]];
    const ah = Math.hypot(th[0], th[1]);
    peakThrustG = Math.max(peakThrustG, Math.hypot(ah, th[2]) / G0);
    maxThrustLatG = Math.max(maxThrustLatG, ah / G0);
    maxKinLatG = Math.max(maxKinLatG, Math.hypot(a[0], a[1]) / G0);
    // tilt of the thrust from vertical, once the engines carry at least the weight (ignition transient excluded)
    if (Math.hypot(ah, th[2]) >= G0) maxTiltDeg = Math.max(maxTiltDeg, Math.atan2(ah, th[2]) / DEG);
  }
  return {
    tEnd,
    start: l0,
    displacement: [horiz[0].dx, horiz[1].dx] as [number, number],
    positionAt: (tq: number): Lla => {
      const [e, n, h] = local(tq);
      return { ...enToLatLon(e, n), altKm: h };
    },
    diag: {
      ignition: { altKm: l0.p[2], speedMs: Math.hypot(...l0.v) * 1000, horizontalMs: Math.hypot(l0.v[0], l0.v[1]) * 1000 },
      vertB_G: vert.B / G0,
      lateralB_G: horiz.map((h) => h.B / G0),
      peakThrustG,
      maxTiltDeg,
      maxThrustLatG,
      maxKinLatG,
      hoverStart: tH,
      cutoff: P.cutoff,
      impactT: tEnd,
      impactSpeedMs: Math.hypot(...v) * 1000,
    },
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface Row {
  t: number;
  lla: Lla;
  q?: THREE.Quaternion;
}

const SOURCES = [
  "https://en.wikipedia.org/wiki/Starship_flight_15",
  "https://www.space.com/space-exploration/launches-spacecraft/spacex-starship-flight-15-chopsticks-double-catch-super-heavy-ship",
  "https://www.drohnen.de/97929/starship-flight-15-live-ship-catch-en/",
  "https://keeptrack.space/x-report/spacex-brief-2026-11-15",
];
const fmtT = (t: number) => (Math.abs(t - Math.round(t)) < 1e-6 ? String(Math.round(t)) : t.toFixed(2).replace(/0$/, ""));
function header(name: string, model: string): string[] {
  return [
    `# name: ${name}`,
    "# 公開情報からの推定再現（非公式）。速度・高度・経路は推定です。",
    "# Reconstruction from public information (unofficial). Speeds, altitudes and the path are estimates.",
    "# Generated by scripts/analysis/flight15-reconstruct.ts — see docs/demos/flight15.md",
    ...SOURCES.map((u) => `# source: ${u}`),
    "# frame: LLA",
    `# epoch: ${EPOCH_ISO}`,
    `# model: ${model}`,
  ];
}
function rowsToCsv(head: string[], rows: Row[], withQ: boolean): string {
  const lines = [...head, withQ ? "time_s,lat_deg,lon_deg,alt_km,qw,qx,qy,qz" : "time_s,lat_deg,lon_deg,alt_km"];
  for (const r of rows) {
    const base = `${fmtT(r.t)},${r.lla.latDeg.toFixed(6)},${r.lla.lonDeg.toFixed(6)},${r.lla.altKm.toFixed(4)}`;
    if (withQ && r.q) {
      const q = r.q.w < 0 ? r.q.clone().set(-r.q.x, -r.q.y, -r.q.z, -r.q.w) : r.q;
      lines.push(`${base},${q.w.toFixed(6)},${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)}`);
    } else lines.push(base);
  }
  return lines.join("\n") + "\n";
}

/** Sample times: union of ranges [from, to) with steps, plus explicit times. */
function timeGrid(ranges: [number, number, number][], extra: number[], end: number): number[] {
  const set = new Set<number>();
  for (const [a, b, st] of ranges) for (let t = a; t < b - 1e-9; t += st) set.add(Math.round(t * 100) / 100);
  for (const t of extra) set.add(Math.round(t * 100) / 100);
  const endR = Math.round(end * 100) / 100;
  set.add(endR);
  return [...set].filter((t) => t >= 0 && t <= endR + 1e-9).sort((x, y) => x - y);
}

/** Record a propagated trajectory as a lookup (exact at the stored step times). */
class Recorder {
  readonly states: State[] = [];
  push = (s: State) => {
    this.states.push(s);
  };
  /** State at time t by re-integrating from the previous stored state. */
  at(t: number, f: AccelFn): State {
    let lo = 0;
    let hi = this.states.length - 1;
    if (t <= this.states[0].t) return this.states[0];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.states[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return propagate(this.states[lo], t, 0.05, f);
  }
}
const llaOf = (s: State): Lla => ecefToLla(eciToEcef(s.r, s.t));

export const BOOSTER_EVENTS: [number, string][] = [
  [0, "打上げ"],
  [T.maxQ, "最大動圧"],
  [T.meco, "1段エンジン停止"],
  [T.hotStaging, "ホットステージング（段の分離）"],
  [T.boostbackStart, "ブーストバック開始"],
  [T.boostbackEnd, "ブーストバック終了"],
  [T.boosterLandingBurn, "着陸噴射"],
  [T.catchAbort, "キャッチ中止・洋上へ"],
];
export const SHIP_EVENTS: [number, string][] = [
  [0, "打上げ"],
  [T.maxQ, "最大動圧"],
  [T.hotStaging, "ホットステージング（段の分離）"],
  [T.seco, "2段エンジン停止"],
  [T.insertionStart, "軌道投入噴射"],
  [T.starlinkStart, "Starlink 分離開始"],
  [T.starlinkEnd, "Starlink 分離完了"],
  [T.deorbitStart, "軌道離脱噴射"],
  [T.entry, "大気圏再突入"],
  [T.subsonic, "音速以下へ減速"],
  [T.shipLandingBurn, "着陸噴射・フリップ"],
  [T.shipCatch, "タワーでキャッチ"],
];
const ENTRY_AOA_DEG = 67;

function parseTrack(text: string, name: string): TrajectoryTrack {
  const res = parseTrajectoryFile(text, name);
  if (!res.ok) throw new Error(`${name}: ${res.error}`);
  return toTrajectoryTrack(res.track, 0);
}

/** Quaternion of one rule mode at time t (s) on a parsed track. */
function modeQuat(track: TrajectoryTrack, mode: AttitudeRule["mode"], t: number, aoaDeg?: number): THREE.Quaternion {
  const ms = EPOCH_MS + t * 1000;
  const st = trajectoryStateAt(track, ms);
  if (!st) throw new Error(`no state at ${t}`);
  const tr = { ...track, attitudeRules: [{ timeMs: track.samples[0].timeMs, mode, aoaDeg }] };
  const q = trajectoryAttitudeAt(tr, ms, st);
  if (!q) throw new Error(`no attitude at ${t}`);
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}
/** Belly-flop attitude: nose level along the horizontal velocity, belly down. */
function bellyFlopQuat(track: TrajectoryTrack, t: number): THREE.Quaternion {
  const st = trajectoryStateAt(track, EPOCH_MS + t * 1000);
  if (!st) throw new Error(`no state at ${t}`);
  const b = enu(st.latDeg, st.lonDeg);
  const v: V3 = [st.velocity.x, st.velocity.y, st.velocity.z];
  const nose = unit(sub(v, scale(b.u, dot(v, b.u))));
  const belly = scale(b.u, -1);
  const y = cross(belly, nose);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...nose), new THREE.Vector3(...y), new THREE.Vector3(...belly));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export interface BuildResult {
  boosterCsv: string;
  shipCsv: string;
  report: Record<string, unknown>;
}

/** Body +X (nose) of a parsed track at time t, ECEF unit vector. */
function noseAt(track: TrajectoryTrack, t: number): { pos: V3; nose: V3; q: THREE.Quaternion } {
  const ms = EPOCH_MS + t * 1000;
  const st = trajectoryStateAt(track, ms);
  if (!st) throw new Error(`no state at ${t}`);
  const qb = trajectoryAttitudeAt(track, ms, st);
  if (!qb) throw new Error(`no attitude at ${t}`);
  const q = new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w);
  const n = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return { pos: [st.position.x, st.position.y, st.position.z], nose: [n.x, n.y, n.z], q };
}
/** Minimum distance (m) between two body axes: base a along na (length la) and base b along nb (length lb); km in, m out. */
export function axisGapM(a: V3, na: V3, la: number, b: V3, nb: V3, lb: number): number {
  let best = Infinity;
  const N = 60;
  for (let i = 0; i <= N; i += 1) {
    const pa = axpy(a, (la * i) / N / 1000, na);
    for (let j = 0; j <= N; j += 1) best = Math.min(best, norm(sub(pa, axpy(b, (lb * j) / N / 1000, nb))) * 1000);
  }
  return best;
}

export function build(): BuildResult {
  const asc = solveAscent();
  // --- re-fly ascent with recording
  const stackRec = new Recorder();
  stackRec.push(launchState());
  const stackF = stackAccel(asc.stackP);
  let maxQ = { q: 0, t: 0 };
  propagate(launchState(), T.hotStaging, 0.1, stackF, (s) => {
    stackRec.push(s);
    const vr = norm(vRelEci(s.r, s.v)) * 1000;
    const q = 0.5 * density(altFast(s.r)) * vr * vr;
    if (q > maxQ.q) maxQ = { q, t: s.t };
  });
  const staging = stackRec.states[stackRec.states.length - 1];
  const shipStart = shipStateAtStaging(staging);
  const shipAscRec = new Recorder();
  shipAscRec.push(shipStart);
  const shipF = shipAscentAccel(asc.shipP);
  const seco = propagate(shipStart, T.seco, 0.5, shipF, shipAscRec.push);
  const insRec = new Recorder();
  insRec.push(seco);
  const insF: AccelFn = (t, r, v) => {
    const a = coastAccel(SHIP_ORBIT_BETA)(t, r, v);
    if (t >= T.insertionStart && t < T.insertionEnd) return axpy(a, ORBIT.insertionDvKmS / (T.insertionEnd - T.insertionStart), unit(v));
    return a;
  };
  const post = coastAndInsert(seco, insRec.states);
  const orbit = meanOrbit(post, 11000);
  const table = new CoastTable(post, T.deorbitStart + 1200);

  // --- entry + terminal: the entry aim point is moved north of the coast crossing until the
  //     bank-limited terminal turn (which starts at the gate) crosses the coast at COAST_CROSSING.
  const [ce, cn] = latLonToEn(COAST_CROSSING);
  let entX0: [number, number] = [200, 0.3];
  const attempt = (dn: number) => {
    const aim = enToLatLon(ce, cn + dn);
    const ent = solveEntry(table, aim, entX0);
    entX0 = [ent.shift, ent.cv0];
    const entF = entryAccel(ent.dv, ent.cv0, ent.beta, aim);
    const entRec = new Recorder();
    entRec.push(ent.preBurn);
    const gate = flyEntry(ent.preBurn, ent.dv, ent.cv0, ent.beta, aim, entRec.push);
    const term = buildShipTerminal(gate, (t) => entRec.at(t, entF));
    return { dn, ent, entF, entRec, gate, term, miss: term.crossLatDeg - COAST_CROSSING.latDeg };
  };
  let a0 = attempt(10);
  let a1 = attempt(25);
  for (let k = 0; k < 12 && Math.abs(a1.miss) > 0.002; k += 1) {
    const dn = a1.dn - (a1.miss * (a1.dn - a0.dn)) / (a1.miss - a0.miss);
    a0 = a1;
    a1 = attempt(clamp(dn, -20, 80));
  }
  const { ent, entF, entRec, gate, term } = a1;
  let peakEntryG = 0;
  let peakQ = 0;
  let eiCross = 0;
  for (let i = 1; i < entRec.states.length; i += 1) {
    const s = entRec.states[i];
    const h = altFast(s.r);
    if (!eiCross && altFast(entRec.states[i - 1].r) >= ENTRY_INTERFACE_KM && h < ENTRY_INTERFACE_KM) eiCross = s.t;
    if (s.t > T.deorbitEnd) {
      peakEntryG = Math.max(peakEntryG, norm(sub(entF(s.t, s.r, s.v), gravity(s.r))) / G0);
      const vr = norm(vRelEci(s.r, s.v)) * 1000;
      peakQ = Math.max(peakQ, 0.5 * density(h) * vr * vr);
    }
  }

  // --- booster: the boostback aims the ballistic arc so that the landing burn ends over the
  //     contingency point (fixed point on the landing-burn drift).
  const [endE, endN] = latLonToEn(BOOSTER_END);
  let bAim: Planar = { e: endE + 0.7, n: endN };
  let bbX0 = [2.5 * G0, 0.3, 0];
  let bbP = solveBooster(staging, bAim, bbX0);
  let bF = boosterAccel(bbP);
  let bRec = new Recorder();
  let bTerm: ReturnType<typeof buildBoosterTerminal> | undefined;
  for (let k = 0; k < 8; k += 1) {
    bbP = solveBooster(staging, bAim, bbX0);
    bbX0 = [bbP.acc, bbP.pitch, bbP.yaw];
    bF = boosterAccel(bbP);
    const rec = new Recorder();
    rec.push(staging);
    propagate(staging, T.boosterLandingBurn, 0.25, bF, rec.push);
    bRec = rec;
    const f = bF;
    bTerm = buildBoosterTerminal((t) => rec.at(t, f));
    const next = { e: endE - bTerm.displacement[0], n: endN - bTerm.displacement[1] };
    const moved = Math.hypot(next.e - bAim.e, next.n - bAim.n);
    bAim = next;
    if (moved < 1e-4) break;
  }
  if (!bTerm) throw new Error("booster terminal not built");
  const boosterTerm = bTerm;

  // --- booster rows
  const bTimes = timeGrid(
    [
      [0, T.meco, 1],
      [T.meco, T.hotStaging + 30, 0.5],
      [T.hotStaging + 30, T.boosterLandingBurn - 10, 1],
      [T.boosterLandingBurn - 10, boosterTerm.tEnd, 0.25],
    ],
    [T.maxQ, T.meco, T.hotStaging, T.boostbackStart, T.boostbackEnd, T.boosterLandingBurn, T.catchAbort],
    boosterTerm.tEnd,
  );
  const boosterRows: Row[] = bTimes.map((t) => {
    if (t <= T.hotStaging) return { t, lla: llaOf(stackRec.at(t, stackF)) };
    if (t <= T.boosterLandingBurn) return { t, lla: llaOf(bRec.at(t, bF)) };
    return { t, lla: boosterTerm.positionAt(t) };
  });
  boosterRows[0].lla = { ...PAD, altKm: PAD_BASE_ALT_KM };

  // booster attitude rule times from its own trajectory
  let reversalT = T.boostbackEnd;
  let apogeeT = T.boostbackEnd;
  {
    const az = LAUNCH_AZ_DEG * DEG;
    let prevDown = Infinity;
    let prevUp = Infinity;
    for (let t = T.hotStaging; t <= T.boosterLandingBurn; t += 0.5) {
      const s = bRec.at(t, bF);
      const l = toLocal(s);
      const down = l.v[0] * Math.sin(az) + l.v[1] * Math.cos(az);
      if (prevDown > 0 && down <= 0 && reversalT === T.boostbackEnd) reversalT = t;
      if (prevUp > 0 && l.v[2] <= 0) apogeeT = t;
      prevDown = down;
      prevUp = l.v[2];
    }
  }
  const boosterRules = [
    "# attitude: 0, prograde",
    `# attitude: ${T.hotStaging}, aoa, aoa=150, transition=5`,
    `# attitude: ${fmtT(Math.round(reversalT - 12))}, vertical, transition=10`,
    `# attitude: ${fmtT(Math.round(Math.max(apogeeT, reversalT) + 15))}, retrograde, transition=20`,
    `# attitude: ${fmtT(T.boosterLandingBurn)}, vertical, transition=4`,
  ];
  const boosterHead = [
    ...header("Super Heavy B22（推定再現）", "starship-v3-booster"),
    ...boosterRules,
    ...BOOSTER_EVENTS.map(([t, l]) => `# event: ${fmtT(t)}, ${l}`),
  ];
  const boosterCsv = rowsToCsv(boosterHead, boosterRows, false);
  const boosterTrack = parseTrack(boosterCsv, "booster.csv");

  // --- ship rows
  const shipTimes = timeGrid(
    [
      [0, T.meco, 1],
      [T.meco, T.hotStaging + 30, 0.5],
      [T.hotStaging + 30, 600, 1],
      [600, T.insertionStart - 30, 10],
      [T.insertionStart - 30, T.insertionEnd + 30, 2],
      [T.insertionEnd + 30, T.deorbitStart - 120, 20],
      [T.deorbitStart - 120, T.deorbitEnd + 120, 2],
      [T.deorbitEnd + 120, T.entry - 300, 20],
      [T.entry - 300, T.shipCatch - 600, 2],
      [T.shipCatch - 600, T.shipLandingBurn - 4, 1],
      [T.shipLandingBurn - 4, T.shipCatch, 0.5],
    ],
    SHIP_EVENTS.map(([t]) => t),
    T.shipCatch,
  );
  // joint ascent: ship base = booster base + booster nose (as drawn) · 72.3 m, same attitude
  const stackQ = new Map<number, THREE.Quaternion>();
  const ship: Row[] = shipTimes.map((t) => {
    if (t < T.hotStaging) {
      const b = noseAt(boosterTrack, t);
      stackQ.set(t, b.q);
      return { t, lla: ecefToLla(axpy(b.pos, BOOSTER_LENGTH_M / 1000, b.nose)) };
    }
    if (t <= T.seco) return { t, lla: llaOf(shipAscRec.at(t, shipF)) };
    if (t <= T.insertionEnd) return { t, lla: llaOf(insRec.at(t, insF)) };
    if (t <= ent.preBurn.t) return { t, lla: llaOf(coastStateAt(table, t, ent.shift)) };
    if (t <= gate.t) return { t, lla: llaOf(entRec.at(t, entF)) };
    return { t, lla: term.positionAt(t) };
  });
  const bad = ship.find((r) => !Number.isFinite(r.lla.latDeg + r.lla.lonDeg + r.lla.altKm));
  if (bad) {
    console.error("non-finite ship row", bad, { shift: ent.shift, cv0: ent.cv0, dv: ent.dv, gate: llaOf(gate), gateT: gate.t, diag: term.diag });
    throw new Error("non-finite ship row");
  }

  // ship attitude (tabulated): the booster's attitude while stacked; then rules evaluated with the library, plus the belly flop
  const shipHead = [
    ...header("Starship S42「Don't Panic」（推定再現）", "starship-v3-ship"),
    "# attitude_frame: ECEF",
    "# Track point = the ship's base (engine end). Stacked ascent: booster base + stack axis x 72.3 m (booster length), the booster's attitude.",
    "# Attitude is tabulated in the qw..qz columns (body to ECEF): stack attitude, then prograde ascent and orbit; retrograde for the deorbit burn; aoa 67 deg entry; level belly flop; vertical flip.",
    ...SHIP_EVENTS.map(([t, l]) => `# event: ${fmtT(t)}, ${l}`),
  ];
  const plainTrack = parseTrack(rowsToCsv(shipHead.filter((l) => !l.startsWith("# attitude_frame")), ship, false), "ship.csv");
  type Spec = (t: number) => THREE.Quaternion;
  const pro: Spec = (t) => modeQuat(plainTrack, "prograde", t);
  const schedule: [number, number, Spec][] = [
    [T.deorbitStart - 50, 30, (t) => modeQuat(plainTrack, "retrograde", t)],
    [T.deorbitEnd + 20, 60, pro],
    [T.entry - 400, 120, (t) => modeQuat(plainTrack, "aoa", t, ENTRY_AOA_DEG)],
    [T.subsonic - 5, 15, (t) => bellyFlopQuat(plainTrack, t)],
    [T.shipLandingBurn, T.flip - T.shipLandingBurn + 3, (t) => modeQuat(plainTrack, "vertical", t)],
  ];
  for (const row of ship) {
    const stacked = stackQ.get(row.t);
    if (stacked) {
      row.q = stacked;
      continue;
    }
    let q = pro(row.t);
    for (const [t0, dur, spec] of schedule) {
      if (row.t < t0) break;
      q = q.clone().slerp(spec(row.t), smoothstep(0, 1, (row.t - t0) / dur));
    }
    row.q = q;
  }
  const shipCsv = rowsToCsv(shipHead, ship, true);

  // --- separation gap (as drawn: both bodies along their noses from their bases)
  const shipTrack = parseTrack(shipCsv, "ship.csv");
  const separationGapM: Record<string, number> = {};
  for (const dt of [0, 1, 2, 5, 10]) {
    const b = noseAt(boosterTrack, T.hotStaging + dt);
    const s = noseAt(shipTrack, T.hotStaging + dt);
    separationGapM[`+${dt}s`] = axisGapM(b.pos, b.nose, BOOSTER_LENGTH_M, s.pos, s.nose, SHIP_LENGTH_M);
  }

  // --- report
  const stagingL = toLocal(staging);
  const secoL = llaOf(seco);
  const report = {
    launchAzimuthDeg: LAUNCH_AZ_DEG,
    stack: asc.stackP,
    shipAscent: { ...asc.shipP, a0G: asc.shipP.a0 / G0 },
    maxQ: { tS: maxQ.t, kPa: maxQ.q / 1000 },
    staging: { altKm: stagingL.p[2], speedKmh: Math.hypot(...stagingL.v) * 3600, downrangeKm: groundDistanceKm(llaOf(staging), PAD) },
    separationGapM,
    seco: { altKm: secoL.altKm, speedKmhRel: norm(vRelEci(seco.r, seco.v)) * 3600, inertialKmS: norm(seco.v), downrangeKm: groundDistanceKm(secoL, PAD) },
    orbit: { perigeeKm: orbit.rp - RE, apogeeKm: orbit.ra - RE, inclinationDeg: orbit.inc },
    phaseShiftS: ent.shift,
    phaseShiftKm: ent.shift * norm(post.v),
    deorbitDvMs: ent.dv * 1000,
    deorbitPoint: llaOf(ent.preBurn),
    entryInterface: { t: eiCross, ...llaOf(entRec.at(T.entry, entF)) },
    entry: { cv0: ent.cv0, beta: ent.beta, peakNonGravG: peakEntryG, peakQkPa: peakQ / 1000, aim: ent.aim, aimNorthOfCrossingKm: a1.dn },
    gate: { t: gate.t, ...llaOf(gate), speedKmS: norm(vRelEci(gate.r, gate.v)) },
    terminal: term.diag,
    booster: {
      boostback: bbP,
      accG: bbP.acc / G0,
      reversalT,
      apogeeT,
      aimAtLandingBurn: { ...enToLatLon(bAim.e, bAim.n), e: bAim.e, n: bAim.n },
      end: boosterTerm.positionAt(boosterTerm.tEnd),
      endMissM: groundDistanceKm(boosterTerm.positionAt(boosterTerm.tEnd), BOOSTER_END) * 1000,
      tEnd: boosterTerm.tEnd,
      terminal: boosterTerm.diag,
    },
    rows: { booster: boosterRows.length, ship: ship.length },
  };
  return { boosterCsv, shipCsv, report };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..");
  const out = join(root, "public", "demos", "flight15");
  const { boosterCsv, shipCsv, report } = build();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "booster.csv"), boosterCsv);
  writeFileSync(join(out, "ship.csv"), shipCsv);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${join(out, "booster.csv")} (${boosterCsv.length} B), ${join(out, "ship.csv")} (${shipCsv.length} B)`);
}

/** Internals for ad-hoc diagnostics (not part of the data contract). */
export const __internal = { flyBooster, toLocal, newton, G0 };
