/**
 * Flower Constellation (original Mortari formulation).
 *
 * Reference: D. Mortari, M. P. Wilkins, C. Bruccoleri,
 * "The Flower Constellations", Journal of the Astronautical Sciences 52(1-2), 2004.
 *
 * All satellites share one compatible (repeat-ground-track) orbit — same a, e,
 * i, ω — and differ only in (Ω, M):
 *
 *   Ω_k = Ω₀ + 360°·k·Fn/Fd
 *   M_k = M₀ − 360°·k·(Np·Fn + Fd·Fh)/(Fd·Nd)     (mod 360°),  k = 0..Ns−1
 *
 * which keeps the phasing invariant `Np·Ω_k + Nd·M_k ≡ const (mod 360°)`, i.e.
 * every satellite traces the same closed relative trajectory.
 *
 * The semi-major axis is *not* a free parameter: it is solved from the
 * compatibility condition Np revolutions per Nd repeat days at the chosen
 * inclination and eccentricity (`rgt.ts`), so `apogee_altitude` is only a
 * solver seed and a cross-check.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { normalizeAngleDeg } from "./emit";
import { EARTH_RADIUS_KM, gcd, semiMajorAxisFromApogeeAltitude } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import { solveAltitudeFromInclinationAndRatio } from "../rgt";
import type {
  PatternGenerator,
  PatternShellInput,
  PlanePlan,
  ShellDerived,
  ShellOrbit,
  ShellPlan,
  ShellWarning,
  ValidationError,
} from "./types";

/** Altitude seed handed to the RGT solver when the shell stores none. */
const DEFAULT_ALTITUDE_SEED_KM = 700;
/** Tolerated disagreement between the stored and solved apogee altitude. */
const APOGEE_MISMATCH_TOLERANCE_KM = 1;

export interface FlowerParams {
  np: number;
  nd: number;
  fn: number;
  fd: number;
  fh: number;
  ns: number;
}

export function flowerParams(shell: PatternShellInput): FlowerParams {
  return {
    np: numberField("flower_np", shell),
    nd: numberField("flower_nd", shell),
    fn: numberField("flower_fn", shell),
    fd: numberField("flower_fd", shell),
    fh: numberField("flower_fh", shell),
    ns: numberField("count", shell),
  };
}

/** Ns_max = Nd·Fd / gcd(Nd, Np·Fn + Fd·Fh) — beyond this satellites co-locate. */
export function flowerMaxSatellites(p: FlowerParams): number {
  const g = gcd(p.nd, p.np * p.fn + p.fd * p.fh);
  if (g === 0) return Number.POSITIVE_INFINITY;
  return (p.nd * p.fd) / g;
}

export interface FlowerOrbitSolution {
  orbit: ShellOrbit;
  solvedSemiMajorAxisKm: number | null;
  solvedApogeeAltitudeKm: number | null;
  storedApogeeAltitudeKm: number | undefined;
  mismatchKm: number | null;
  warnings: ShellWarning[];
}

/**
 * Solves the compatible semi-major axis. Falls back to the stored apogee
 * altitude (with a `solver_failed` warning) rather than throwing, so the editor
 * keeps rendering while the user types.
 */
export function flowerOrbit(shell: PatternShellInput): FlowerOrbitSolution {
  const params = flowerParams(shell);
  const ecc = numberField("eccentricity", shell);
  const inclinationDeg = numberField("inclination", shell);
  const argPerigeeDeg = numberField("argp", shell);
  const storedApogeeAltitudeKm = shell.apogee_altitude;
  const warnings: ShellWarning[] = [];

  const solution =
    params.np > 0 && params.nd > 0
      ? solveAltitudeFromInclinationAndRatio(
          storedApogeeAltitudeKm ?? DEFAULT_ALTITUDE_SEED_KM,
          inclinationDeg,
          params.np,
          params.nd,
          ecc,
        )
      : null;

  if (!solution) {
    warnings.push({
      code: "solver_failed",
      message: `Np/Nd = ${params.np}/${params.nd}(i = ${inclinationDeg}°, e = ${ecc})を満たす半長軸が見つかりませんでした。格納された高度 ${storedApogeeAltitudeKm ?? 0} km を使用します。`,
    });
    return {
      orbit: {
        semiMajorAxisKm: semiMajorAxisFromApogeeAltitude(storedApogeeAltitudeKm ?? 0, ecc),
        eccentricity: ecc,
        inclinationDeg,
        argPerigeeDeg,
      },
      solvedSemiMajorAxisKm: null,
      solvedApogeeAltitudeKm: null,
      storedApogeeAltitudeKm,
      mismatchKm: null,
      warnings,
    };
  }

  // `RgtAltitudeSolution.altitudeKm` is a − Re, i.e. the *mean* altitude; the
  // schema's `apogee_altitude` is a(1+e) − Re.
  const solvedApogeeAltitudeKm = solution.semiMajorAxisKm * (1 + ecc) - EARTH_RADIUS_KM;
  const mismatchKm =
    storedApogeeAltitudeKm === undefined
      ? null
      : Math.abs(storedApogeeAltitudeKm - solvedApogeeAltitudeKm);

  if (mismatchKm !== null && mismatchKm > APOGEE_MISMATCH_TOLERANCE_KM) {
    warnings.push({
      code: "derived_mismatch",
      message: `格納された遠地点高度 ${storedApogeeAltitudeKm} km は Np/Nd = ${params.np}/${params.nd} から導出される ${solvedApogeeAltitudeKm.toFixed(3)} km と ${mismatchKm.toFixed(3)} km 異なります。導出値を使用します。`,
    });
  }

  return {
    orbit: {
      semiMajorAxisKm: solution.semiMajorAxisKm,
      eccentricity: ecc,
      inclinationDeg,
      argPerigeeDeg,
    },
    solvedSemiMajorAxisKm: solution.semiMajorAxisKm,
    solvedApogeeAltitudeKm,
    storedApogeeAltitudeKm,
    mismatchKm,
    warnings,
  };
}

/** Raw (Ω, M) pairs in generation order k = 0..Ns−1, before plane bucketing. */
export function flowerSlots(p: FlowerParams, raanStartDeg: number, meanAnomaly0Deg: number) {
  const slots: { k: number; plane: number; raanDeg: number; meanAnomalyDeg: number }[] = [];
  if (!(p.fd > 0) || !(p.nd > 0)) return slots;
  for (let k = 0; k < p.ns; k++) {
    slots.push({
      k,
      // Every k in the same bucket shares Ω mod 360, so the bucket index is the
      // plane index.
      plane: ((k * p.fn) % p.fd + p.fd) % p.fd,
      raanDeg: raanStartDeg + (360 * k * p.fn) / p.fd,
      meanAnomalyDeg:
        meanAnomaly0Deg - (360 * k * (p.np * p.fn + p.fd * p.fh)) / (p.fd * p.nd),
    });
  }
  return slots;
}

export function planFlower(shell: PatternShellInput): ShellPlan {
  const params = flowerParams(shell);
  const solved = flowerOrbit(shell);
  const raanStartDeg = numberField("raan_start", shell);
  const meanAnomaly0Deg = numberField("mean_anomaly_0", shell);
  const warnings: ShellWarning[] = [...solved.warnings];

  const slots = flowerSlots(params, raanStartDeg, meanAnomaly0Deg);

  // Bucket by plane, then order the planes by ascending RAAN so the emitted
  // array is plane-major with monotone RAAN (what the +Grid ISL topology and
  // the 3D orbit rendering assume).
  const buckets = new Map<number, number[]>();
  for (const slot of slots) {
    const bucket = buckets.get(slot.plane);
    if (bucket) bucket.push(normalizeAngleDeg(slot.meanAnomalyDeg));
    else buckets.set(slot.plane, [normalizeAngleDeg(slot.meanAnomalyDeg)]);
  }

  const plans: PlanePlan[] = [...buckets.entries()]
    .map(([plane, meanAnomaliesDeg]) => ({
      plane,
      raanDeg: normalizeAngleDeg(raanStartDeg + (360 * plane) / params.fd),
      meanAnomaliesDeg: meanAnomaliesDeg.slice().sort((a, b) => a - b),
    }))
    .sort((a, b) => a.raanDeg - b.raanDeg || a.plane - b.plane)
    .map(({ raanDeg, meanAnomaliesDeg }) => ({ raanDeg, meanAnomaliesDeg }));

  const sizes = plans.map((plane) => plane.meanAnomaliesDeg.length);
  if (sizes.length > 1 && sizes.some((size) => size !== sizes[0])) {
    warnings.push({
      code: "uneven_planes",
      message: `軌道面あたりの衛星数が不均等です(${sizes.join(", ")})。Ns = ${params.ns} が Fd = ${params.fd} の倍数ではありません。`,
    });
  }

  const duplicates = countDuplicateSlots(plans);
  if (duplicates > 0) {
    warnings.push({
      code: "fc_duplicate_slots",
      message: `${duplicates} 機が既存の (RAAN, 平均近点角) スロットと重複しています。Ns ≤ ${flowerMaxSatellites(params)} にしてください。`,
    });
  }

  return { plans, orbit: solved.orbit, wrapPlanes: true, warnings };
}

function countDuplicateSlots(plans: readonly PlanePlan[]): number {
  let duplicates = 0;
  for (const plane of plans) {
    const seen = new Set<number>();
    for (const ma of plane.meanAnomaliesDeg) {
      // Round to 1e-6 deg so solver noise is not mistaken for a distinct slot.
      const key = Math.round(ma * 1e6);
      if (seen.has(key)) duplicates++;
      else seen.add(key);
    }
  }
  return duplicates;
}

/** Plane occupancy without building any orbital elements. */
export function flowerPlaneSizes(p: FlowerParams): number[] {
  if (!(p.fd > 0)) return [];
  const sizes = new Array<number>(p.fd).fill(0);
  for (let k = 0; k < p.ns; k++) {
    sizes[((k * p.fn) % p.fd + p.fd) % p.fd]++;
  }
  return sizes;
}

export function deriveFlower(shell: PatternShellInput): ShellDerived {
  const params = flowerParams(shell);
  const solved = flowerOrbit(shell);
  const planeSizes = flowerPlaneSizes(params);
  const warnings: ShellWarning[] = [...solved.warnings];
  if (planeSizes.length > 1 && planeSizes.some((size) => size !== planeSizes[0])) {
    warnings.push({
      code: "uneven_planes",
      message: `軌道面あたりの衛星数が不均等です(${planeSizes.join(", ")})。`,
    });
  }

  const nsMax = flowerMaxSatellites(params);
  const g = gcd(params.nd, params.np * params.fn + params.fd * params.fh);

  return {
    ...buildCommonDerived({
      totalSats: params.ns,
      planes: params.fd,
      planeSizes,
      orbit: solved.orbit,
      raanSpacingDeg: params.fd > 0 ? 360 / params.fd : 0,
      inPlaneSpacingDeg:
        planeSizes.length > 0 && planeSizes[0] > 0 ? 360 / planeSizes[0] : 0,
      interPlaneOffsetDeg:
        params.fd > 0 && params.nd > 0
          ? normalizeAngleDeg(
              -(360 * (params.np * params.fn + params.fd * params.fh)) / (params.fd * params.nd),
            )
          : 0,
      warnings,
    }),
    pattern: "flower",
    np: params.np,
    nd: params.nd,
    fn: params.fn,
    fd: params.fd,
    fh: params.fh,
    ns: params.ns,
    nsMax,
    repeatDays: params.nd,
    repeatOrbits: params.np,
    solvedSemiMajorAxisKm: solved.solvedSemiMajorAxisKm,
    solvedApogeeAltitudeKm: solved.solvedApogeeAltitudeKm,
    apogeeAltitudeMismatchKm: solved.mismatchKm,
    harmonicNc: g > 0 ? g : null,
  };
}

export function validateFlower(shell: PatternShellInput, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const p = flowerParams(shell);

  if (!Number.isInteger(p.np) || p.np < 1) {
    errors.push({ field: `shell.${index}.flower_np`, message: "Np は1以上の整数が必要です" });
  }
  if (!Number.isInteger(p.nd) || p.nd < 1) {
    errors.push({ field: `shell.${index}.flower_nd`, message: "Nd は1以上の整数が必要です" });
  }
  if (!Number.isInteger(p.fn) || p.fn < 1) {
    errors.push({ field: `shell.${index}.flower_fn`, message: "Fn は1以上の整数が必要です" });
  }
  if (!Number.isInteger(p.fd) || p.fd < 1) {
    errors.push({ field: `shell.${index}.flower_fd`, message: "Fd は1以上の整数が必要です" });
  }
  if (errors.length > 0) return errors;

  if (gcd(p.np, p.nd) !== 1) {
    errors.push({
      field: `shell.${index}.flower_np`,
      message: `Np と Nd は互いに素である必要があります(gcd(${p.np}, ${p.nd}) = ${gcd(p.np, p.nd)})`,
    });
  }
  if (gcd(p.fn, p.fd) !== 1) {
    errors.push({
      field: `shell.${index}.flower_fn`,
      message: `Fn と Fd は互いに素である必要があります(gcd(${p.fn}, ${p.fd}) = ${gcd(p.fn, p.fd)})`,
    });
  }
  if (!Number.isInteger(p.fh) || p.fh < 0 || p.fh > p.nd - 1) {
    errors.push({
      field: `shell.${index}.flower_fh`,
      message: `Fh は 0..${p.nd - 1} の整数である必要があります`,
    });
  }

  const nsMax = flowerMaxSatellites(p);
  if (p.ns > nsMax) {
    errors.push({
      field: `shell.${index}.count`,
      message: `衛星数 ${p.ns} が配置可能上限 Ns_max = Nd·Fd/G = ${nsMax} を超えています(G = gcd(Nd, Np·Fn + Fd·Fh) = ${gcd(p.nd, p.np * p.fn + p.fd * p.fh)})。同一位置に重複配置されます。`,
    });
  }

  for (const warning of flowerOrbit(shell).warnings) {
    errors.push({
      field: `shell.${index}.apogee_altitude`,
      message: warning.message,
      severity: "warning",
    });
  }

  return errors;
}

export const flowerGenerator: PatternGenerator = {
  id: "flower",
  fields: fieldKeysForPattern("flower"),
  plan: planFlower,
  derive: deriveFlower,
  validate: validateFlower,
};
