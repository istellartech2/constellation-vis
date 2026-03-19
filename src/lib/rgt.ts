/**
 * Repeat Ground Track (RGT) utilities based on J2-averaged mean elements.
 * Reference: docs/RGTorbit.md
 */

const MU = 3.986004418e14; // Earth's gravitational parameter (m^3/s^2)
const RE = 6378137.0; // Earth's equatorial radius (m)
const J2 = 1.08263e-3; // Second zonal harmonic coefficient
const OMEGA_E = 7.2921150e-5; // Earth rotation rate (rad/s, sidereal)
const DEG_TO_RAD = Math.PI / 180;

const RE_KM = RE / 1000;

export interface RgtSolveOptions {
  minRepeatDays?: number;
  maxRepeatDays?: number;
  maxRepeatOrbits?: number;
  minAltitudeKm?: number;
  maxAltitudeKm?: number;
  maxIterations?: number;
  minInclinationDeg?: number;
  maxInclinationDeg?: number;
}

export interface RgtSolution {
  semiMajorAxisKm: number;
  altitudeKm: number;
  repeatOrbits: number; // N_S
  repeatDays: number; // N_D
  ratio: number; // N_S / N_D
  tau0: number; // initial ratio from input altitude
  error: number; // |ratio - tau0|
}

export interface RgtRatioSuggestion {
  repeatOrbits: number;
  repeatDays: number;
  ratio: number;
  tau0: number;
  error: number;
}

export interface RgtAltitudeSolution {
  semiMajorAxisKm: number;
  altitudeKm: number;
}

export interface RgtInclinationSolution {
  inclinationDeg: number;
}

interface J2Rates {
  n: number; // rad/s
  dOmega_dt: number; // rad/s
  domega_dt: number; // rad/s
  delta_n: number; // rad/s
}

function computeJ2Rates(aMeters: number, e: number, iRad: number): J2Rates | null {
  const oneMinusESq = 1 - e * e;
  if (oneMinusESq <= 0) return null;
  const beta = Math.pow(oneMinusESq, 2);
  if (beta <= 0) return null;

  const n = Math.sqrt(MU / (aMeters * aMeters * aMeters));
  const k2 = 1.5 * J2 * RE * RE;

  const cos_i = Math.cos(iRad);
  const sin_i = Math.sin(iRad);
  const sin_i_sq = sin_i * sin_i;

  const dOmega_dt = -k2 * n * cos_i / (aMeters * aMeters * beta);
  const domega_dt = k2 * n * (2 - 2.5 * sin_i_sq) / (aMeters * aMeters * beta);
  const delta_n = k2 * n * (1 - 3 * sin_i_sq) / (2 * aMeters * aMeters * beta);

  return { n, dOmega_dt, domega_dt, delta_n };
}

function computeTau(aMeters: number, e: number, iRad: number): number | null {
  const rates = computeJ2Rates(aMeters, e, iRad);
  if (!rates) return null;
  const denom = OMEGA_E - rates.dOmega_dt;
  if (Math.abs(denom) < 1e-12) return null;
  return (rates.n + rates.delta_n + rates.domega_dt) / denom;
}

function evaluateF(aMeters: number, e: number, iRad: number, tau: number): number | null {
  const rates = computeJ2Rates(aMeters, e, iRad);
  if (!rates) return null;
  return tau * (OMEGA_E - rates.dOmega_dt) - (rates.n + rates.delta_n + rates.domega_dt);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function pickRepeatRatio(tau0: number, options: RgtSolveOptions): { nS: number; nD: number; ratio: number; error: number } | null {
  if (!Number.isFinite(tau0) || tau0 <= 0) return null;

  const minDays = Math.max(1, Math.floor(options.minRepeatDays ?? 1));
  const maxDays = Math.max(minDays, Math.floor(options.maxRepeatDays ?? 30));
  const maxOrbits = Math.max(1, Math.floor(options.maxRepeatOrbits ?? 2000));

  let best: { nS: number; nD: number; ratio: number; error: number } | null = null;

  for (let nD = minDays; nD <= maxDays; nD += 1) {
    const nS = Math.round(tau0 * nD);
    if (nS < 1 || nS > maxOrbits) continue;

    const ratio = nS / nD;
    const error = Math.abs(ratio - tau0);

    if (!best || error < best.error - 1e-12 || (Math.abs(error - best.error) <= 1e-12 && nD < best.nD)) {
      best = { nS, nD, ratio, error };
    }
  }

  if (!best) return null;
  const g = gcd(best.nS, best.nD);
  if (g > 1) {
    const nS = Math.round(best.nS / g);
    const nD = Math.round(best.nD / g);
    return { nS, nD, ratio: nS / nD, error: best.error };
  }
  return best;
}

function solveSemiMajorAxis(
  tau: number,
  e: number,
  iRad: number,
  guessKm: number,
  options: RgtSolveOptions
): number | null {
  const minAltitudeKm = options.minAltitudeKm ?? 120;
  const maxAltitudeKm = options.maxAltitudeKm ?? 50000;

  const minA = (RE_KM + minAltitudeKm) * 1000;
  const maxA = (RE_KM + maxAltitudeKm) * 1000;

  const aGuess = Math.min(Math.max(guessKm * 1000, minA), maxA);
  let fGuess = evaluateF(aGuess, e, iRad, tau);
  if (fGuess === null || !Number.isFinite(fGuess)) return null;
  if (Math.abs(fGuess) < 1e-12) return aGuess / 1000;

  let aLow = aGuess;
  let aHigh = aGuess;
  let fLow = fGuess;
  let fHigh = fGuess;
  let step = 10000; // 10 km

  for (let i = 0; i < 60; i += 1) {
    let expanded = false;
    if (aLow > minA) {
      aLow = Math.max(minA, aLow - step);
      const f = evaluateF(aLow, e, iRad, tau);
      if (f !== null && Number.isFinite(f)) {
        fLow = f;
      }
      expanded = true;
    }
    if (aHigh < maxA) {
      aHigh = Math.min(maxA, aHigh + step);
      const f = evaluateF(aHigh, e, iRad, tau);
      if (f !== null && Number.isFinite(f)) {
        fHigh = f;
      }
      expanded = true;
    }

    if (fLow * fHigh <= 0) break;
    if (!expanded) break;
    step *= 1.4;
  }

  if (fLow * fHigh > 0) return null;

  const maxIterations = options.maxIterations ?? 60;
  let leftA = aLow;
  let rightA = aHigh;
  let leftF = fLow;
  let rightF = fHigh;

  for (let i = 0; i < maxIterations; i += 1) {
    const midA = 0.5 * (leftA + rightA);
    const midF = evaluateF(midA, e, iRad, tau);
    if (midF === null || !Number.isFinite(midF)) return null;

    if (Math.abs(midF) < 1e-12 || Math.abs(rightA - leftA) < 1e-3) {
      return midA / 1000;
    }

    if (leftF * midF <= 0) {
      rightA = midA;
      rightF = midF;
    } else {
      leftA = midA;
      leftF = midF;
    }
  }

  return 0.5 * (leftA + rightA) / 1000;
}

export function suggestRgtRatioFromAltitudeInclination(
  altitudeKm: number,
  inclinationDeg: number,
  eccentricity: number = 0,
  options: RgtSolveOptions = {}
): RgtRatioSuggestion | null {
  const e = Math.min(Math.max(eccentricity, 0), 0.999999);
  const iRad = inclinationDeg * DEG_TO_RAD;
  const guessKm = RE_KM + altitudeKm;

  const tau0 = computeTau(guessKm * 1000, e, iRad);
  if (tau0 === null) return null;

  const ratio = pickRepeatRatio(tau0, options);
  if (!ratio) return null;

  return {
    repeatOrbits: ratio.nS,
    repeatDays: ratio.nD,
    ratio: ratio.ratio,
    tau0,
    error: ratio.error,
  };
}

export function solveAltitudeFromInclinationAndRatio(
  altitudeGuessKm: number,
  inclinationDeg: number,
  repeatOrbits: number,
  repeatDays: number,
  eccentricity: number = 0,
  options: RgtSolveOptions = {}
): RgtAltitudeSolution | null {
  if (repeatOrbits <= 0 || repeatDays <= 0) return null;
  const tau = repeatOrbits / repeatDays;
  if (!Number.isFinite(tau) || tau <= 0) return null;

  const e = Math.min(Math.max(eccentricity, 0), 0.999999);
  const iRad = inclinationDeg * DEG_TO_RAD;
  const guessKm = RE_KM + altitudeGuessKm;

  const solvedA = solveSemiMajorAxis(tau, e, iRad, guessKm, options);
  if (solvedA === null) return null;

  return {
    semiMajorAxisKm: solvedA,
    altitudeKm: solvedA - RE_KM,
  };
}

export function solveInclinationFromAltitudeAndRatio(
  altitudeKm: number,
  repeatOrbits: number,
  repeatDays: number,
  eccentricity: number = 0,
  options: RgtSolveOptions = {}
): RgtInclinationSolution | null {
  if (repeatOrbits <= 0 || repeatDays <= 0) return null;
  const tau = repeatOrbits / repeatDays;
  if (!Number.isFinite(tau) || tau <= 0) return null;

  const e = Math.min(Math.max(eccentricity, 0), 0.999999);
  const aMeters = (RE_KM + altitudeKm) * 1000;

  const minDeg = options.minInclinationDeg ?? 0;
  const maxDeg = options.maxInclinationDeg ?? 180;
  const stepDeg = 1;

  let leftDeg = minDeg;
  let leftF = evaluateF(aMeters, e, leftDeg * DEG_TO_RAD, tau);
  if (leftF === null || !Number.isFinite(leftF)) return null;

  let bracketFound = false;
  let rightDeg = leftDeg;
  let rightF = leftF;

  for (let deg = minDeg + stepDeg; deg <= maxDeg; deg += stepDeg) {
    const f = evaluateF(aMeters, e, deg * DEG_TO_RAD, tau);
    if (f === null || !Number.isFinite(f)) continue;
    if (leftF * f <= 0) {
      rightDeg = deg;
      rightF = f;
      bracketFound = true;
      break;
    }
    leftDeg = deg;
    leftF = f;
  }

  if (!bracketFound) return null;

  const maxIterations = options.maxIterations ?? 60;
  let lo = leftDeg;
  let hi = rightDeg;
  let fLo = leftF;
  let fHi = rightF;

  for (let i = 0; i < maxIterations; i += 1) {
    const mid = 0.5 * (lo + hi);
    const fMid = evaluateF(aMeters, e, mid * DEG_TO_RAD, tau);
    if (fMid === null || !Number.isFinite(fMid)) return null;

    if (Math.abs(fMid) < 1e-12 || Math.abs(hi - lo) < 1e-6) {
      return { inclinationDeg: mid };
    }

    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return { inclinationDeg: 0.5 * (lo + hi) };
}

export function solveRgtFromAltitudeInclination(
  altitudeKm: number,
  inclinationDeg: number,
  eccentricity: number = 0,
  options: RgtSolveOptions = {}
): RgtSolution | null {
  const e = Math.min(Math.max(eccentricity, 0), 0.999999);
  const iRad = inclinationDeg * DEG_TO_RAD;

  const guessKm = RE_KM + altitudeKm;
  const tau0 = computeTau(guessKm * 1000, e, iRad);
  if (tau0 === null) return null;

  const ratio = pickRepeatRatio(tau0, options);
  if (!ratio) return null;

  const solvedA = solveSemiMajorAxis(ratio.ratio, e, iRad, guessKm, options);
  if (solvedA === null) return null;

  const altitudeSolved = solvedA - RE_KM;

  return {
    semiMajorAxisKm: solvedA,
    altitudeKm: altitudeSolved,
    repeatOrbits: ratio.nS,
    repeatDays: ratio.nD,
    ratio: ratio.ratio,
    tau0,
    error: ratio.error,
  };
}
