/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SatelliteSpec } from "./satellites";
import type { GroundStation, VisibilityMode } from "./groundStations";
import type { IslShellRange } from "./isl/types";
import {
  expandSatelliteEditorConfig,
  parseSatelliteEditorConfig,
} from "./satelliteEditorSerializer";

const EARTH_RADIUS_KM = 6378.137;

function parseValue(raw: string): any {
  const s = raw.trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(s)) {
    return new Date(s.replace(/['"]/g, ""));
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

function parseArrayTable(text: string, marker: string): Record<string, any>[] {
  const lines = text.split(/\r?\n/);
  const result: Record<string, any>[] = [];
  let current: Record<string, any> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === `[[${marker}]]`) {
      if (current) result.push(current);
      current = {};
      continue;
    }

    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (m) {
      const value = parseValue(m[2]);
      if (!current) {
        current = { [m[1]]: value };
      } else {
        current[m[1]] = value;
      }
    }
  }

  if (current) result.push(current);
  return result;
}

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
}

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
  /** One entry per shell, with the metadata needed to resolve ISL participation (§2.4). */
  ranges: IslShellRange[];
}

/**
 * Generate every shell's satellites, tracking each shell's own generated count
 * separately (a shell's inner loop must stop once *that shell* has produced
 * `count` satellites — not once the whole accumulated array reaches `count`,
 * which truncates every shell after the first in a multi-shell constellation).
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
    const count = Number(shell.count);
    const planes = Number(shell.planes);
    const perPlane = Math.ceil(count / planes);
    const phasing = Number(shell.phasing ?? 0);
    const ecc = Number(shell.eccentricity ?? 0);
    const inc = Number(shell.inclination ?? 0);
    const aAltitude = Number(shell.apogee_altitude ?? 0);
    const raanRange = Number(shell.raan_range ?? 360);
    const raanStart = Number(shell.raan_start ?? 0);
    const argp = Number(shell.argp ?? 0);
    const m0 = Number(shell.mean_anomaly_0 ?? 0);
    const apogeeRadius = EARTH_RADIUS_KM + aAltitude;
    const semiMajorAxisKm = apogeeRadius / (1 + ecc);

    const startIndex = baseOffset + sats.length;
    let generated = 0;

    for (let p = 0; p < planes; p++) {
      const raan = raanStart + (raanRange * p) / planes;
      for (let j = 0; j < perPlane && generated < count; j++) {
        const ma = (m0 + (360 / count) * (p * phasing + j * planes)) % 360;
        sats.push({
          type: "elements",
          elements: {
            satnum: nextSatnum++,
            epoch,
            semiMajorAxisKm,
            eccentricity: ecc,
            inclinationDeg: inc,
            raanDeg: raan,
            argPerigeeDeg: argp,
            meanAnomalyDeg: ma,
          },
        });
        generated++;
      }
    }

    ranges.push({
      key: String(shellIdx),
      name: shell.name,
      startIndex,
      count: generated,
      planes,
    });
  });

  return { satellites: sats, ranges };
}

function generateFromShells(con: ConstellationConfig): SatelliteSpec[] {
  return generateFromShellsDetailed(con, 0).satellites;
}

/**
 * Resolve shell index ranges for ISL participation/topology (§2.4), from the
 * *actual* generated satellite counts rather than the nominal `shell.count`
 * (H-1 fix). `baseOffset` is the number of satellites.toml satellites that
 * precede the constellation shells in the combined array.
 */
export function generateShellRanges(con: ConstellationConfig, baseOffset: number): IslShellRange[] {
  return generateFromShellsDetailed(con, baseOffset).ranges;
}

export function parseConstellationConfig(text: string): ConstellationConfig {
  const lines = text.split(/\r?\n/);
  const con: Record<string, any> = { shells: [] };
  let current: Record<string, any> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "[constellation]") {
      continue;
    }
    if (line === "[[constellation.shells]]") {
      if (current) con.shells.push(current);
      current = {};
      continue;
    }

    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (m) {
      const value = parseValue(m[2]);
      if (current) {
        current[m[1]] = value;
      } else {
        con[m[1]] = value;
      }
    }
  }

  if (current) con.shells.push(current);
  return {
    epoch: con.epoch instanceof Date ? con.epoch : new Date(String(con.epoch)),
    shells: (con.shells as Record<string, any>[]).map((shell) => ({
      name: typeof shell.name === "string" ? shell.name : undefined,
      count: numberOrDefault(shell.count, 1),
      planes: numberOrDefault(shell.planes, 1),
      phasing: shell.phasing !== undefined ? numberOrDefault(shell.phasing, 0) : undefined,
      apogee_altitude: numberOrDefault(shell.apogee_altitude, 0),
      eccentricity:
        shell.eccentricity !== undefined ? numberOrDefault(shell.eccentricity, 0) : undefined,
      inclination: numberOrDefault(shell.inclination, 0),
      raan_range: shell.raan_range !== undefined ? numberOrDefault(shell.raan_range, 360) : undefined,
      raan_start: shell.raan_start !== undefined ? numberOrDefault(shell.raan_start, 0) : undefined,
      argp: shell.argp !== undefined ? numberOrDefault(shell.argp, 0) : undefined,
      mean_anomaly_0:
        shell.mean_anomaly_0 !== undefined ? numberOrDefault(shell.mean_anomaly_0, 0) : undefined,
    })),
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
 * receive identical text, not because it was structurally guaranteed
 * (isl-routing-review.md SP-9, the same drift class as H-1).
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

export { parseValue as parseTomlValue, generateFromShells };
