/**
 * Walker Star — planes spread over a half plane (0..180°) so that the first and
 * last plane are *counter-rotating* neighbours across a seam (Iridium-style).
 *
 *   Ω_p = raan_start + p·Δco,   Δco = raan_spacing ?? raan_range / planes
 *   seam = raan_range − (planes − 1)·Δco
 *   M    = (m0 + (360/count)·(p·F + j·P)) % 360,   F defaults to P/2
 *
 * The seam is wider than Δco because satellites on either side of it move in
 * opposite directions, so `wrapPlanes` is false: the last plane is *not* a
 * usable +Grid neighbour of plane 0.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { greedyPlaneSizes } from "./emit";
import { orbitFromShell } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import { uniformLattice, walkerNotation } from "./walkerDelta";
import type {
  PatternGenerator,
  PatternShellInput,
  ShellDerived,
  ShellPlan,
  ShellWarning,
  ValidationError,
} from "./types";

/** Beyond this many degrees from 90° a "star" no longer produces a real seam. */
const POLAR_TOLERANCE_DEG = 10;

export interface StarCoreInput {
  count: number;
  planes: number;
  /** Inter-plane phasing F (mean-anomaly offset = 360·F/count). */
  phasing: number;
  raanStartDeg: number;
  raanRangeDeg: number;
  /**
   * Explicit co-rotating plane spacing. When undefined the plane RAAN is
   * computed with the Walker-Delta expression `raanStart + (range·p)/planes`
   * so an unparameterised star is *bit-identical* to a delta with
   * `raan_range = 180` (see the equivalence test).
   */
  raanSpacingDeg?: number;
  meanAnomaly0Deg: number;
}

/** Shared plane/anomaly layout for walker_star and streets_of_coverage. */
export function planStarCore(input: StarCoreInput, shell: PatternShellInput): ShellPlan {
  const { count, planes, phasing, raanStartDeg, raanRangeDeg, meanAnomaly0Deg } = input;
  const perPlane = Math.ceil(count / planes);
  const spacing = input.raanSpacingDeg;

  const raanDeg =
    spacing === undefined
      ? (p: number) => raanStartDeg + (raanRangeDeg * p) / planes
      : (p: number) => raanStartDeg + p * spacing;

  const plans = uniformLattice({
    planes,
    perPlane,
    count,
    raanDeg,
    meanAnomalyDeg: (p, j) =>
      (meanAnomaly0Deg + (360 / count) * (p * phasing + j * planes)) % 360,
  });

  return { plans, orbit: orbitFromShell(shell), wrapPlanes: false, warnings: [] };
}

export function starCoreInput(shell: PatternShellInput): StarCoreInput {
  return {
    count: numberField("count", shell),
    planes: numberField("planes", shell),
    phasing: numberField("phasing", shell),
    raanStartDeg: numberField("raan_start", shell),
    raanRangeDeg: numberField("raan_range", shell),
    raanSpacingDeg: shell.raan_spacing === undefined ? undefined : Number(shell.raan_spacing),
    meanAnomaly0Deg: numberField("mean_anomaly_0", shell),
  };
}

/** Δco actually used, whether explicit or derived from the range. */
export function starCoSpacingDeg(shell: PatternShellInput): number {
  const planes = numberField("planes", shell);
  if (shell.raan_spacing !== undefined) return Number(shell.raan_spacing);
  return planes > 0 ? numberField("raan_range", shell) / planes : 0;
}

export function starSeamDeg(shell: PatternShellInput): number {
  const planes = numberField("planes", shell);
  return numberField("raan_range", shell) - (planes - 1) * starCoSpacingDeg(shell);
}

export function inclinationWarnings(inclinationDeg: number): ShellWarning[] {
  if (Math.abs(inclinationDeg - 90) <= POLAR_TOLERANCE_DEG) return [];
  return [
    {
      code: "inclination_not_polar",
      message: `傾斜角 ${inclinationDeg.toFixed(1)}° は極軌道(90°±${POLAR_TOLERANCE_DEG}°)から外れています。Walker Star のシーム構造は成立しません。`,
    },
  ];
}

export function planWalkerStar(shell: PatternShellInput): ShellPlan {
  const plan = planStarCore(starCoreInput(shell), shell);
  return { ...plan, warnings: inclinationWarnings(plan.orbit.inclinationDeg) };
}

export function deriveWalkerStar(shell: PatternShellInput): ShellDerived {
  const count = numberField("count", shell);
  const planes = numberField("planes", shell);
  const phasing = numberField("phasing", shell);
  const orbit = orbitFromShell(shell);
  const coSpacingDeg = starCoSpacingDeg(shell);
  const warnings = inclinationWarnings(orbit.inclinationDeg);

  return {
    ...buildCommonDerived({
      totalSats: count,
      planes,
      planeSizes: greedyPlaneSizes(count, planes),
      orbit,
      raanSpacingDeg: coSpacingDeg,
      inPlaneSpacingDeg: count > 0 ? (360 / count) * planes : 0,
      interPlaneOffsetDeg: count > 0 ? (360 / count) * phasing : 0,
      warnings,
    }),
    pattern: "walker_star",
    walkerNotation: walkerNotation(count, planes, phasing, orbit.inclinationDeg),
    phasing,
    coSpacingDeg,
    seamDeg: starSeamDeg(shell),
    inclinationPolar: warnings.length === 0,
  };
}

export function validateWalkerStar(shell: PatternShellInput, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const planes = numberField("planes", shell);

  if (shell.raan_spacing !== undefined) {
    const spacing = Number(shell.raan_spacing);
    if (!Number.isFinite(spacing) || spacing <= 0) {
      errors.push({
        field: `shell.${index}.raan_spacing`,
        message: "軌道面間隔は正の数が必要です",
      });
    } else {
      const seam = starSeamDeg(shell);
      if (seam <= 0) {
        errors.push({
          field: `shell.${index}.raan_spacing`,
          message: `軌道面間隔 ${spacing}° × ${planes - 1} が RAAN 範囲 ${numberField("raan_range", shell)}° を超えており、シームが残りません(シーム ${seam.toFixed(3)}°)`,
        });
      }
    }
  }

  const inclination = numberField("inclination", shell);
  for (const warning of inclinationWarnings(inclination)) {
    errors.push({
      field: `shell.${index}.inclination`,
      message: warning.message,
      severity: "warning",
    });
  }

  return errors;
}

export const walkerStarGenerator: PatternGenerator = {
  id: "walker_star",
  fields: fieldKeysForPattern("walker_star"),
  plan: planWalkerStar,
  derive: deriveWalkerStar,
  validate: validateWalkerStar,
};
