/**
 * Single source of truth for `[[constellation.shells]]` TOML keys.
 *
 * Both parsers (`tomlParsers.ts` for the runtime/CLI/build path,
 * `constellationSerializer.ts` for the editor), the serializer, validation and
 * the editor UI read this registry instead of keeping their own field lists —
 * previously adding a key meant editing four `switch` statements, and forgetting
 * one produced "saving works but the 3D shape is different" bugs.
 */

import type { PatternId, PatternShellInput } from "./types";
import { patternIdOf } from "./types";

export type FieldKind = "number" | "int" | "string" | "intArray";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  /**
   * What an *omitted* key means (not the new-shell template — that is
   * `PATTERN_DEFAULTS` in `constellationTypes.ts`). A function receives the
   * shell so a default can depend on the pattern or on another field.
   * `undefined` means "no default": the field stays undefined.
   */
  default?: number | ((shell: PatternShellInput) => number);
  /** Patterns for which this key is meaningful. */
  patterns: readonly PatternId[] | "all";
  /** Digits used when serializing a `number` field. */
  decimals?: number;
  /**
   * Never omit on serialization even when equal to the default. Used for
   * fields whose default depends on other stored fields, so "equal to the
   * default" is not a stable statement across edits.
   */
  alwaysWrite?: boolean;
}

const WALKER_LIKE: readonly PatternId[] = ["walker_delta", "walker_star", "streets_of_coverage"];
const STAR_LIKE: readonly PatternId[] = ["walker_star", "streets_of_coverage"];
const LATTICE_LIKE: readonly PatternId[] = ["lattice_flower", "necklace_flower"];

/** Walker-star and streets-of-coverage span half the sky and default to polar. */
function isStarLike(shell: PatternShellInput): boolean {
  return (STAR_LIKE as readonly string[]).includes(patternIdOf(shell));
}

export const FIELD_REGISTRY: readonly FieldSpec[] = [
  { key: "pattern", kind: "string", patterns: "all" },

  // --- common ---
  { key: "count", kind: "int", default: 1, patterns: "all" },
  { key: "planes", kind: "int", default: 1, patterns: "all" },
  {
    key: "phasing",
    kind: "number",
    // Walker-star's canonical half-slot inter-plane offset is F = P/2.
    default: (shell) => (patternIdOf(shell) === "walker_star" ? Number(shell.planes ?? 1) / 2 : 0),
    patterns: WALKER_LIKE,
    // No `decimals`: phasing is serialized raw, so a fractional F such as 1/3
    // survives a save/load round trip instead of being clipped to 0.3333.
  },
  { key: "apogee_altitude", kind: "number", default: 0, patterns: "all", decimals: 2 },
  { key: "eccentricity", kind: "number", default: 0, patterns: "all", decimals: 6 },
  {
    key: "inclination",
    kind: "number",
    default: (shell) => (isStarLike(shell) ? 90 : 0),
    patterns: "all",
    decimals: 2,
  },
  {
    key: "raan_range",
    kind: "number",
    default: (shell) => (isStarLike(shell) ? 180 : 360),
    patterns: "all",
    decimals: 2,
  },
  { key: "raan_start", kind: "number", default: 0, patterns: "all", decimals: 2 },
  { key: "argp", kind: "number", default: 0, patterns: "all", decimals: 2 },
  { key: "mean_anomaly_0", kind: "number", default: 0, patterns: "all", decimals: 2 },

  // --- walker_star / streets_of_coverage ---
  {
    key: "raan_spacing",
    kind: "number",
    // Δco defaults to the *stored* span divided by the plane count (what the
    // star core falls back to), not the pattern default of raan_range.
    default: (shell) => numberField("raan_range", shell) / Number(shell.planes ?? 1),
    patterns: STAR_LIKE,
    alwaysWrite: true,
    // Written raw: the seam width is `raan_range − (P−1)·Δco`, so rounding Δco
    // moves the seam by (P−1)× the rounding error.
  },

  // --- streets_of_coverage design inputs ---
  { key: "soc_min_elevation", kind: "number", default: 10, patterns: ["streets_of_coverage"], decimals: 2 },
  { key: "soc_coverage_fold", kind: "int", default: 1, patterns: ["streets_of_coverage"] },
  { key: "soc_target_latitude", kind: "number", default: 0, patterns: ["streets_of_coverage"], decimals: 2 },
  { key: "soc_sats_per_plane", kind: "int", default: 11, patterns: ["streets_of_coverage"] },

  // --- flower ---
  { key: "flower_np", kind: "int", patterns: ["flower"] },
  { key: "flower_nd", kind: "int", patterns: ["flower"] },
  { key: "flower_fn", kind: "int", default: 1, patterns: ["flower"] },
  // Fd *is* the plane count; `planes` is always written out as the derived
  // value, and an omitted flower_fd reads back from it.
  { key: "flower_fd", kind: "int", default: (shell) => Number(shell.planes ?? 1), patterns: ["flower"] },
  { key: "flower_fh", kind: "int", default: 0, patterns: ["flower"] },

  // --- lattice_flower / necklace_flower ---
  { key: "lfc_nc", kind: "int", default: 0, patterns: LATTICE_LIKE },

  // --- necklace_flower ---
  { key: "nec_pearls", kind: "int", patterns: ["necklace_flower"] },
  { key: "nec_necklace", kind: "intArray", patterns: ["necklace_flower"] },
  { key: "nec_shift", kind: "int", default: 1, patterns: ["necklace_flower"] },

  // --- failure (attrition) model, every pattern ---
  // `failure_percent` wins over `failed_count` when positive; the draw is a
  // pure function of (count, k, failure_seed) so every parser removes the same
  // satellites. See `failure.ts`.
  { key: "failed_count", kind: "int", default: 0, patterns: "all" },
  { key: "failure_percent", kind: "number", default: 0, patterns: "all", decimals: 2 },
  { key: "failure_seed", kind: "int", default: 0, patterns: "all" },

  // --- repeat-ground-track memo (informational, every pattern) ---
  { key: "rgt_repeat_orbits", kind: "int", patterns: "all" },
  { key: "rgt_repeat_days", kind: "int", patterns: "all" },

  // --- mission wizard provenance (informational, every pattern) ---
  { key: "mission_objective", kind: "string", patterns: "all" },
  { key: "mission_min_elevation", kind: "number", patterns: "all", decimals: 2 },
  { key: "mission_fold", kind: "int", patterns: "all" },
  { key: "mission_region", kind: "string", patterns: "all" },
  { key: "mission_lat_min", kind: "number", patterns: "all", decimals: 2 },
  { key: "mission_lat_max", kind: "number", patterns: "all", decimals: 2 },
  { key: "mission_alt_min", kind: "number", patterns: "all", decimals: 2 },
  { key: "mission_alt_max", kind: "number", patterns: "all", decimals: 2 },
];

const BY_KEY = new Map<string, FieldSpec>(FIELD_REGISTRY.map((f) => [f.key, f]));

export function fieldSpec(key: string): FieldSpec | undefined {
  return BY_KEY.get(key);
}

/** Every field meaningful for `pattern`, in registry order. */
export function fieldsForPattern(pattern: PatternId): FieldSpec[] {
  return FIELD_REGISTRY.filter(
    (f) => f.patterns === "all" || (f.patterns as readonly PatternId[]).includes(pattern),
  );
}

/** Field keys meaningful for `pattern`, in registry order. */
export function fieldKeysForPattern(pattern: PatternId): string[] {
  return fieldsForPattern(pattern).map((f) => f.key);
}

/**
 * Value an omitted `key` takes for this shell, or undefined when the field has
 * no default (`flower_np`, `nec_necklace`, `mission_*`, ...).
 */
export function defaultFor(key: string, shell: PatternShellInput): number | undefined {
  const spec = BY_KEY.get(key);
  if (!spec || spec.default === undefined) return undefined;
  return typeof spec.default === "function" ? spec.default(shell) : spec.default;
}

/** `defaultFor` for fields known to have a numeric default. */
function defaultNumber(key: string, shell: PatternShellInput): number {
  return defaultFor(key, shell) ?? 0;
}

/**
 * Numeric field value with its pattern-aware default applied. Mirrors the
 * legacy `Number(shell.x ?? DEFAULT)` idiom so the generated elements stay
 * bit-identical.
 */
export function numberField(key: string, shell: PatternShellInput): number {
  const raw = (shell as Record<string, unknown>)[key];
  if (raw === undefined || raw === null || raw === "") return defaultNumber(key, shell);
  return Number(raw);
}

/** Integer field value with its default applied (truncated toward zero). */
export function intField(key: string, shell: PatternShellInput): number {
  return Math.trunc(numberField(key, shell));
}
