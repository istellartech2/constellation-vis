import * as satellite from "satellite.js";
import * as THREE from "three";
import type { SatelliteSpec } from "./satellites";
import { toSatrec } from "./satellites";
import type { GroundStation } from "./groundStations";

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
/**
 * Calculate visibility data for station access analysis visualization.
 * Returns time series data for each ground station.
 */
export function calculateStationAccessData(
  sats: SatelliteSpec[],
  stations: GroundStation[],
  start: Date,
  durationHours = 24,
  stepSeconds = 10,
): Array<{
  time: string;
  timestamp: number;
  stations: Array<{
    name: string;
    visibleCount: number;
  }>;
}> {
  const satRecs = toSatrecs(sats);
  const observers = stations.map((gs) => ({
    name: gs.name,
    longitude: satellite.degreesToRadians(gs.longitudeDeg),
    latitude: satellite.degreesToRadians(gs.latitudeDeg),
    height: gs.heightKm,
    minEl: THREE.MathUtils.degToRad(gs.minElevationDeg),
  }));

  const result: Array<{
    time: string;
    timestamp: number;
    stations: Array<{
      name: string;
      visibleCount: number;
    }>;
  }> = [];

  const startMs = start.getTime();
  const endMs = startMs + durationHours * 3600 * 1000;
  const stepMs = stepSeconds * 1000;

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
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

    const timeStr = current.toISOString().substr(11, 8); // HH:MM:SS format
    result.push({
      time: timeStr,
      timestamp: ms,
      stations: observers.map((obs, i) => ({
        name: obs.name,
        visibleCount: counts[i],
      })),
    });
  }

  return result;
}

/**
 * Average visibility data over specified interval (e.g., 6 points = 1 minute for 10-second data).
 */
export function averageVisibilityData(
  data: Array<{
    time: string;
    timestamp: number;
    stations: Array<{
      name: string;
      visibleCount: number;
    }>;
  }>,
  averagePoints: number = 6
): Array<{
  time: string;
  timestamp: number;
  stations: Array<{
    name: string;
    visibleCount: number;
  }>;
}> {
  const averaged: Array<{
    time: string;
    timestamp: number;
    stations: Array<{
      name: string;
      visibleCount: number;
    }>;
  }> = [];

  for (let i = 0; i < data.length; i += averagePoints) {
    const chunk = data.slice(i, Math.min(i + averagePoints, data.length));
    if (chunk.length === 0) continue;

    // Use the middle timestamp and time
    const middleIndex = Math.floor(chunk.length / 2);
    const middleData = chunk[middleIndex];

    // Calculate average for each station
    const stationAverages = middleData.stations.map((station, stationIndex) => {
      const sum = chunk.reduce((acc, d) => acc + d.stations[stationIndex].visibleCount, 0);
      return {
        name: station.name,
        visibleCount: sum / chunk.length // Keep decimal values for more accurate representation
      };
    });

    averaged.push({
      time: middleData.time,
      timestamp: middleData.timestamp,
      stations: stationAverages
    });
  }

  return averaged;
}

/**
 * Calculate statistics for station access analysis.
 */
export function calculateStationStats(
  data: Array<{
    time: string;
    timestamp: number;
    stations: Array<{
      name: string;
      visibleCount: number;
    }>;
  }>
): Array<{
  name: string;
  averageVisible: number;
  nonZeroRate: number;
}> {
  if (data.length === 0) return [];

  const stationNames = data[0].stations.map(s => s.name);
  
  return stationNames.map(name => {
    const counts = data.map(d => d.stations.find(s => s.name === name)?.visibleCount || 0);
    const totalCount = counts.reduce((sum, count) => sum + count, 0);
    const nonZeroCount = counts.filter(count => count > 0).length;
    
    return {
      name,
      averageVisible: totalCount / counts.length,
      nonZeroRate: nonZeroCount / counts.length
    };
  });
}

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
