/**
 * Pure domain types for constellation pattern generation.
 *
 * This module (and everything else under `constellationPatterns/`) must stay
 * free of React, Three.js and satellite.js so it can run in Workers, the CLI
 * and build scripts. `emit.ts` is the single exception: it imports the
 * `SatelliteSpec`/`OrbitalElements` *types* (type-only, erased at compile).
 */

/** Identifier of a constellation design pattern (`pattern` key in TOML). */
export type PatternId =
  | "walker_delta"
  | "walker_star"
  | "streets_of_coverage"
  | "flower"
  | "lattice_flower"
  | "necklace_flower";

/** Every known pattern id, in menu order (walker family first, flower family second). */
export const PATTERN_IDS: readonly PatternId[] = [
  "walker_delta",
  "walker_star",
  "streets_of_coverage",
  "flower",
  "lattice_flower",
  "necklace_flower",
] as const;

/** Pattern used when `pattern` is omitted — preserves pre-pattern TOML files. */
export const DEFAULT_PATTERN_ID: PatternId = "walker_delta";

export function isPatternId(value: unknown): value is PatternId {
  return typeof value === "string" && (PATTERN_IDS as readonly string[]).includes(value);
}

/**
 * Resolves the pattern id of a raw shell record without touching the registry
 * (so `fields.ts` can depend on it without a cycle). Unknown/missing values
 * fall back to `walker_delta`; reporting an unknown string as a validation
 * error is `registry.validateShell`'s job.
 */
export function patternIdOf(shell: PatternShellInput): PatternId {
  return isPatternId(shell.pattern) ? shell.pattern : DEFAULT_PATTERN_ID;
}

/** Short badge label per pattern (WΔ / W★ / SoC / FC / LFC / NFC). */
export const PATTERN_SHORT_LABELS: Record<PatternId, string> = {
  walker_delta: "WΔ",
  walker_star: "W★",
  streets_of_coverage: "SoC",
  flower: "FC",
  lattice_flower: "LFC",
  necklace_flower: "NFC",
};

/**
 * Flat shell record as it appears in TOML. Every field is optional so that both
 * `ConstellationShellConfig` (runtime parser) and `ConstellationShell` (editor,
 * carries an extra `id`) are assignable to it.
 *
 * `pattern` is typed `string` rather than `PatternId` because a hand-edited
 * TOML file may contain anything; use `patternIdOf`/`isPatternId` to narrow.
 */
export interface PatternShellInput {
  name?: string;
  pattern?: string;

  // --- common ---
  count?: number;
  planes?: number;
  phasing?: number;
  apogee_altitude?: number;
  eccentricity?: number;
  inclination?: number;
  raan_range?: number;
  raan_start?: number;
  argp?: number;
  mean_anomaly_0?: number;

  // --- walker_star / streets_of_coverage ---
  raan_spacing?: number;

  // --- streets_of_coverage ---
  soc_min_elevation?: number;
  soc_coverage_fold?: number;
  soc_target_latitude?: number;
  soc_sats_per_plane?: number;

  // --- flower ---
  flower_np?: number;
  flower_nd?: number;
  flower_fn?: number;
  flower_fd?: number;
  flower_fh?: number;

  // --- lattice_flower / necklace_flower ---
  lfc_nc?: number;

  // --- necklace_flower ---
  nec_pearls?: number;
  nec_necklace?: number[];
  nec_shift?: number;

  // --- repeat-ground-track memo (all patterns, informational) ---
  rgt_repeat_orbits?: number;
  rgt_repeat_days?: number;

  // --- mission wizard provenance (all patterns, informational) ---
  mission_objective?: string;
  mission_min_elevation?: number;
  mission_fold?: number;
  mission_region?: string;
  mission_lat_min?: number;
  mission_lat_max?: number;
  mission_alt_min?: number;
  mission_alt_max?: number;
}

/** One satellite's Keplerian geometry (no epoch, no catalog number). */
export interface SatelliteGeometry {
  raanDeg: number;
  meanAnomalyDeg: number;
  argPerigeeDeg: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
}

/** One orbital plane: its RAAN plus the mean anomalies of the satellites in it. */
export interface PlanePlan {
  raanDeg: number;
  meanAnomaliesDeg: number[];
}

/** Shell-wide orbit shape shared by every satellite of the shell. */
export interface ShellOrbit {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  argPerigeeDeg: number;
}

export type ShellWarningCode =
  /** A stored field disagrees with the value derived from the design inputs. */
  | "derived_mismatch"
  /** A numeric solver (RGT semi-major axis) failed; a stored value was used. */
  | "solver_failed"
  /** Planes do not all hold the same number of satellites. */
  | "uneven_planes"
  /** Streets-of-coverage sizing found no feasible plane count. */
  | "infeasible_coverage"
  /** Streets-of-coverage sizing filled the full 360°, so there is no counter-rotating seam. */
  | "full_circle_layout"
  /** Lattice `Nc` outside 0..No-1. */
  | "nc_out_of_range"
  /** Necklace shift is not admissible for the chosen necklace. */
  | "necklace_not_admissible"
  /** Two flower satellites landed on the same (RAAN, mean anomaly) slot. */
  | "fc_duplicate_slots"
  /** n-fold streets-of-coverage sizing uses an approximation. */
  | "fold_approximation"
  /** Walker-star inclination is far from polar. */
  | "inclination_not_polar";

export interface ShellWarning {
  code: ShellWarningCode;
  message: string;
}

/**
 * Validation issue for one shell. Shared with `constellationSerializer` (which
 * re-exports this type as `ValidationError`). `severity` defaults to "error";
 * "warning" issues do not block saving.
 */
export interface ValidationError {
  field: string;
  message: string;
  severity?: "error" | "warning";
}

/** Output of `PatternGenerator.plan` — geometry, not yet numbered or emitted. */
export interface ShellPlan {
  plans: PlanePlan[];
  orbit: ShellOrbit;
  /**
   * Whether the last plane is a RAAN neighbour of plane 0. False for
   * walker-star / streets-of-coverage, whose planes span 180° with a seam.
   */
  wrapPlanes: boolean;
  warnings: ShellWarning[];
}

/** RGT ratio nearest to the shell's altitude/inclination (informational). */
export interface DerivedRgt {
  repeatOrbits: number;
  repeatDays: number;
  ratio: number;
  /** |ratio - tau0|, i.e. how far the shell is from the exact repeat. */
  error: number;
}

/** Read-only information shown next to the form, common to every pattern. */
export interface ShellDerivedCommon {
  totalSats: number;
  planes: number;
  /** totalSats / planes; may be fractional — `planeSizes` is authoritative. */
  satsPerPlane: number;
  planeSizes: number[];
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  periodMin: number;
  /** RAAN step between adjacent planes. */
  raanSpacingDeg: number;
  /** Mean-anomaly step between adjacent satellites of the same plane. */
  inPlaneSpacingDeg: number;
  /** Mean-anomaly offset applied when stepping to the next plane. */
  interPlaneOffsetDeg: number;
  rgt: DerivedRgt | null;
  warnings: ShellWarning[];
}

/** Sizing result of the streets-of-coverage design equations. */
export interface StreetsOfCoverageDesign {
  feasible: boolean;
  /** Earth central angle θ (deg). */
  thetaDeg: number;
  /** Street half-width for single (m=1) coverage (deg). */
  c1Deg: number;
  /** Street half-width for n-fold coverage (deg). */
  cnDeg: number;
  planes: number;
  count: number;
  /** RAAN span the planes must cover, 2P·asin[cos λ·cos((P−n)π/(2P))] (deg). */
  spanDeg: number;
  /** Same value as `spanDeg`, named for the "required vs achieved" readout. */
  requiredSpanDeg: number;
  /** (P−1)(θ+c_n)·safety + (c₁+c_n) — what the chosen P can actually cover. */
  achievedSpanDeg: number;
  /** Co-rotating plane spacing Δco (deg). */
  deltaCoDeg: number;
  /** Counter-rotating seam spacing Δseam = c₁ + c_n (deg). */
  deltaSeamDeg: number;
  /** Inter-plane mean-anomaly phase ω (deg). */
  omegaDeg: number;
  satsPerPlane: number;
  foldRequested: number;
  warnings: ShellWarning[];
}

export type ShellDerived =
  | (ShellDerivedCommon & {
      pattern: "walker_delta";
      /** Walker notation `T/P/F: i`. */
      walkerNotation: string;
      phasing: number;
      /** Equivalent 2D-LFC Nc, or null when the shell is not a clean lattice. */
      lfcNc: number | null;
    })
  | (ShellDerivedCommon & {
      pattern: "walker_star";
      walkerNotation: string;
      phasing: number;
      /** Δco between co-rotating planes (deg). */
      coSpacingDeg: number;
      /** Seam gap between the first and last plane (deg). */
      seamDeg: number;
      inclinationPolar: boolean;
    })
  | (ShellDerivedCommon & {
      pattern: "streets_of_coverage";
      design: StreetsOfCoverageDesign;
    })
  | (ShellDerivedCommon & {
      pattern: "flower";
      np: number;
      nd: number;
      fn: number;
      fd: number;
      fh: number;
      /** Ns, the number of satellites placed on the flower orbit. */
      ns: number;
      /** Maximum Ns before satellites co-locate: Nd·Fd/gcd(Nd, Np·Fn + Fd·Fh). */
      nsMax: number;
      repeatDays: number;
      repeatOrbits: number;
      /** Semi-major axis solved from (i, e, Np, Nd), or null if the solver failed. */
      solvedSemiMajorAxisKm: number | null;
      /** Apogee altitude implied by the solved semi-major axis (km). */
      solvedApogeeAltitudeKm: number | null;
      /** |stored − solved| apogee altitude (km), or null when nothing stored. */
      apogeeAltitudeMismatchKm: number | null;
      /**
       * Colocation harmonic G = gcd(Nd, Np·Fn + Fd·Fh) — the number of
       * satellites that share each (Ω, M) slot once Ns reaches Ns_max·G.
       */
      harmonicNc: number | null;
    })
  | (ShellDerivedCommon & {
      pattern: "lattice_flower";
      no: number;
      nso: number;
      nc: number;
      ncAdmissible: boolean;
      /** Mean-anomaly step per plane, −360·Nc/(No·Nso) (deg). */
      deltaMDeg: number;
      /** Equivalent Walker notation `T/P/F: i`. */
      walkerNotation: string;
      walkerF: number;
    })
  | (ShellDerivedCommon & {
      pattern: "necklace_flower";
      no: number;
      nso: number;
      nc: number;
      /** Occupied pearls (1-based, sorted, deduped). */
      necklace: number[];
      occupied: number;
      shift: number;
      /** Sym(G) — smallest positive rotation mapping the necklace onto itself. */
      symmetry: number;
      admissible: boolean;
      /** Shifts k in 1..Nso that satisfy Sym(G) | (k·No − Nc). */
      admissibleShifts: number[];
      deltaMDeg: number;
      /** Walker notation of the underlying (fully populated) lattice. */
      walkerNotation: string;
    });

/** Result of generating a shell: geometry plus everything the UI/ISL layer needs. */
export interface GeneratedShell {
  satellites: SatelliteGeometry[];
  planes: number;
  planeSizes: number[];
  wrapPlanes: boolean;
  derived: ShellDerived;
  warnings: ShellWarning[];
}

/** One design pattern's behaviour. Stateless — all state lives in the shell record. */
export interface PatternGenerator {
  id: PatternId;
  /** TOML keys this pattern reads (from the `fields.ts` registry). */
  fields: readonly string[];
  /** Lay out planes and mean anomalies. Never throws on bad input. */
  plan(shell: PatternShellInput): ShellPlan;
  /** Cheap read-only summary; must not build satellite elements. */
  derive(shell: PatternShellInput): ShellDerived;
  /** Pattern-specific validation. `index` seeds the `shell.${index}.*` fields. */
  validate(shell: PatternShellInput, index: number): ValidationError[];
}
