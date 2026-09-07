/**
 * Pattern registry: the single lookup every consumer goes through.
 *
 * `tomlParsers.ts` (runtime/CLI/build), `constellationSerializer.ts` (editor)
 * and the Phase 3 UI all resolve patterns here, so a new pattern needs one
 * registry entry and one `fields.ts` block — never a fifth `switch`.
 */

import type { SatelliteSpec } from "../satellites";
import { emitShell, greedyPlaneSizes, planGeometry, sameSizes } from "./emit";
import { applyShellFailures } from "./failure";
import { FIELD_REGISTRY, numberField } from "./fields";
import { flowerGenerator } from "./flower";
import { latticeFlowerGenerator } from "./latticeFlower";
import { necklaceFlowerGenerator } from "./necklaceFlower";
import { streetsOfCoverageGenerator } from "./streetsOfCoverage";
import { walkerDeltaGenerator } from "./walkerDelta";
import { walkerStarGenerator } from "./walkerStar";
import {
  DEFAULT_PATTERN_ID,
  PATTERN_IDS,
  isPatternId,
  patternIdOf,
  type GeneratedShell,
  type PatternGenerator,
  type PatternId,
  type PatternShellInput,
  type ValidationError,
} from "./types";

export const PATTERN_REGISTRY: Record<PatternId, PatternGenerator> = {
  walker_delta: walkerDeltaGenerator,
  walker_star: walkerStarGenerator,
  streets_of_coverage: streetsOfCoverageGenerator,
  flower: flowerGenerator,
  lattice_flower: latticeFlowerGenerator,
  necklace_flower: necklaceFlowerGenerator,
};

/** Generator for a shell. Missing or unrecognised `pattern` → walker_delta. */
export function resolvePattern(shell: PatternShellInput): PatternGenerator {
  return PATTERN_REGISTRY[patternIdOf(shell)];
}

export interface GeneratedShellSpecs extends GeneratedShell {
  specs: SatelliteSpec[];
  /** First unused satellite number, for the next shell. */
  nextSatnum: number;
  /** Nominal satellite count, before the failure model removed any. */
  nominalCount: number;
  /** How many satellites the failure model removed (0 for a healthy shell). */
  failedCount: number;
}

/**
 * Plans + emits one shell. `planes` in the result is the *actual* number of
 * planes the pattern produced (derived for streets-of-coverage), not the stored
 * `planes` field.
 *
 * The failure model (`failure.ts`) is applied here, after emission, so *every*
 * consumer of a shell — editor, workers, CLI, prebuild generator — sees the
 * same survivors. `nextSatnum` stays the nominal one: survivors keep the
 * catalog numbers of the healthy shell and the gaps mark the failures.
 */
export function generateShell(
  shell: PatternShellInput,
  epoch: Date,
  satnumStart: number,
): GeneratedShellSpecs {
  const generator = resolvePattern(shell);
  const plan = generator.plan(shell);
  const emitted = emitShell(plan.plans, plan.orbit, epoch, satnumStart);
  const failures = applyShellFailures(shell, emitted.satellites, emitted.planeSizes);
  const geometry = planGeometry(plan.plans, plan.orbit);

  return {
    satellites:
      failures.failedCount === 0 ? geometry : geometry.filter((_, i) => failures.keep(i)),
    planes: plan.plans.length,
    planeSizes: failures.planeSizes,
    wrapPlanes: plan.wrapPlanes,
    derived: generator.derive(shell),
    warnings: plan.warnings,
    specs: failures.specs,
    nextSatnum: emitted.nextSatnum,
    nominalCount: failures.nominalCount,
    failedCount: failures.failedCount,
  };
}

/** Numeric field keys, for the blanket `Number.isFinite` validation pass. */
const NUMERIC_KEYS = FIELD_REGISTRY.filter(
  (f) => f.kind === "number" || f.kind === "int",
).map((f) => f.key);

/**
 * Cross-pattern validation: unknown `pattern`, non-finite numbers, then the
 * pattern's own rules. `constellationSerializer.validateConfig` adds the
 * count/planes/eccentricity/altitude range checks on top.
 */
export function validateShell(shell: PatternShellInput, index: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (shell.pattern !== undefined && shell.pattern !== "" && !isPatternId(shell.pattern)) {
    errors.push({
      field: `shell.${index}.pattern`,
      message: `未知の設計方式 "${shell.pattern}" です(${PATTERN_IDS.join(", ")})。${DEFAULT_PATTERN_ID} として扱います。`,
    });
  }

  const record = shell as Record<string, unknown>;
  for (const key of NUMERIC_KEYS) {
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    if (!Number.isFinite(Number(raw))) {
      errors.push({
        field: `shell.${index}.${key}`,
        message: `${key} には数値を入力してください`,
      });
    }
  }
  if (errors.length > 0) return errors;

  errors.push(...resolvePattern(shell).validate(shell, index));
  return errors;
}

/**
 * `planeSizes` worth persisting on an `IslShellRange`, or undefined when the
 * layout already matches the greedy `ceil(count/planes)` fill that
 * `gridPatternIslCandidates` assumes by default.
 *
 * Keeping this optional matters beyond tidiness:
 * `scripts/generate-satellites.ts` serializes shell ranges with
 * `Object.entries`, so an always-present key would rewrite
 * `src/lib/satellites.generated.ts` for every existing constellation.
 */
export function significantPlaneSizes(
  planeSizes: number[],
  count: number,
  planes: number,
): number[] | undefined {
  return sameSizes(planeSizes, greedyPlaneSizes(count, planes)) ? undefined : planeSizes;
}

/** Nominal satellite count of a shell without generating it (for the UI/serializer). */
export function shellTotalSats(shell: PatternShellInput): number {
  return resolvePattern(shell).derive(shell).totalSats;
}

/** Nominal plane count of a shell without generating it. */
export function shellPlanes(shell: PatternShellInput): number {
  return resolvePattern(shell).derive(shell).planes;
}

/** Stored `planes` field, ignoring any derivation — used by legacy fallbacks. */
export function storedPlanes(shell: PatternShellInput): number {
  return numberField("planes", shell);
}
