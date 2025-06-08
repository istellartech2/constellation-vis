import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from './tomlParse';
import type { SatelliteSpec } from '../lib/satellites';
import type { GroundStation } from '../lib/groundStations';

export interface ConfigBundle {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
}

/** Parse a combined TOML file produced by {@link buildConfigBundle}. */
export function parseConfigBundle(text: string): ConfigBundle {
  const satMatch = text.match(/# === satellites ===\n([\s\S]*?)\n# ===/);
  const constMatch = text.match(/# === constellation ===\n([\s\S]*?)\n# ===/);
  const gsMatch = text.match(/# === groundstations ===\n([\s\S]*?)\nstartTime/);
  const satText = satMatch ? satMatch[1].trim() : '';
  const constText = constMatch ? constMatch[1].trim() : '';
  const gsText = gsMatch ? gsMatch[1].trim() : '';
  const m = text.match(/startTime\s*=\s*(.+)/);
  const start = m ? new Date(m[1].replace(/["']/g, '')) : new Date();
  const base = parseSatellitesToml(satText);
  const con = constText ? parseConstellationToml(constText) : [];
  const ground = parseGroundStationsToml(gsText);
  return {
    satText,
    constText,
    gsText,
    startTime: start,
    satellites: [...base, ...con],
    groundStations: ground,
  };
}

/** Build a single TOML string combining all current configuration. */
export function buildConfigBundle(
  satText: string,
  constText: string,
  gsText: string,
  start: Date,
): string {
  const parts: string[] = [
    '# === satellites ===',
    satText.trim(),
    '',
    '# === constellation ===',
    constText.trim(),
    '',
    '# === groundstations ===',
    gsText.trim(),
    '',
    `startTime = "${start.toISOString()}"`,
  ];
  return parts.join('\n');
}
