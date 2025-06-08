import type { SatelliteSpec } from "../lib/satellites";
import type { GroundStation } from "../lib/groundStations";

export function validateSatellites(list: SatelliteSpec[]) {
  for (const s of list) {
    if (s.type === "tle") {
      if (!s.lines[0] || !s.lines[1]) {
        throw new Error("satellites.toml: missing TLE lines");
      }
    } else if (s.type === "elements") {
      const e = s.elements;
      if (
        e.satnum === undefined ||
        !(e.epoch instanceof Date) ||
        Number.isNaN(e.semiMajorAxisKm) ||
        Number.isNaN(e.eccentricity) ||
        Number.isNaN(e.inclinationDeg) ||
        Number.isNaN(e.raanDeg) ||
        Number.isNaN(e.argPerigeeDeg) ||
        Number.isNaN(e.meanAnomalyDeg)
      ) {
        throw new Error("satellites.toml: incomplete elements entry");
      }
    }
  }
}

export function validateGroundStations(list: GroundStation[]) {
  for (const g of list) {
    if (!g.name || Number.isNaN(g.latitudeDeg) || Number.isNaN(g.longitudeDeg)) {
      throw new Error("groundstations.toml: missing required fields");
    }
  }
}