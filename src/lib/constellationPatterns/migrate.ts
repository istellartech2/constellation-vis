/**
 * Pattern switching and derived-field write-back for the shell editor.
 *
 * Two jobs, both pure:
 *
 * 1. `migrateShellPattern(shell, next)` — carries the shell's geometry over to
 *    another design method. It never deletes a key: a value the target pattern
 *    does not read stays in the record so switching back restores it. Fields
 *    the target *does* read are filled only when unset, except for the handful
 *    of exact correspondences (Walker F ↔ lattice Nc, SoC size → Walker T/P,
 *    flower's solved altitude) which are carried over as real conversions.
 *
 * 2. `syncDerivedFields(shell)` — the patterns whose `count`/`planes`/altitude
 *    are *computed* (streets-of-coverage, necklace, flower) must still store
 *    them, because `EditorTab` counts `count =` lines, `IslShellRange` needs
 *    `planes`, and `validateConfig` checks the stored values. The editor calls
 *    this after every field change so the record never goes stale.
 */

import type { ConstellationShell } from "../constellationTypes";
import { PATTERN_DEFAULTS } from "../constellationTypes";
import { suggestRgtRatioFromAltitudeInclination } from "../rgt";
import { computeShellDerived } from "./derived";
import { numberField } from "./fields";
import { latticeWalkerF } from "./latticeFlower";
import { PATTERN_META } from "./uiMeta";
import { lfcNcFromWalker } from "./walkerDelta";
import type { PatternId, ShellDerived } from "./types";
import { patternIdOf } from "./types";

export interface PatternMigration {
  /** Fields to merge into the shell, alongside `pattern: next`. */
  updates: Partial<ConstellationShell>;
  /** One-line Japanese summary of what was carried over. Never empty. */
  note: string;
}

type ShellRecord = Record<string, unknown>;

const STAR_LIKE: readonly PatternId[] = ["walker_star", "streets_of_coverage"];
const WALKER_LIKE: readonly PatternId[] = ["walker_delta", "walker_star", "streets_of_coverage"];
const LATTICE_LIKE: readonly PatternId[] = ["lattice_flower", "necklace_flower"];

function isStarLike(p: PatternId): boolean {
  return STAR_LIKE.includes(p);
}
function isWalkerLike(p: PatternId): boolean {
  return WALKER_LIKE.includes(p);
}
function isLatticeLike(p: PatternId): boolean {
  return LATTICE_LIKE.includes(p);
}

/** `computeShellDerived` that returns null instead of throwing on half-typed input. */
export function safeDerived(shell: ConstellationShell): ShellDerived | null {
  try {
    return computeShellDerived(shell);
  } catch {
    return null;
  }
}

export function migrateShellPattern(
  shell: ConstellationShell,
  next: PatternId,
): PatternMigration {
  const from = patternIdOf(shell);
  if (from === next) {
    return { updates: {}, note: `方式は既に${PATTERN_META[next].label}です。` };
  }

  const updates: Partial<ConstellationShell> = {};
  const record = shell as unknown as ShellRecord;
  const notes: string[] = [];

  const current = (key: string): unknown =>
    (updates as ShellRecord)[key] !== undefined ? (updates as ShellRecord)[key] : record[key];

  /** Set `key` only when neither the shell nor a previous rule provides it. */
  const fill = (key: keyof ConstellationShell, value: number | number[], note?: string) => {
    const existing = current(key as string);
    if (existing !== undefined && existing !== null && existing !== "") return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    (updates as ShellRecord)[key as string] = value;
    if (note) notes.push(note);
  };

  /** Overwrite `key` — used for exact conversions between equivalent forms. */
  const set = (key: keyof ConstellationShell, value: number, note?: string) => {
    if (!Number.isFinite(value)) return;
    if (current(key as string) === value) return;
    (updates as ShellRecord)[key as string] = value;
    if (note) notes.push(note);
  };

  const derived = safeDerived(shell);
  const planes = numberField("planes", shell);
  const count = numberField("count", shell);
  const phasing = numberField("phasing", shell);

  // --- raan_range: the half-sky span is a property of the family, and the
  // shell template always carries one, so the *source* pattern's own default
  // (360 for delta, 180 for star-like) counts as "unset" here.
  if (isWalkerLike(next)) {
    const target = isStarLike(next) ? 180 : 360;
    const stored = shell.raan_range;
    // The flower family ignores raan_range entirely, so a value inherited
    // through a flower hop (star → lattice → delta) is not a deliberate
    // choice either — both family defaults count as unset there.
    const familyDefaults = isWalkerLike(from) ? [isStarLike(from) ? 180 : 360] : [180, 360];
    // Star-like forms hide raan_range, so a stray non-180 span could never be
    // corrected by the user: always normalize it there.
    if (
      stored === undefined ||
      familyDefaults.includes(stored) ||
      (isStarLike(next) && stored !== target)
    ) {
      set("raan_range", target, `RAAN範囲 ${target}°`);
    }
  }

  // --- walker family → streets of coverage: seed the design inputs.
  if (next === "streets_of_coverage") {
    const perPlane = planes > 0 ? Math.ceil(count / planes) : 11;
    fill("soc_sats_per_plane", Math.max(1, perPlane), `1面あたり ${Math.max(1, perPlane)} 機 → S`);
    fill("soc_min_elevation", 25, "設計最低仰角 ε=25°");
    fill("soc_coverage_fold", 1, "多重度 N=1");
  }

  // --- streets of coverage → sized pattern: the design result becomes input.
  if (from === "streets_of_coverage" && derived) {
    if (Number.isFinite(derived.totalSats) && derived.totalSats > 0) {
      set("count", Math.round(derived.totalSats), `設計結果 T=${Math.round(derived.totalSats)}`);
    }
    if (Number.isFinite(derived.planes) && derived.planes > 0) {
      set("planes", Math.round(derived.planes), `P=${Math.round(derived.planes)}`);
    }
  }

  // --- Walker F ↔ lattice Nc (the same lattice, relabelled).
  const nextPlanes = Number(current("planes") ?? planes);
  const nextCount = Number(current("count") ?? count);

  if (isWalkerLike(from) && isLatticeLike(next)) {
    const nc =
      lfcNcFromWalker(nextCount, nextPlanes, phasing) ??
      (nextPlanes > 0 ? (((nextPlanes - phasing) % nextPlanes) + nextPlanes) % nextPlanes : 0);
    set("lfc_nc", Math.round(nc), `F=${phasing} → N_c=${Math.round(nc)}`);
    notes.push(`P=${nextPlanes} → N_o=${nextPlanes}`);
  }
  if (isLatticeLike(from) && isWalkerLike(next)) {
    const nc = numberField("lfc_nc", shell);
    const f = latticeWalkerF(nextPlanes, nc);
    set("phasing", f, `N_c=${nc} → F=${f}`);
  }

  // --- necklace: pearls / occupancy / shift.
  if (next === "necklace_flower") {
    const nso = nextPlanes > 0 ? Math.round(nextCount / nextPlanes) : 0;
    if (nso > 0) fill("nec_pearls", nso, `1面あたり ${nso} スロット → N_so`);
    const pearls = Number(current("nec_pearls"));
    if (Number.isFinite(pearls) && pearls > 0) {
      fill(
        "nec_necklace",
        Array.from({ length: Math.round(pearls) }, (_, i) => i + 1),
        `全 ${Math.round(pearls)} パールを占有`,
      );
    }
    fill("nec_shift", 1, "シフト k=1");
  }

  // --- flower family: Fd = plane count, Np/Nd from the nearest repeat ratio.
  if (next === "flower") {
    if (nextPlanes > 0) fill("flower_fd", Math.round(nextPlanes), `P=${nextPlanes} → F_d`);
    const suggestion = suggestRgtRatioFromAltitudeInclination(
      numberField("apogee_altitude", shell),
      numberField("inclination", shell),
      numberField("eccentricity", shell),
      { minRepeatDays: 1, maxRepeatDays: 30, maxRepeatOrbits: 2000 },
    );
    if (suggestion) {
      fill("flower_np", suggestion.repeatOrbits);
      fill("flower_nd", suggestion.repeatDays);
      notes.push(`回帰比 N_p/N_d=${suggestion.repeatOrbits}/${suggestion.repeatDays}`);
    }
    fill("flower_fn", 1);
    fill("flower_fh", 0);
  }

  // --- leaving flower: its altitude was a solved value, so store it for real.
  if (from === "flower" && derived && derived.pattern === "flower") {
    const solved = derived.solvedApogeeAltitudeKm;
    if (solved !== null && Number.isFinite(solved)) {
      set("apogee_altitude", Math.round(solved * 100) / 100, `高度 ${solved.toFixed(1)} km`);
    }
  }

  // --- anything the target still needs falls back to its new-shell template,
  // but never the size/orbit the user already chose.
  const PROTECTED = new Set(["count", "planes", "apogee_altitude", "inclination"]);
  const template = PATTERN_DEFAULTS[next] as ShellRecord;
  for (const [key, value] of Object.entries(template)) {
    if (PROTECTED.has(key)) continue;
    if (value === undefined) continue;
    fill(
      key as keyof ConstellationShell,
      value as number | number[],
    );
  }

  const note =
    notes.length > 0
      ? `${PATTERN_META[from].label}から引き継ぎ: ${notes.join("、")}`
      : `${PATTERN_META[from].label} → ${PATTERN_META[next].label}に変更しました（引き継ぐ値はありません）。`;

  return { updates, note };
}

/**
 * Derived `count`/`planes`/`apogee_altitude` that must be written back into the
 * record. Returns only the keys that actually change, so the caller can skip
 * the state update when it is empty.
 */
export function syncDerivedFields(shell: ConstellationShell): Partial<ConstellationShell> {
  const derived = safeDerived(shell);
  if (!derived) return {};
  const updates: Partial<ConstellationShell> = {};

  switch (derived.pattern) {
    case "streets_of_coverage": {
      if (!derived.design.feasible) break;
      const count = Math.round(derived.design.count);
      const planes = Math.round(derived.design.planes);
      if (Number.isFinite(count) && count > 0 && shell.count !== count) updates.count = count;
      if (Number.isFinite(planes) && planes > 0 && shell.planes !== planes) {
        updates.planes = planes;
      }
      break;
    }
    case "necklace_flower": {
      const count = Math.round(derived.totalSats);
      if (Number.isFinite(count) && count > 0 && shell.count !== count) updates.count = count;
      break;
    }
    case "flower": {
      const fd = Math.round(numberField("flower_fd", shell));
      if (Number.isFinite(fd) && fd > 0 && shell.planes !== fd) updates.planes = fd;
      const solved = derived.solvedApogeeAltitudeKm;
      if (solved !== null && Number.isFinite(solved)) {
        const rounded = Math.round(solved * 100) / 100;
        // Only when the drift is real: the solver seeds from the stored value,
        // so writing back on every keystroke would oscillate on rounding noise.
        if (Math.abs((shell.apogee_altitude ?? 0) - rounded) > 0.005) {
          updates.apogee_altitude = rounded;
        }
      }
      break;
    }
    default:
      break;
  }

  return updates;
}
