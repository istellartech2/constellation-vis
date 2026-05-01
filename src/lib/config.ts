import type { SatelliteSpec } from "./satellites";
import type { GroundStation } from "./groundStations";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
  parseTomlValue,
} from "./tomlParsers";

export { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml };

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
  const sections: Record<"satellites" | "constellation" | "groundstations", string[]> = {
    satellites: [],
    constellation: [],
    groundstations: [],
  };

  let current: keyof typeof sections | null = null;
  let startTimeLine: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const sectionMatch = trimmed.match(/^# ===\s*(satellites|constellation|groundstations)\s*===\s*$/i);
    if (sectionMatch) {
      current = sectionMatch[1].toLowerCase() as keyof typeof sections;
      continue;
    }
    if (/^startTime\s*=/.test(trimmed)) {
      startTimeLine = trimmed;
      current = null;
      continue;
    }
    if (current) {
      sections[current].push(rawLine);
    }
  }

  const satText = sections.satellites.join("\n").trim();
  const constText = sections.constellation.join("\n").trim();
  const gsText = sections.groundstations.join("\n").trim();

  let start = new Date();
  if (startTimeLine) {
    const valuePart = startTimeLine.slice(startTimeLine.indexOf("=") + 1);
    const parsed = parseTomlValue(valuePart);
    start = parsed instanceof Date ? parsed : new Date(String(parsed));
  }

  const base = satText ? parseSatellitesToml(satText) : [];
  const con = constText ? parseConstellationToml(constText) : [];
  const ground = gsText ? parseGroundStationsToml(gsText) : [];
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
  return [
    "# === satellites ===",
    satText.trim(),
    "",
    "# === constellation ===",
    constText.trim(),
    "",
    "# === groundstations ===",
    gsText.trim(),
    "",
    `startTime = "${start.toISOString()}"`,
  ].join("\n");
}

export function downloadFile(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
