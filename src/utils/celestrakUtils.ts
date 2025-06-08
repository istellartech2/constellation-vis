import type { SatelliteSpec } from "../lib/satellites";

const MU = 398600.4418; // km^3/s^2

export const CELESTRAK_GROUP_URLS = {
  // Special Interest
  "last-30-days": "last-30-days",
  "stations": "stations",
  "active": "active",
  "geo": "geo",
  "cubesat": "cubesat",
  
  // Weather & Earth Observation
  "weather": "weather",
  "planet": "planet",
  "spire": "spire",
  
  // Communications
  "starlink": "starlink",
  "oneweb": "oneweb",
  "intelsat": "intelsat",
  "ses": "ses",
  "iridium": "iridium",
  "globalstar": "globalstar",
  "amateur": "amateur",
  
  // Navigation
  "gnss": "gnss",
  "gps-ops": "gps-ops",
  "glo-ops": "glo-ops",
  "galileo": "galileo",
  "beidou": "beidou",
  "sbas": "sbas",
  
  // Debris
  "cosmos-1408-debris": "cosmos-1408-debris",
  "fengyun-1c-debris": "fengyun-1c-debris",
  "iridium-33-debris": "iridium-33-debris", 
  "cosmos-2251-debris": "cosmos-2251-debris",
} as const;

export interface CelestrakEntry {
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  NORAD_CAT_ID: number;
  EPOCH: string;
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
}

export function celestrakEntryToSat(entry: CelestrakEntry): SatelliteSpec {
  const mm = Number(entry.MEAN_MOTION);
  const n = (mm * 2 * Math.PI) / 86400; // rad/s
  const a = Math.pow(MU / (n * n), 1 / 3);
  return {
    type: "elements",
    elements: {
      satnum: Number(entry.NORAD_CAT_ID),
      epoch: new Date(String(entry.EPOCH)),
      semiMajorAxisKm: a,
      eccentricity: Number(entry.ECCENTRICITY),
      inclinationDeg: Number(entry.INCLINATION),
      raanDeg: Number(entry.RA_OF_ASC_NODE),
      argPerigeeDeg: Number(entry.ARG_OF_PERICENTER),
      meanAnomalyDeg: Number(entry.MEAN_ANOMALY),
    },
    meta: {
      objectName: entry.OBJECT_NAME,
      objectId: entry.OBJECT_ID,
      noradCatId: Number(entry.NORAD_CAT_ID),
    },
  };
}

export function getCelestrakUrl(group: string): string {
  const urlGroup = CELESTRAK_GROUP_URLS[group as keyof typeof CELESTRAK_GROUP_URLS] || group;
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${urlGroup}&FORMAT=json`;
}

export function satellitesToToml(list: SatelliteSpec[]): string {
  return list
    .map((s) => {
      const meta = s.meta
        ? ((s.meta.objectName ? `name = ${JSON.stringify(s.meta.objectName)}\n` : "") +
            (s.meta.objectId ? `objectId = ${JSON.stringify(s.meta.objectId)}\n` : "") +
            (s.meta.noradCatId !== undefined ? `noradCatId = ${s.meta.noradCatId}\n` : ""))
        : "";
      if (s.type === "tle") {
        return (
          "[[satellites]]\n" +
          'type = "tle"\n' +
          meta +
          `line1 = ${JSON.stringify(s.lines[0])}\n` +
          `line2 = ${JSON.stringify(s.lines[1])}`
        );
      }
      const e = s.elements;
      return (
        "[[satellites]]\n" +
        'type = "elements"\n' +
        meta +
        `satnum = ${e.satnum}\n` +
        `epoch = ${JSON.stringify(e.epoch.toISOString())}\n` +
        `semiMajorAxisKm = ${e.semiMajorAxisKm}\n` +
        `eccentricity = ${e.eccentricity}\n` +
        `inclinationDeg = ${e.inclinationDeg}\n` +
        `raanDeg = ${e.raanDeg}\n` +
        `argPerigeeDeg = ${e.argPerigeeDeg}\n` +
        `meanAnomalyDeg = ${e.meanAnomalyDeg}`
      );
    })
    .join("\n\n");
}