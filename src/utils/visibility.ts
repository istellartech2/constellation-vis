import * as satellite from "satellite.js";
import * as THREE from "three";
import type { SatelliteSpec } from "../data/satellites";
import { toSatrec } from "../data/satellites";
import type { GroundStation } from "../data/groundStations";

/** Convert a list of satellite specs to satrec objects. */
function toSatrecs(sats: SatelliteSpec[]): satellite.SatRec[] {
  return sats.map((s) => toSatrec(s));
}

/** Count visible satellites for a single ground station at a given time. */
export function countVisibleSatellites(
  satRecs: satellite.SatRec[],
  station: GroundStation,
  date: Date,
): number {
  const gmst = satellite.gstime(date);
  const observer = {
    longitude: satellite.degreesToRadians(station.longitudeDeg),
    latitude: satellite.degreesToRadians(station.latitudeDeg),
    height: station.heightKm,
  };
  const minEl = THREE.MathUtils.degToRad(station.minElevationDeg);
  let count = 0;
  for (const rec of satRecs) {
    const pv = satellite.propagate(rec, date);
    if (!pv?.position) continue;
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(observer, ecf);
    if (look.elevation > minEl) count++;
  }
  return count;
}

/**
 * Compute the average number of visible satellites over the given duration.
 * The average is taken across regular time steps.
 */
export interface VisibilityStats {
  avg: number;
  median: number;
  nonZeroRate: number;
}

/**
 * Compute visibility statistics (average, median, non-zero rate) over the given duration.
 */
export function visibilityStats(
  sats: SatelliteSpec[],
  station: GroundStation,
  start: Date,
  durationHours = 12,
  stepSec = 10,
): VisibilityStats {
  const satRecs = toSatrecs(sats);
  const startMs = start.getTime();
  const endMs = startMs + durationHours * 3600 * 1000;
  const counts: number[] = [];
  for (let ms = startMs; ms <= endMs; ms += stepSec * 1000) {
    counts.push(countVisibleSatellites(satRecs, station, new Date(ms)));
  }
  const steps = counts.length;
  const total = counts.reduce((a, b) => a + b, 0);
  const sorted = counts.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  const nonZeroRate = counts.filter((c) => c > 0).length / steps;
  return { avg: total / steps, median, nonZeroRate };
}

export function averageVisibility(
  sats: SatelliteSpec[],
  station: GroundStation,
  start: Date,
  durationHours = 12,
  stepSec = 10,
): number {
  return visibilityStats(sats, station, start, durationHours, stepSec).avg;
}

/**
 * Generate a CSV visibility report for multiple ground stations.
 * Each row corresponds to a time step.
 */
export function generateVisibilityReport(
  sats: SatelliteSpec[],
  stations: GroundStation[],
  start: Date,
  durationHours = 24,
  stepSec = 10,
): string {
  const satRecs = toSatrecs(sats);
  const observers = stations.map((gs) => ({
    longitude: satellite.degreesToRadians(gs.longitudeDeg),
    latitude: satellite.degreesToRadians(gs.latitudeDeg),
    height: gs.heightKm,
    minEl: THREE.MathUtils.degToRad(gs.minElevationDeg),
  }));

  const header = ["Time(sec)", ...stations.map((s) => s.name)].join(",");
  const lines: string[] = [header];

  const startMs = start.getTime();
  const endMs = startMs + durationHours * 3600 * 1000;

  for (let ms = startMs, t = 0; ms <= endMs; ms += stepSec * 1000, t += stepSec) {
    const current = new Date(ms);
    const gmst = satellite.gstime(current);
    const counts = observers.map(() => 0);
    satRecs.forEach((rec) => {
      const pv = satellite.propagate(rec, current);
      if (!pv?.position) return;
      const ecf = satellite.eciToEcf(pv.position, gmst);
      observers.forEach((obs, gi) => {
        const look = satellite.ecfToLookAngles(obs, ecf);
        if (look.elevation > obs.minEl) counts[gi]++;
      });
    });
    lines.push([String(t), ...counts.map(String)].join(","));
  }

  return lines.join("\n");
}
