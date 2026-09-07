/**
 * Type definitions for constellation configuration (editor side).
 *
 * The field set mirrors the TOML schema registry in
 * `constellationPatterns/fields.ts` one-for-one — the registry is the source of
 * truth for defaults, kinds and which pattern uses which key; this interface
 * just gives the editor a typed record. `ConstellationShell` is assignable to
 * `PatternShellInput`, so every pattern generator accepts it directly.
 */

import type { PatternId } from "./constellationPatterns";

export interface ConstellationShell {
  id: string;                    // UUID for React keys
  name?: string;                 // Optional shell name
  /** Design pattern. Undefined means `walker_delta`. */
  pattern?: PatternId;
  count: number;                 // Total satellites (required)
  planes: number;                // Number of orbital planes (required)
  phasing?: number;              // Phasing between planes (default: 0, star: P/2)
  apogee_altitude?: number;      // Altitude in km (default: 0)
  eccentricity?: number;         // Orbital eccentricity (default: 0)
  inclination?: number;          // Inclination in degrees (default: 0, star/soc: 90)
  raan_start?: number;           // Starting RAAN in degrees (default: 0)
  raan_range?: number;           // RAAN range in degrees (default: 360, star/soc: 180)
  argp?: number;                 // Argument of perigee in degrees (default: 0)
  mean_anomaly_0?: number;       // Initial mean anomaly in degrees (default: 0)

  // --- walker_star / streets_of_coverage ---
  /** Co-rotating plane spacing Δco (default: raan_range / planes). */
  raan_spacing?: number;

  // --- streets_of_coverage design inputs (planes/count are derived) ---
  soc_min_elevation?: number;    // ε in degrees (default: 10)
  soc_coverage_fold?: number;    // n-fold coverage (default: 1)
  soc_target_latitude?: number;  // λ_n in degrees, 0 = global (default: 0)
  soc_sats_per_plane?: number;   // S (default: 11)

  // --- flower ---
  flower_np?: number;            // Np — revolutions per repeat cycle
  flower_nd?: number;            // Nd — repeat days
  flower_fn?: number;            // Fn (default: 1)
  flower_fd?: number;            // Fd — also the plane count (default: planes)
  flower_fh?: number;            // Fh in 0..Nd-1 (default: 0)

  // --- lattice_flower / necklace_flower ---
  lfc_nc?: number;               // Nc in 0..No-1 (default: 0)

  // --- necklace_flower ---
  nec_pearls?: number;           // Nso — in-plane slots
  nec_necklace?: number[];       // Occupied pearls, 1-based
  nec_shift?: number;            // Shift k (default: 1)

  // --- repeat-ground-track memo (informational) ---
  rgt_repeat_orbits?: number;
  rgt_repeat_days?: number;

  // --- mission wizard provenance (informational) ---
  mission_objective?: string;
  mission_min_elevation?: number;
  mission_fold?: number;
  mission_region?: string;
  mission_lat_min?: number;
  mission_lat_max?: number;
  mission_alt_min?: number;
  mission_alt_max?: number;
}

export interface ConstellationConfig {
  epoch: Date;
  shells: ConstellationShell[];
}

export const DEFAULT_SHELL_VALUES: Omit<ConstellationShell, "id"> = {
  name: "",
  count: 1,
  planes: 1,
  phasing: 0,
  apogee_altitude: 500,
  eccentricity: 0,
  inclination: 0,
  raan_start: 0,
  raan_range: 360,
  argp: 0,
  mean_anomaly_0: 0,
};

/**
 * New-shell templates per pattern — sensible communications-constellation
 * starting points, **not** the "omitted key" defaults (those live in
 * `constellationPatterns/fields.ts` and decide what the serializer may omit).
 * A template value equal to a field default is still written, because the
 * serializer compares against the field default, not against this table.
 */
export const PATTERN_DEFAULTS: Record<PatternId, Partial<ConstellationShell>> = {
  // Starlink-like inner shell, scaled down to a legible 24 satellites.
  walker_delta: {
    count: 24,
    planes: 3,
    phasing: 1,
    apogee_altitude: 550,
    inclination: 53,
    raan_range: 360,
  },
  // Iridium-like: 6 planes of 11 over a 180° span with a half-slot offset.
  walker_star: {
    count: 66,
    planes: 6,
    phasing: 3,
    apogee_altitude: 780,
    inclination: 86.4,
    raan_range: 180,
  },
  // Iridium design inputs; planes/count are derived and written back.
  streets_of_coverage: {
    count: 66,
    planes: 6,
    apogee_altitude: 780,
    inclination: 86.4,
    raan_range: 180,
    soc_min_elevation: 8.2,
    soc_coverage_fold: 1,
    soc_target_latitude: 0,
    soc_sats_per_plane: 11,
  },
  // Critically-inclined elliptical flower (Molniya-flavoured argp = 270°).
  flower: {
    count: 8,
    planes: 8,
    // Consistent with the Np/Nd = 15/1 compatible orbit at i = 63.4°, e = 0.05
    // (a = 6884.298 km); an inconsistent seed would trip `derived_mismatch`.
    apogee_altitude: 850.38,
    eccentricity: 0.05,
    inclination: 63.4,
    argp: 270,
    flower_np: 15,
    flower_nd: 1,
    flower_fn: 1,
    flower_fd: 8,
    flower_fh: 0,
  },
  // OneWeb-like 18 × 36 lattice.
  lattice_flower: {
    count: 648,
    planes: 18,
    apogee_altitude: 1200,
    inclination: 87.9,
    lfc_nc: 1,
  },
  // 6 planes × 9 slots with 3 of the 9 pearls occupied.
  necklace_flower: {
    count: 18,
    planes: 6,
    apogee_altitude: 1200,
    inclination: 87.9,
    lfc_nc: 3,
    nec_pearls: 9,
    nec_necklace: [1, 4, 6],
    nec_shift: 2,
  },
};

/**
 * Creates a shell pre-filled with the template for `pattern`. `pattern` is
 * omitted from the result for `walker_delta` so that saving a default shell
 * produces the same TOML as before the multi-pattern schema.
 */
export function createNewShell(pattern: PatternId = "walker_delta"): ConstellationShell {
  const template = PATTERN_DEFAULTS[pattern];
  return {
    ...DEFAULT_SHELL_VALUES,
    ...template,
    ...(pattern === "walker_delta" ? {} : { pattern }),
    id: crypto.randomUUID(),
  };
}

export function createDefaultConfig(): ConstellationConfig {
  return {
    epoch: new Date(),
    shells: [],
  };
}
