import type { SatelliteSpec } from "./satellites";
import type { GroundStation, VisibilityMode } from "./groundStations";
import type { IslShellRange } from "./isl/types";
import {
  expandSatelliteEditorConfig,
  parseSatelliteEditorConfig,
} from "./satelliteEditorSerializer";
import {
  FIELD_REGISTRY,
  defaultFor,
  generateShell,
  parseTomlScalar,
  scanArrayTable,
  significantPlaneSizes,
  type PatternId,
  type PatternShellInput,
  type TomlScalar,
} from "./constellationPatterns";

/**
 * Kept as an `any`-returning alias so the historical `parseTomlValue` export
 * signature is unchanged; the shared implementation lives in
 * `constellationPatterns/tomlTable.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseValue(raw: string): any {
  return parseTomlScalar(raw);
}

function parseArrayTable(text: string, marker: string): Record<string, TomlScalar>[] {
  return scanArrayTable(text, marker).rows;
}

/**
 * One `[[constellation.shells]]` block, as read from TOML.
 *
 * The eleven base fields keep their original required/optional shape (existing
 * callers and `scripts/analyze-settings-visibility.ts` depend on it); every
 * pattern-specific key is optional and flat, named exactly like its TOML key.
 */
export interface ConstellationShellConfig {
  name?: string;
  count: number;
  planes: number;
  phasing?: number;
  apogee_altitude: number;
  eccentricity?: number;
  inclination: number;
  raan_range?: number;
  raan_start?: number;
  argp?: number;
  mean_anomaly_0?: number;

  /** Design pattern. Absent means `walker_delta` (pre-pattern TOML files). */
  pattern?: string;

  // walker_star / streets_of_coverage
  raan_spacing?: number;

  // streets_of_coverage design inputs
  soc_min_elevation?: number;
  soc_coverage_fold?: number;
  soc_target_latitude?: number;
  soc_sats_per_plane?: number;

  // flower
  flower_np?: number;
  flower_nd?: number;
  flower_fn?: number;
  flower_fd?: number;
  flower_fh?: number;

  // lattice_flower / necklace_flower
  lfc_nc?: number;

  // necklace_flower
  nec_pearls?: number;
  nec_necklace?: number[];
  nec_shift?: number;

  // repeat-ground-track memo
  rgt_repeat_orbits?: number;
  rgt_repeat_days?: number;

  // mission wizard provenance
  mission_objective?: string;
  mission_min_elevation?: number;
  mission_fold?: number;
  mission_region?: string;
  mission_lat_min?: number;
  mission_lat_max?: number;
  mission_alt_min?: number;
  mission_alt_max?: number;
}

/** The eleven fields that existed before the multi-pattern schema. */
export type BaseConstellationShellFields =
  | "name"
  | "count"
  | "planes"
  | "phasing"
  | "apogee_altitude"
  | "eccentricity"
  | "inclination"
  | "raan_range"
  | "raan_start"
  | "argp"
  | "mean_anomaly_0";

export interface ConstellationConfig {
  epoch: Date;
  shells: ConstellationShellConfig[];
}

function numberOrDefault(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

export function parseSatellitesToml(text: string): SatelliteSpec[] {
  return expandSatelliteEditorConfig(parseSatelliteEditorConfig(text));
}

interface GeneratedShells {
  satellites: SatelliteSpec[];
  /** One entry per shell, with the metadata needed to resolve ISL participation. */
  ranges: IslShellRange[];
}

/**
 * Generate every shell's satellites, tracking each shell's own generated count
 * separately (a shell's inner loop must stop once *that shell* has produced
 * `count` satellites — not once the whole accumulated array reaches `count`,
 * which truncates every shell after the first in a multi-shell constellation).
 *
 * The per-pattern geometry lives in `constellationPatterns/`; this function is
 * only the loop that chains satellite numbers, index ranges and warnings.
 */
function generateFromShellsDetailed(con: ConstellationConfig, baseOffset: number): GeneratedShells {
  const epoch = con.epoch instanceof Date ? con.epoch : new Date(String(con.epoch));
  // ID ranges:
  //   1-9999: Constellation generated satellites
  //   10000-89999: NORAD catalog IDs (CelesTrak imports)
  //   90000-99999: Manual definitions (satellites.toml)
  // Note: TLE format only supports 5-digit satellite numbers (max 99999)
  let nextSatnum = 1;
  const sats: SatelliteSpec[] = [];
  const ranges: IslShellRange[] = [];

  (con.shells ?? []).forEach((shell, shellIdx) => {
    const startIndex = baseOffset + sats.length;
    const generated = generateShell(shell, epoch, nextSatnum);
    nextSatnum = generated.nextSatnum;
    sats.push(...generated.specs);

    // `planeSizes` and `wrapPlanes` are only written when they say something
    // the default greedy plane layout does not — `IslShellRange` is serialized
    // key-by-key into `src/lib/satellites.generated.ts`, so unconditional keys
    // would rewrite that file for every existing constellation.
    const planeSizes = significantPlaneSizes(
      generated.planeSizes,
      generated.specs.length,
      generated.planes,
    );

    ranges.push({
      key: String(shellIdx),
      name: shell.name,
      startIndex,
      count: generated.specs.length,
      planes: generated.planes,
      ...(planeSizes ? { planeSizes } : {}),
      ...(generated.wrapPlanes ? {} : { wrapPlanes: false }),
    });
  });

  return { satellites: sats, ranges };
}

function generateFromShells(con: ConstellationConfig): SatelliteSpec[] {
  return generateFromShellsDetailed(con, 0).satellites;
}

/**
 * Resolve shell index ranges for ISL participation/topology, from the
 * *actual* generated satellite counts rather than the nominal `shell.count`.
 * `baseOffset` is the number of satellites.toml satellites that
 * precede the constellation shells in the combined array.
 */
export function generateShellRanges(con: ConstellationConfig, baseOffset: number): IslShellRange[] {
  return generateFromShellsDetailed(con, baseOffset).ranges;
}

/** Keys whose value must always be present in the parsed shell record. */
/**
 * Keys `ConstellationShellConfig` declares as required. When the TOML omits
 * one, it is filled from the registry's pattern-aware `defaultFor` — never from
 * a hardcoded literal. `inclination` in particular defaults to 90 for
 * walker_star / streets_of_coverage, and the serializer omits any field equal
 * to that default, so a literal 0 here would silently turn a saved polar shell
 * into an equatorial one on reload.
 */
const ALWAYS_PRESENT = new Set<string>(["count", "planes", "apogee_altitude", "inclination"]);

function shellFromRecord(row: Record<string, TomlScalar>): ConstellationShellConfig {
  const shell: Record<string, unknown> = {
    name: typeof row.name === "string" ? row.name : undefined,
  };

  // Pass 1: non-numeric fields. `pattern` must be resolved before any numeric
  // default is evaluated, because `defaultFor` dispatches on `patternIdOf(shell)`.
  for (const spec of FIELD_REGISTRY) {
    const raw = row[spec.key];
    if (spec.kind === "string") {
      shell[spec.key] = typeof raw === "string" && raw !== "" ? raw : undefined;
    } else if (spec.kind === "intArray") {
      shell[spec.key] = Array.isArray(raw) ? raw.map((v) => Number(v)) : undefined;
    }
  }

  // Pass 2: numeric fields.
  for (const spec of FIELD_REGISTRY) {
    if (spec.kind !== "number" && spec.kind !== "int") continue;
    const raw = row[spec.key];

    if (ALWAYS_PRESENT.has(spec.key)) {
      const fallback = defaultFor(spec.key, shell as PatternShellInput) ?? 0;
      shell[spec.key] = numberOrDefault(raw, fallback);
      continue;
    }
    // Optional numeric field: undefined when absent, so the pattern layer
    // applies its own (pattern-aware) default.
    shell[spec.key] = raw !== undefined ? numberOrDefault(raw, 0) : undefined;
  }

  // The ALWAYS_PRESENT keys were just filled in above, so the record does
  // satisfy the interface's required fields.
  return shell as unknown as ConstellationShellConfig;
}

export function parseConstellationConfig(text: string): ConstellationConfig {
  // Header keys other than `epoch` (older files carry a `name`) are ignored.
  const { header, rows } = scanArrayTable(text, "constellation.shells");
  const epochRaw = header.epoch;

  return {
    epoch: epochRaw instanceof Date ? epochRaw : new Date(String(epochRaw)),
    shells: rows.map(shellFromRecord),
  };
}

export function parseConstellationToml(text: string): SatelliteSpec[] {
  return generateFromShells(parseConstellationConfig(text));
}

/**
 * Parse constellation.toml and generate its satellites + shell ranges in one
 * pass. `SatelliteEditor.handleUpdate` used to call `parseConstellationToml`
 * and `generateShellRanges` independently — each internally re-parsing and
 * re-generating from the same text — so the invariant "shellRanges matches
 * the satellite array in use" held only because both calls happened to
 * receive identical text, not because it was structurally guaranteed.
 */
export function buildConstellation(
  text: string,
  baseOffset: number,
): { satellites: SatelliteSpec[]; ranges: IslShellRange[] } {
  return generateFromShellsDetailed(parseConstellationConfig(text), baseOffset);
}

export function parseGroundStationsToml(text: string): GroundStation[] {
  const entries = parseArrayTable(text, "groundstations");

  function parseVisibilityMode(value: unknown): VisibilityMode | undefined {
    if (
      value === "elevation_only" ||
      value === "off_nadir_only" ||
      value === "and"
    ) {
      return value;
    }
    return undefined;
  }

  return entries.map((entry) => ({
    name: String(entry.name ?? ""),
    latitudeDeg: Number(entry.latitudeDeg),
    longitudeDeg: Number(entry.longitudeDeg),
    heightKm: Number(entry.heightKm ?? 0),
    minElevationDeg: Number(entry.minElevationDeg ?? 0),
    visibilityMode: parseVisibilityMode(entry.visibilityMode),
    maxOffNadirDeg:
      entry.maxOffNadirDeg !== undefined ? Number(entry.maxOffNadirDeg) : undefined,
  }));
}

export type { PatternId };
export { parseValue as parseTomlValue, generateFromShells };
