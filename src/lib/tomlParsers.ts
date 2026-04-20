/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SatelliteSpec } from "./satellites";
import type { GroundStation, VisibilityMode } from "./groundStations";
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
  name?: string;
  epoch: Date;
  shells: ConstellationShellConfig[];
}

export function parseSatellitesToml(text: string): SatelliteSpec[] {
  return expandSatelliteEditorConfig(parseSatelliteEditorConfig(text));
}

function generateFromShells(con: ConstellationConfig): SatelliteSpec[] {
  const epoch = con.epoch instanceof Date ? con.epoch : new Date(String(con.epoch));
  // ID ranges:
  //   1-9999: Constellation generated satellites
  //   10000-89999: NORAD catalog IDs (CelesTrak imports)
  //   90000-99999: Manual definitions (satellites.toml)
  // Note: TLE format only supports 5-digit satellite numbers (max 99999)
  let nextSatnum = 1;
  const sats: SatelliteSpec[] = [];

  for (const shell of con.shells ?? []) {
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

    for (let p = 0; p < planes; p++) {
      const raan = raanStart + (raanRange * p) / planes;
      for (let j = 0; j < perPlane && sats.length < count; j++) {
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
      }
    }
  }

  return sats;
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
    name: typeof con.name === "string" ? con.name : undefined,
    epoch: con.epoch instanceof Date ? con.epoch : new Date(String(con.epoch)),
    shells: (con.shells as Record<string, any>[]).map((shell) => ({
      name: typeof shell.name === "string" ? shell.name : undefined,
      count: Number(shell.count),
      planes: Number(shell.planes),
      phasing: shell.phasing !== undefined ? Number(shell.phasing) : undefined,
      apogee_altitude: Number(shell.apogee_altitude),
      eccentricity:
        shell.eccentricity !== undefined ? Number(shell.eccentricity) : undefined,
      inclination: Number(shell.inclination),
      raan_range: shell.raan_range !== undefined ? Number(shell.raan_range) : undefined,
      raan_start: shell.raan_start !== undefined ? Number(shell.raan_start) : undefined,
      argp: shell.argp !== undefined ? Number(shell.argp) : undefined,
      mean_anomaly_0:
        shell.mean_anomaly_0 !== undefined ? Number(shell.mean_anomaly_0) : undefined,
    })),
  };
}

export function parseConstellationToml(text: string): SatelliteSpec[] {
  return generateFromShells(parseConstellationConfig(text));
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
