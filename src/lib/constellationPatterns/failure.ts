/**
 * Satellite failure (attrition) model for a constellation shell.
 *
 * A shell can declare that some of its satellites are dead — either a fixed
 * number (`failed_count`) or a fraction of the shell (`failure_percent`). The
 * survivors are what every consumer sees: the 3D scene, the access analyses,
 * the ISL graph and `scripts/generate-satellites.ts`.
 *
 * Two properties matter and drive the whole design:
 *
 * 1. **Determinism.** `constellation.toml` is re-parsed independently by the
 *    editor, the analysis workers, the CLI and the prebuild generator. An
 *    unseeded `Math.random` would hand each of them a *different*
 *    constellation — exactly the "saving works but the 3D shape is different"
 *    class of bug the `fields.ts` header warns about. The draw is therefore a
 *    pure function of `(totalSats, failedCount, failure_seed)`; the user
 *    re-rolls by bumping the seed.
 * 2. **Stable satellite numbers.** Failures are applied *after* `emitShell`,
 *    so survivors keep the catalog number they would have had in the nominal
 *    shell. The gaps in the numbering are the failed satellites.
 */

import type { SatelliteSpec } from "../satellites";
import { intField, numberField } from "./fields";
import type { PatternShellInput } from "./types";

/**
 * mulberry32 — a 32-bit seeded PRNG. Small, dependency-free and stable across
 * engines (all arithmetic is on `>>> 0` integers), which is what makes the
 * removed set reproducible between the browser, Bun and the CLI.
 */
export function mulberry32(seed: number): () => number {
  let a = (Math.trunc(seed) | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShellFailurePlan {
  /** Satellites the shell would have when nothing failed. */
  nominalCount: number;
  /** How many are removed. */
  failedCount: number;
  /** Surviving satellites. */
  activeCount: number;
  /** Which nominal indices (plane-major, 0-based) are removed, ascending. */
  failedIndices: number[];
  /** `"percent"` when the count came from `failure_percent`. */
  mode: "none" | "count" | "percent";
}

/**
 * How many satellites of a shell are dead.
 *
 * `failure_percent` wins when it is positive, so the editor's mode radio only
 * has to zero the other key; both zero means no failures.
 */
export function resolveFailedCount(shell: PatternShellInput, nominalCount: number): {
  failedCount: number;
  mode: ShellFailurePlan["mode"];
} {
  if (nominalCount <= 0) return { failedCount: 0, mode: "none" };

  const percent = numberField("failure_percent", shell);
  if (Number.isFinite(percent) && percent > 0) {
    const clamped = Math.min(100, percent);
    return {
      failedCount: Math.min(nominalCount, Math.round((clamped / 100) * nominalCount)),
      mode: "percent",
    };
  }

  const count = intField("failed_count", shell);
  if (Number.isFinite(count) && count > 0) {
    return { failedCount: Math.min(nominalCount, count), mode: "count" };
  }

  return { failedCount: 0, mode: "none" };
}

/**
 * `failedCount` distinct indices drawn uniformly from `[0, nominalCount)`.
 *
 * Partial Fisher–Yates: exact (no rejection loop, no duplicates) and O(N).
 */
export function selectFailedIndices(
  nominalCount: number,
  failedCount: number,
  seed: number,
): number[] {
  const k = Math.min(Math.max(0, Math.trunc(failedCount)), Math.max(0, nominalCount));
  if (k === 0) return [];

  const pool = Array.from({ length: nominalCount }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (nominalCount - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, k).sort((a, b) => a - b);
}

/** Failure plan of a shell without generating any satellite (for the UI). */
export function planShellFailures(
  shell: PatternShellInput,
  nominalCount: number,
): ShellFailurePlan {
  const { failedCount, mode } = resolveFailedCount(shell, nominalCount);
  const failedIndices = selectFailedIndices(
    nominalCount,
    failedCount,
    intField("failure_seed", shell),
  );
  return {
    nominalCount,
    failedCount: failedIndices.length,
    activeCount: nominalCount - failedIndices.length,
    failedIndices,
    mode: failedIndices.length === 0 ? "none" : mode,
  };
}

export interface AppliedShellFailures extends ShellFailurePlan {
  /** Surviving specs, still in plane-major order. */
  specs: SatelliteSpec[];
  /** Per-plane counts recomputed from the survivors. */
  planeSizes: number[];
  /** Surviving `SatelliteGeometry`-like records, filtered in the same order. */
  keep: (index: number) => boolean;
}

/**
 * Removes the failed satellites from an emitted shell.
 *
 * `planeSizes` is recomputed from the survivors because the ISL layer derives
 * the +Grid topology from it (`gridPatternIslCandidates`); leaving the nominal
 * sizes there would shift every plane boundary by the number of failures.
 */
export function applyShellFailures(
  shell: PatternShellInput,
  specs: readonly SatelliteSpec[],
  planeSizes: readonly number[],
): AppliedShellFailures {
  const plan = planShellFailures(shell, specs.length);
  const failed = new Set(plan.failedIndices);
  const keep = (index: number) => !failed.has(index);

  if (plan.failedCount === 0) {
    return { ...plan, specs: [...specs], planeSizes: [...planeSizes], keep };
  }

  const survivors: SatelliteSpec[] = [];
  const sizes: number[] = [];
  let index = 0;
  for (const size of planeSizes) {
    let alive = 0;
    for (let i = 0; i < size; i++, index++) {
      if (keep(index)) {
        survivors.push(specs[index]);
        alive++;
      }
    }
    sizes.push(alive);
  }
  // Any tail the plane sizes did not account for (defensive: `planeSizes`
  // always sums to `specs.length` for every current pattern).
  for (; index < specs.length; index++) {
    if (keep(index)) survivors.push(specs[index]);
  }

  return { ...plan, specs: survivors, planeSizes: sizes, keep };
}
