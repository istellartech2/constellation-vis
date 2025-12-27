/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SatelliteSpec } from "./satellites";
import type { GroundStation } from "./groundStations";

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

function buildSatelliteMeta(entry: Record<string, any>) {
  const meta = {
    objectName: entry.name ?? entry.OBJECT_NAME,
    objectId: entry.objectId ?? entry.OBJECT_ID,
    noradCatId:
      entry.noradCatId !== undefined && entry.noradCatId !== null
        ? Number(entry.noradCatId)
        : entry.NORAD_CAT_ID !== undefined
          ? Number(entry.NORAD_CAT_ID)
          : undefined,
  };
  const hasMeta =
    meta.objectName !== undefined || meta.objectId !== undefined || meta.noradCatId !== undefined;
  return hasMeta ? meta : undefined;
}

export function parseSatellitesToml(text: string): SatelliteSpec[] {
  const entries = parseArrayTable(text, "satellites");

  return entries.map((entry) => {
    const meta = buildSatelliteMeta(entry);
    if (entry.type === "tle") {
      return {
        type: "tle",
        lines: [String(entry.line1 ?? ""), String(entry.line2 ?? "")],
        ...(meta ? { meta } : {}),
      } as SatelliteSpec;
    }
    if (entry.type === "elements") {
      return {
        type: "elements",
        elements: {
          satnum: Number(entry.satnum),
          epoch: new Date(String(entry.epoch)),
          semiMajorAxisKm: Number(entry.semiMajorAxisKm),
          eccentricity: Number(entry.eccentricity),
          inclinationDeg: Number(entry.inclinationDeg),
          raanDeg: Number(entry.raanDeg),
          argPerigeeDeg: Number(entry.argPerigeeDeg),
          meanAnomalyDeg: Number(entry.meanAnomalyDeg),
        },
        ...(meta ? { meta } : {}),
      } as SatelliteSpec;
    }
    throw new Error("Unknown satellite type");
  });
}

function generateFromShells(con: any): SatelliteSpec[] {
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

export function parseConstellationToml(text: string): SatelliteSpec[] {
  const lines = text.split(/\r?\n/);
  const con: any = { shells: [] };
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
  return generateFromShells(con);
}

export function parseGroundStationsToml(text: string): GroundStation[] {
  const entries = parseArrayTable(text, "groundstations");

  return entries.map((entry) => ({
    name: String(entry.name ?? ""),
    latitudeDeg: Number(entry.latitudeDeg),
    longitudeDeg: Number(entry.longitudeDeg),
    heightKm: Number(entry.heightKm ?? 0),
    minElevationDeg: Number(entry.minElevationDeg ?? 0),
  }));
}

export { parseValue as parseTomlValue, generateFromShells };
