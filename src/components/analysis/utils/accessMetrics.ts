// Pure access/availability metrics derived from "satellites in view" count
// series (StationVisibilitySample[]). Used by the station-access timeline and
// the global (latitude) access screen; no React, no ECharts.
import type { StationVisibilitySample } from "../../../lib/visibility";

/** One run of constant, non-zero "satellites in view" at one station. */
export interface ContactSegment {
  stationIndex: number;
  startMs: number;
  /** Exclusive end: the timestamp at which the count changed (or the series ended). */
  endMs: number;
  count: number;
}

export interface AccessSummary {
  /** Share of time with ≥1 satellite in view (%). */
  availabilityPct: number;
  /** Share of time with ≥2 satellites in view (%). */
  redundancyPct: number;
  /** Contact windows (runs of count > 0), including one already open at the start. */
  passCount: number;
  passesPerDay: number;
  /** Outages that start after the first sample (an outage open at t=0 is not counted). */
  interruptionCount: number;
  interruptionsPerDay: number;
  /** Longest / mean outage including outages open at the start or end (min). */
  maxGapMin: number;
  avgGapMin: number;
}

export interface StationAccessSummary extends AccessSummary {
  name: string;
}

const EMPTY_SUMMARY: AccessSummary = {
  availabilityPct: 0,
  redundancyPct: 0,
  passCount: 0,
  passesPerDay: 0,
  interruptionCount: 0,
  interruptionsPerDay: 0,
  maxGapMin: 0,
  avgGapMin: 0,
};

/** Counts of one station across all samples (missing entries read as 0). */
export function stationCounts(samples: StationVisibilitySample[], stationIndex: number): number[] {
  return samples.map((s) => s.stations[stationIndex]?.visibleCount ?? 0);
}

/**
 * Availability, redundancy and outage statistics for one count series sampled
 * every `stepSeconds`. Each sample represents one step of time.
 */
export function summarizeCounts(counts: ArrayLike<number>, stepSeconds: number): AccessSummary {
  const n = counts.length;
  if (n === 0 || stepSeconds <= 0) return { ...EMPTY_SUMMARY };
  const stepMin = stepSeconds / 60;
  const days = (n * stepSeconds) / 86400;

  let visible = 0;
  let redundant = 0;
  let passCount = 0;
  let interruptionCount = 0;
  let gapRun = 0;
  let gapTotal = 0;
  let gapN = 0;
  let maxGap = 0;
  let prevVisible = false;

  const closeGap = () => {
    if (gapRun === 0) return;
    const minutes = gapRun * stepMin;
    gapTotal += minutes;
    gapN += 1;
    if (minutes > maxGap) maxGap = minutes;
    gapRun = 0;
  };

  for (let i = 0; i < n; i++) {
    const c = counts[i] ?? 0;
    const isVisible = c > 0;
    if (isVisible) {
      visible += 1;
      if (c >= 2) redundant += 1;
      if (!prevVisible) passCount += 1;
      closeGap();
    } else {
      if (prevVisible) interruptionCount += 1;
      gapRun += 1;
    }
    prevVisible = isVisible;
  }
  closeGap();

  return {
    availabilityPct: (visible / n) * 100,
    redundancyPct: (redundant / n) * 100,
    passCount,
    passesPerDay: days > 0 ? passCount / days : 0,
    interruptionCount,
    interruptionsPerDay: days > 0 ? interruptionCount / days : 0,
    maxGapMin: maxGap,
    avgGapMin: gapN > 0 ? gapTotal / gapN : 0,
  };
}

/** Per-station summaries, in station order. */
export function summarizeStations(
  samples: StationVisibilitySample[],
  names: string[],
  stepSeconds: number,
): StationAccessSummary[] {
  return names.map((name, index) => ({
    name,
    ...summarizeCounts(stationCounts(samples, index), stepSeconds),
  }));
}

/**
 * Network-level summary: a sample counts as "in contact" when any station has
 * a satellite in view; redundancy means ≥2 satellites summed over stations.
 */
export function summarizeNetwork(
  samples: StationVisibilitySample[],
  stepSeconds: number,
): AccessSummary {
  const combined = samples.map((s) => s.stations.reduce((sum, st) => sum + (st.visibleCount > 0 ? st.visibleCount : 0), 0));
  return summarizeCounts(combined, stepSeconds);
}

/**
 * Run-length encode every station's count series into segments of constant
 * count > 0. Zero runs are omitted, so gaps stay empty in the timeline.
 */
export function buildContactSegments(
  samples: StationVisibilitySample[],
  stepSeconds: number,
): ContactSegment[] {
  if (samples.length === 0) return [];
  const stationCount = samples[0].stations.length;
  const stepMs = stepSeconds * 1000;
  const lastEnd = samples[samples.length - 1].timestamp + stepMs;
  const segments: ContactSegment[] = [];

  for (let s = 0; s < stationCount; s++) {
    let runStart = -1;
    let runCount = 0;
    for (let i = 0; i < samples.length; i++) {
      const c = samples[i].stations[s]?.visibleCount ?? 0;
      if (c === runCount) continue;
      if (runCount > 0 && runStart >= 0) {
        segments.push({ stationIndex: s, startMs: samples[runStart].timestamp, endMs: samples[i].timestamp, count: runCount });
      }
      runCount = c;
      runStart = i;
    }
    if (runCount > 0 && runStart >= 0) {
      segments.push({ stationIndex: s, startMs: samples[runStart].timestamp, endMs: lastEnd, count: runCount });
    }
  }
  return segments;
}

/** Contiguous latitude ranges (inclusive, degrees) where `predicate` holds. */
export function latitudeRanges<T extends { latitude: number }>(
  rows: T[],
  predicate: (row: T) => boolean,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start: number | null = null;
  let prev = 0;
  for (const row of rows) {
    if (predicate(row)) {
      if (start === null) start = row.latitude;
      prev = row.latitude;
    } else if (start !== null) {
      ranges.push([start, prev]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, prev]);
  return ranges;
}

/** "60°N", "0°", "35°S". */
export function formatLatitude(lat: number): string {
  if (lat === 0) return "0°";
  return `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`;
}

/** Area-weighted (cos φ) mean of a per-latitude value. */
export function areaWeightedMean<T extends { latitude: number }>(rows: T[], value: (row: T) => number): number {
  let sum = 0;
  let weight = 0;
  for (const row of rows) {
    const w = Math.cos((row.latitude * Math.PI) / 180);
    if (w <= 0) continue;
    sum += value(row) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}
