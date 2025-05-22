// Utility to parse minimal TOML used for satellites and constellations
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SatelliteSpec } from "../satellites";

function parseValue(v: string): any {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(s)) return new Date(s.replace(/['"]/g, ""));
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

export function parseSatellitesToml(text: string): SatelliteSpec[] {
  const lines = text.split(/\r?\n/);
  const result: any[] = [];
  let current: Record<string, any> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[satellites]]') {
      if (current) result.push(current);
      current = {};
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (m && current) {
      current[m[1]] = parseValue(m[2]);
    }
  }
  if (current) result.push(current);

  return result.map((s) => {
    if (s.type === 'tle') {
      return { type: 'tle', lines: [String(s.line1 || ''), String(s.line2 || '')] } as SatelliteSpec;
    }
    if (s.type === 'elements') {
      return {
        type: 'elements',
        elements: {
          satnum: Number(s.satnum),
          epoch: new Date(String(s.epoch)),
          semiMajorAxisKm: Number(s.semiMajorAxisKm),
          eccentricity: Number(s.eccentricity),
          inclinationDeg: Number(s.inclinationDeg),
          raanDeg: Number(s.raanDeg),
          argPerigeeDeg: Number(s.argPerigeeDeg),
          meanAnomalyDeg: Number(s.meanAnomalyDeg),
        },
      } as SatelliteSpec;
    }
    throw new Error('Unknown satellite type');
  });
}

const EARTH_RADIUS_KM = 6371;

function generateFromShells(con: any): SatelliteSpec[] {
  const epoch = new Date(String(con.epoch));
  let nextSatnum = 10000;
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
    const semiMajorAxisKm = EARTH_RADIUS_KM + aAltitude;

    for (let p = 0; p < planes; p++) {
      const raan = raanStart + (raanRange * p) / planes;
      for (let j = 0; j < perPlane && sats.length < count; j++) {
        const ma = (m0 + (360 / count) * (p * phasing + j * planes)) % 360;
        sats.push({
          type: 'elements',
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
    if (!line || line.startsWith('#')) continue;
    if (line === '[constellation]') {
      continue;
    }
    if (line === '[[constellation.shells]]') {
      if (current) con.shells.push(current);
      current = {};
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (m) {
      const val = parseValue(m[2]);
      if (current) {
        current[m[1]] = val;
      } else {
        con[m[1]] = val;
      }
    }
  }
  if (current) con.shells.push(current);
  return generateFromShells(con);
}
