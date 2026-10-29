import type { SatelliteCatalog } from "./satelliteCatalog";

/**
 * Secular J2 (+J2², J4) analytic propagator for very large catalogs.
 *
 * It applies exactly the secular rates SGP4 derives in `sgp4init` (un-Kozai
 * mean motion, mdot / argpdot / nodedot) to the published mean elements, then
 * solves Kepler's equation. It omits SGP4's short/long-period periodic terms,
 * drag and deep-space lunisolar terms, so positions differ from SGP4 by a few
 * km to ~10 km in LEO over a day — invisible at globe scale, and cheap enough
 * to evaluate for 10^6 satellites per frame in a vertex shader.
 *
 * The same math is mirrored in GLSL by `massSatelliteLayer.ts`; keep the two
 * in sync.
 */

// WGS-72 constants, identical to satellite.js so rates match SGP4.
const MU = 398600.8;
const EARTH_RADIUS_KM = 6378.135;
const XKE = 60 / Math.sqrt((EARTH_RADIUS_KM ** 3) / MU);
const J2 = 0.001082616;
const J4 = -0.00000165597;
const TWO_PI = Math.PI * 2;

export interface J2Orbits {
  count: number;
  epochMs: Float64Array;
  /** Mean semi-major axis, km. */
  semiMajorAxisKm: Float64Array;
  eccentricity: Float64Array;
  inclination: Float64Array;
  /** Angles at epoch (rad). */
  raan0: Float64Array;
  argPerigee0: Float64Array;
  meanAnomaly0: Float64Array;
  /** Secular rates, rad/min. */
  raanDot: Float64Array;
  argPerigeeDot: Float64Array;
  meanAnomalyDot: Float64Array;
}

/** SGP4's secular rates for one set of mean elements (Kozai mean motion in rad/min). */
export function j2SecularRates(meanMotionKozai: number, ecc: number, incl: number) {
  const cosio = Math.cos(incl);
  const cosio2 = cosio * cosio;
  const cosio4 = cosio2 * cosio2;
  const omeosq = 1 - ecc * ecc;
  const rteosq = Math.sqrt(omeosq);
  // Un-Kozai the mean motion (sgp4 initl).
  const ak = Math.pow(XKE / meanMotionKozai, 2 / 3);
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  const no = meanMotionKozai / (1 + del);
  const ao = Math.pow(XKE / no, 2 / 3);
  const po = ao * omeosq;
  const pinvsq = 1 / (po * po);
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - 2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  return {
    semiMajorAxisKm: ao * EARTH_RADIUS_KM,
    meanAnomalyDot: no + 0.5 * temp1 * rteosq * con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4),
    argPerigeeDot: -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4),
    raanDot: -temp1 * cosio + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio,
  };
}

export function j2OrbitsFromCatalog(cat: SatelliteCatalog): J2Orbits {
  const n = cat.count;
  const out: J2Orbits = {
    count: n,
    epochMs: cat.epochMs,
    semiMajorAxisKm: new Float64Array(n),
    eccentricity: cat.eccentricity,
    inclination: cat.inclination,
    raan0: cat.raan,
    argPerigee0: cat.argPerigee,
    meanAnomaly0: cat.meanAnomaly,
    raanDot: new Float64Array(n),
    argPerigeeDot: new Float64Array(n),
    meanAnomalyDot: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const r = j2SecularRates(cat.meanMotion[i], cat.eccentricity[i], cat.inclination[i]);
    out.semiMajorAxisKm[i] = r.semiMajorAxisKm;
    out.raanDot[i] = r.raanDot;
    out.argPerigeeDot[i] = r.argPerigeeDot;
    out.meanAnomalyDot[i] = r.meanAnomalyDot;
  }
  return out;
}

const wrap = (a: number) => a - TWO_PI * Math.floor(a / TWO_PI);

/**
 * Write each satellite's (raan, argp, M) at `refMs` into `out` (3 per sat),
 * wrapped to [0, 2π). The GPU then only adds rate × (t − ref), which stays
 * precise in float32 as long as t − ref is small.
 */
export function j2AnglesAt(orbits: J2Orbits, refMs: number, out: Float32Array) {
  for (let i = 0; i < orbits.count; i++) {
    const dt = (refMs - orbits.epochMs[i]) / 60000;
    const o = i * 3;
    out[o] = wrap(orbits.raan0[i] + orbits.raanDot[i] * dt);
    out[o + 1] = wrap(orbits.argPerigee0[i] + orbits.argPerigeeDot[i] * dt);
    out[o + 2] = wrap(orbits.meanAnomaly0[i] + orbits.meanAnomalyDot[i] * dt);
  }
}

/** Eccentric anomaly from mean anomaly (Newton, seeded like the shader). */
export function solveKepler(meanAnomaly: number, ecc: number): number {
  const m = wrap(meanAnomaly + Math.PI) - Math.PI;
  let e = m + ecc * Math.sin(m);
  for (let k = 0; k < 8; k++) {
    const step = (e - ecc * Math.sin(e) - m) / (1 - ecc * Math.cos(e));
    e -= step;
    // Near-circular orbits converge in 1–2 steps; stop once below ~1 mm in LEO.
    if (Math.abs(step) < 1e-10) break;
  }
  return e;
}

/**
 * TEME-like ECI position (km) and optionally velocity (km/s) of satellite
 * `i` at `tMs`, written into `pos` / `vel` at `offset`. Same frame as
 * `satellite.propagate`.
 */
export function j2StateAt(
  orbits: J2Orbits,
  i: number,
  tMs: number,
  pos: Float32Array | Float64Array | number[],
  offset = 0,
  vel?: Float32Array | Float64Array | number[],
) {
  const dt = (tMs - orbits.epochMs[i]) / 60000;
  const raan = orbits.raan0[i] + orbits.raanDot[i] * dt;
  const argp = orbits.argPerigee0[i] + orbits.argPerigeeDot[i] * dt;
  const mean = orbits.meanAnomaly0[i] + orbits.meanAnomalyDot[i] * dt;
  writeKeplerState(orbits.semiMajorAxisKm[i], orbits.eccentricity[i], orbits.inclination[i], raan, argp, mean, pos, offset, vel);
}

export function writeKeplerState(
  a: number,
  ecc: number,
  incl: number,
  raan: number,
  argp: number,
  mean: number,
  pos: Float32Array | Float64Array | number[],
  offset = 0,
  vel?: Float32Array | Float64Array | number[],
) {
  const E = solveKepler(mean, ecc);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sq = Math.sqrt(1 - ecc * ecc);
  const xp = a * (cosE - ecc);
  const yp = a * sq * sinE;
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(incl), si = Math.sin(incl);
  const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
  const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
  pos[offset] = px * xp + qx * yp;
  pos[offset + 1] = py * xp + qy * yp;
  pos[offset + 2] = pz * xp + qz * yp;
  if (vel) {
    const n = Math.sqrt(MU / (a * a * a));
    const k = (a * n) / (1 - ecc * cosE);
    const vxp = -k * sinE;
    const vyp = k * sq * cosE;
    vel[offset] = px * vxp + qx * vyp;
    vel[offset + 1] = py * vxp + qy * vyp;
    vel[offset + 2] = pz * vxp + qz * vyp;
  }
}

/** Orbital period (minutes) from the anomalistic mean motion. */
export function j2PeriodMinutes(orbits: J2Orbits, i: number): number {
  return TWO_PI / orbits.meanAnomalyDot[i];
}
