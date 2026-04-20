import * as satellite from "satellite.js";
import * as THREE from "three";
import type { SatelliteSpec } from "./satellites";
import { toSatrec } from "./satellites";
import type { GroundStation, VisibilityMode } from "./groundStations";

/** Convert a list of satellite specs to satrec objects. */
function toSatrecs(sats: SatelliteSpec[]): satellite.SatRec[] {
  return sats.map((s) => toSatrec(s));
}

export interface VisibilityCriteria {
  minElevationDeg?: number;
  visibilityMode?: VisibilityMode;
  maxOffNadirDeg?: number;
}

interface PreparedObserver {
  name?: string;
  observer: {
    longitude: number;
    latitude: number;
    height: number;
  };
  stationEcf: {
    x: number;
    y: number;
    z: number;
  };
  criteria: Required<VisibilityCriteria>;
}

function prepareObserver(station: GroundStation | (VisibilityCriteria & {
  name?: string;
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
})): PreparedObserver {
  const observer = {
    longitude: satellite.degreesToRadians(station.longitudeDeg),
    latitude: satellite.degreesToRadians(station.latitudeDeg),
    height: station.heightKm,
  };

  return {
    name: station.name,
    observer,
    stationEcf: satellite.geodeticToEcf(observer),
    criteria: normalizeVisibilityCriteria(station),
  };
}

export function normalizeVisibilityCriteria(
  criteria: VisibilityCriteria,
): Required<VisibilityCriteria> {
  return {
    minElevationDeg: criteria.minElevationDeg ?? 0,
    visibilityMode: criteria.visibilityMode ?? "elevation_only",
    maxOffNadirDeg: criteria.maxOffNadirDeg ?? Number.POSITIVE_INFINITY,
  };
}

function computeOffNadirAngleRad(
  satelliteEcf: satellite.EcfVec3<number>,
  stationEcf: { x: number; y: number; z: number },
): number | null {
  const nadir = new THREE.Vector3(-satelliteEcf.x, -satelliteEcf.y, -satelliteEcf.z);
  const toStation = new THREE.Vector3(
    stationEcf.x - satelliteEcf.x,
    stationEcf.y - satelliteEcf.y,
    stationEcf.z - satelliteEcf.z,
  );

  if (nadir.lengthSq() === 0 || toStation.lengthSq() === 0) {
    return null;
  }

  const dot = THREE.MathUtils.clamp(
    nadir.normalize().dot(toStation.normalize()),
    -1,
    1,
  );
  return Math.acos(dot);
}

export function passesVisibilityCriteria(
  elevationRad: number,
  offNadirRad: number | null,
  criteria: VisibilityCriteria,
): boolean {
  const normalized = normalizeVisibilityCriteria(criteria);
  const minElevationRad = THREE.MathUtils.degToRad(normalized.minElevationDeg);
  const maxOffNadirRad = THREE.MathUtils.degToRad(normalized.maxOffNadirDeg);
  const elevationPass = elevationRad >= minElevationRad;
  const offNadirPass = offNadirRad !== null && offNadirRad <= maxOffNadirRad;

  switch (normalized.visibilityMode) {
    case "elevation_only":
      return elevationPass;
    case "off_nadir_only":
      return offNadirPass;
    case "and":
      return elevationPass && offNadirPass;
    default:
      return elevationPass;
  }
}

function countVisibleSatellitesForObserver(
  satRecs: satellite.SatRec[],
  prepared: PreparedObserver,
  date: Date,
): number {
  const gmst = satellite.gstime(date);
  let count = 0;

  for (const rec of satRecs) {
    const pv = satellite.propagate(rec, date);
    if (!pv?.position) continue;

    const ecf = satellite.eciToEcf(pv.position, gmst);
    if (isVisibleFromPreparedObserver(ecf, prepared)) {
      count++;
    }
  }

  return count;
}

function isVisibleFromPreparedObserver(
  satelliteEcf: satellite.EcfVec3<number>,
  prepared: PreparedObserver,
): boolean {
  const look = satellite.ecfToLookAngles(prepared.observer, satelliteEcf);
  const offNadirRad = computeOffNadirAngleRad(satelliteEcf, prepared.stationEcf);
  return passesVisibilityCriteria(look.elevation, offNadirRad, prepared.criteria);
}

/** Count visible satellites for a single ground station at a given time. */
export function countVisibleSatellites(
  satRecs: satellite.SatRec[],
  station: GroundStation,
  date: Date,
): number {
  return countVisibleSatellitesForObserver(satRecs, prepareObserver(station), date);
}

/**
 * Compute the average number of visible satellites over the given duration.
 * The average is taken across regular time steps.
 */
export interface VisibilityStats {
  avg: number;
  median: number;
  nonZeroRate: number;
  visibleStepCount: number;
  visibleSeconds: number;
  visibleHours: number;
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
  const prepared = prepareObserver(station);
  const startMs = start.getTime();
  const endMs = startMs + durationHours * 3600 * 1000;
  const counts: number[] = [];
  for (let ms = startMs; ms <= endMs; ms += stepSec * 1000) {
    counts.push(countVisibleSatellitesForObserver(satRecs, prepared, new Date(ms)));
  }
  const steps = counts.length;
  const total = counts.reduce((a, b) => a + b, 0);
  const sorted = counts.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  const visibleStepCount = counts.filter((c) => c > 0).length;
  const nonZeroRate = visibleStepCount / steps;
  const visibleSeconds = visibleStepCount * stepSec;
  return {
    avg: total / steps,
    median,
    nonZeroRate,
    visibleStepCount,
    visibleSeconds,
    visibleHours: visibleSeconds / 3600,
  };
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
export interface StationVisibilityEntry {
  name: string;
  visibleCount: number;
}

export interface StationVisibilitySample {
  time: string;
  timestamp: number;
  stations: StationVisibilityEntry[];
}

export function calculateStationAccessData(
  sats: SatelliteSpec[],
  stations: GroundStation[],
  start: Date,
  durationHours = 24,
  stepSeconds = 10,
): StationVisibilitySample[] {
  const satRecs = toSatrecs(sats);
  const observers = stations.map((gs) => prepareObserver(gs));

  const result: StationVisibilitySample[] = [];

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
        if (isVisibleFromPreparedObserver(ecf, obs)) counts[gi]++;
      });
    });

    const timeStr = current.toISOString().substr(11, 8); // HH:MM:SS format
    result.push({
      time: timeStr,
      timestamp: ms,
      stations: observers.map((obs, i) => ({
        name: obs.name ?? `Station ${i + 1}`,
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
  data: StationVisibilitySample[],
  averagePoints: number = 6
): StationVisibilitySample[] {
  const averaged: StationVisibilitySample[] = [];

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
  data: StationVisibilitySample[]
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
  const observers = stations.map((gs) => prepareObserver(gs));

  const header = ["Time(sec)", ...stations.map((s) => s.name)].join(",");
  const lines: string[] = [header];

  const startMs = start.getTime();
  const endMs = startMs + durationHours * 3600 * 1000;

  for (let ms = startMs, t = 0; ms <= endMs; ms += stepSec * 1000, t += stepSec) {
    const current = new Date(ms);
    const counts = observers.map(() => 0);
    observers.forEach((obs, gi) => {
      counts[gi] = countVisibleSatellitesForObserver(satRecs, obs, current);
    });
    lines.push([String(t), ...counts.map(String)].join(","));
  }

  return lines.join("\n");
}

// Calculate availability metrics for stations
export function calculateAvailabilityMetrics(
  visibilityData: StationVisibilitySample[], 
  stationIndices: number[],
  intervalSeconds: number = 10
): Array<{
  timeAvailability: number;
  interruptionFrequency: number;
  maxInterruptionTime: number;
  avgInterruptionTime: number;
}> {
  const intervalMinutes = intervalSeconds / 60;
  
  return stationIndices.map(stationIndex => {
    // Extract visibility data for this station
    const stationData = visibilityData.map(timePoint => 
      timePoint.stations[stationIndex]?.visibleCount || 0
    );
    
    // Calculate time availability (percentage of time with satellites visible)
    const availablePoints = stationData.filter(count => count > 0).length;
    const timeAvailability = (availablePoints / stationData.length) * 100;
    
    // Calculate interruption frequency and times
    let interruptionFrequency = 0;
    const interruptionDurations: number[] = [];
    let currentInterruptionStart = -1;
    
    for (let i = 0; i < stationData.length; i++) {
      if (stationData[i] === 0) {
        if (currentInterruptionStart === -1) {
          // Start of interruption
          currentInterruptionStart = i;
          if (i > 0) interruptionFrequency++; // Don't count initial state
        }
      } else {
        if (currentInterruptionStart !== -1) {
          // End of interruption
          const duration = (i - currentInterruptionStart) * intervalMinutes;
          interruptionDurations.push(duration);
          currentInterruptionStart = -1;
        }
      }
    }
    
    // Handle case where data ends during interruption
    if (currentInterruptionStart !== -1) {
      const duration = (stationData.length - currentInterruptionStart) * intervalMinutes;
      interruptionDurations.push(duration);
    }
    
    const maxInterruptionTime = interruptionDurations.length > 0 
      ? Math.max(...interruptionDurations) 
      : 0;
    const avgInterruptionTime = interruptionDurations.length > 0 
      ? interruptionDurations.reduce((sum, dur) => sum + dur, 0) / interruptionDurations.length 
      : 0;
    
    return {
      timeAvailability,
      interruptionFrequency,
      maxInterruptionTime,
      avgInterruptionTime
    };
  });
}
