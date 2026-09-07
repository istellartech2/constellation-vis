/**
 * Walker Delta (rosette) — the original and only pre-refactor pattern.
 *
 * The two angle expressions in `planWalkerDelta` are a *literal* transcription
 * of the old `generateFromShellsDetailed`. Do not algebraically simplify them
 * (e.g. hoist `360 / count` or fold `raanRange / planes` into a constant step):
 * the floating-point result changes in the last bit and
 * `tests/constellationPatternsBaseline.test.ts` — the contract that existing
 * TOML files keep producing byte-identical satellites — fails.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { greedyPlaneSizes } from "./emit";
import { orbitFromShell } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import type {
  PatternGenerator,
  PatternShellInput,
  PlanePlan,
  ShellDerived,
  ShellPlan,
  ValidationError,
} from "./types";

export interface UniformLatticeSpec {
  planes: number;
  /** Satellites per plane before the `count` cut-off. */
  perPlane: number;
  /** Total satellites; generation stops as soon as this many exist. */
  count: number;
  raanDeg: (plane: number) => number;
  meanAnomalyDeg: (plane: number, slot: number) => number;
}

/**
 * Generic plane-major lattice walk. The angle laws stay in the caller's
 * closures so each pattern keeps its own literal expression.
 *
 * Empty trailing planes are kept (matching the legacy loop, which iterated all
 * `planes` but stopped emitting once `count` satellites existed) so
 * `planeSizes.length === planes` holds for every pattern.
 */
export function uniformLattice(spec: UniformLatticeSpec): PlanePlan[] {
  const plans: PlanePlan[] = [];
  let generated = 0;
  for (let p = 0; p < spec.planes; p++) {
    const raanDeg = spec.raanDeg(p);
    const meanAnomaliesDeg: number[] = [];
    for (let j = 0; j < spec.perPlane && generated < spec.count; j++) {
      meanAnomaliesDeg.push(spec.meanAnomalyDeg(p, j));
      generated++;
    }
    plans.push({ raanDeg, meanAnomaliesDeg });
  }
  return plans;
}

/** Walker Delta plan. Reused verbatim by `lattice_flower`, which is a relabelled delta. */
export function planWalkerDelta(shell: PatternShellInput): ShellPlan {
  const count = numberField("count", shell);
  const planes = numberField("planes", shell);
  const perPlane = Math.ceil(count / planes);
  const phasing = numberField("phasing", shell);
  const raanRange = numberField("raan_range", shell);
  const raanStart = numberField("raan_start", shell);
  const m0 = numberField("mean_anomaly_0", shell);

  const plans = uniformLattice({
    planes,
    perPlane,
    count,
    raanDeg: (p) => raanStart + (raanRange * p) / planes,
    meanAnomalyDeg: (p, j) => (m0 + (360 / count) * (p * phasing + j * planes)) % 360,
  });

  return { plans, orbit: orbitFromShell(shell), wrapPlanes: true, warnings: [] };
}

/** `T/P/F: i` Walker notation. */
export function walkerNotation(
  count: number,
  planes: number,
  phasing: number,
  inclinationDeg: number,
): string {
  return `${count}/${planes}/${phasing}: ${Number(inclinationDeg.toFixed(2))}`;
}

/**
 * Nc of the equivalent 2D lattice-flower constellation, or null when the shell
 * is not a clean lattice (fractional F, or `count` not divisible by `planes`).
 * Inverse of `latticeFlower`'s `F = (No − Nc) mod No`.
 */
export function lfcNcFromWalker(count: number, planes: number, phasing: number): number | null {
  if (!Number.isInteger(planes) || planes <= 0) return null;
  if (!Number.isInteger(count) || count % planes !== 0) return null;
  if (!Number.isInteger(phasing)) return null;
  return (((planes - phasing) % planes) + planes) % planes;
}

export function deriveWalkerDelta(shell: PatternShellInput): ShellDerived {
  const count = numberField("count", shell);
  const planes = numberField("planes", shell);
  const phasing = numberField("phasing", shell);
  const raanRange = numberField("raan_range", shell);
  const orbit = orbitFromShell(shell);

  return {
    ...buildCommonDerived({
      totalSats: count,
      planes,
      planeSizes: greedyPlaneSizes(count, planes),
      orbit,
      raanSpacingDeg: planes > 0 ? raanRange / planes : 0,
      inPlaneSpacingDeg: count > 0 ? (360 / count) * planes : 0,
      interPlaneOffsetDeg: count > 0 ? (360 / count) * phasing : 0,
    }),
    pattern: "walker_delta",
    walkerNotation: walkerNotation(count, planes, phasing, orbit.inclinationDeg),
    phasing,
    lfcNc: lfcNcFromWalker(count, planes, phasing),
  };
}

export const walkerDeltaGenerator: PatternGenerator = {
  id: "walker_delta",
  fields: fieldKeysForPattern("walker_delta"),
  plan: planWalkerDelta,
  derive: deriveWalkerDelta,
  validate: (): ValidationError[] => [],
};
