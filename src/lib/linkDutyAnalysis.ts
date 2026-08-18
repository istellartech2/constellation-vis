import * as satellite from "satellite.js";
import { toSatrec, type SatelliteSpec } from "./satellites";
import {
  calculateLinkGeometry,
  type GroundTerminal,
  type LinkGeometry,
  type LinkKind,
} from "./linkGeometry";

export interface AnalysisSatellite {
  id: string;
  label: string;
  spec: SatelliteSpec;
}

export interface LinkDutyAnalysisInput {
  startTime: Date;
  durationHours: number;
  stepSeconds: number;
  eventToleranceSeconds: number;
  satellites: AnalysisSatellite[];
  terminals: GroundTerminal[];
  includeSamples?: boolean;
}

export interface LinkSample extends Omit<LinkGeometry, "visible"> {
  satelliteId: string;
  terminalId: string;
  linkKind: LinkKind;
}

export interface ContactWindow {
  satelliteId: string;
  terminalId: string;
  linkKind: LinkKind;
  aos: string;
  los: string;
  durationSeconds: number;
  maxElevationDeg: number;
  minSlantRangeKm: number;
  maxSlantRangeKm: number;
  minOneWayPropagationDelayMs: number;
  maxOneWayPropagationDelayMs: number;
  maxAbsUplinkDopplerHz: number | null;
  maxAbsDownlinkDopplerHz: number | null;
}

export interface LinkSummary {
  satelliteId: string;
  terminalId: string;
  linkKind: LinkKind;
  contactCount: number;
  totalContactSeconds: number;
  dutyRatio: number;
  maxContactSeconds: number;
  averageContactSeconds: number;
  maxOutageSeconds: number;
  averageOutageSeconds: number;
}

export interface DutySummary {
  serviceRatio: number;
  feederRatio: number;
  endToEndRatio: number;
  communicationRatio: number;
  serviceSeconds: number;
  feederSeconds: number;
  endToEndSeconds: number;
  communicationSeconds: number;
  communicationCycleCount: number;
  maxCommunicationOnSeconds: number;
  averageCommunicationOnSeconds: number;
  maxCommunicationOffSeconds: number;
  averageCommunicationOffSeconds: number;
  maxSimultaneousLinks: number;
}

export interface SatelliteDutyResult {
  satelliteId: string;
  label: string;
  duty: DutySummary;
  links: LinkSummary[];
  contactWindows: ContactWindow[];
}

export interface LinkDutyAnalysisResult {
  schemaVersion: 1;
  generator: { name: "constelation-cli"; version: string };
  analysis: {
    startTime: string;
    endTime: string;
    durationHours: number;
    stepSeconds: number;
    eventToleranceSeconds: number;
    propagationDelayModel: "geometric-vacuum";
    dopplerConvention: "positive-range-rate-is-receding";
  };
  constellationSummary: {
    endToEndDutyRatio: number;
    endToEndSeconds: number;
    satelliteCount: number;
    terminalCount: number;
  };
  satellites: SatelliteDutyResult[];
  samples: LinkSample[];
  warnings: string[];
}

interface Interval {
  startMs: number;
  endMs: number;
}

interface PairResult {
  summary: LinkSummary;
  windows: ContactWindow[];
  intervals: Interval[];
  samples: LinkSample[];
}

function sumIntervals(intervals: Interval[]): number {
  return intervals.reduce((sum, item) => sum + Math.max(0, item.endMs - item.startMs), 0) / 1000;
}

function unionIntervals(rawIntervals: Interval[]): Interval[] {
  const sorted = rawIntervals
    .filter((item) => item.endMs > item.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const result: Interval[] = [];
  for (const interval of sorted) {
    const previous = result.at(-1);
    if (!previous || interval.startMs > previous.endMs) {
      result.push({ ...interval });
    } else {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    }
  }
  return result;
}

function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const startMs = Math.max(left[i].startMs, right[j].startMs);
    const endMs = Math.min(left[i].endMs, right[j].endMs);
    if (endMs > startMs) result.push({ startMs, endMs });
    if (left[i].endMs < right[j].endMs) i += 1;
    else j += 1;
  }
  return result;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function outageDurations(intervals: Interval[], startMs: number, endMs: number): number[] {
  const outages: number[] = [];
  let cursor = startMs;
  for (const interval of intervals) {
    if (interval.startMs > cursor) outages.push((interval.startMs - cursor) / 1000);
    cursor = Math.max(cursor, interval.endMs);
  }
  if (cursor < endMs) outages.push((endMs - cursor) / 1000);
  return outages;
}

function maxConcurrent(intervals: Interval[]): number {
  const events = intervals.flatMap((interval) => [
    { time: interval.startMs, delta: 1 },
    { time: interval.endMs, delta: -1 },
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0;
  let maximum = 0;
  for (const event of events) {
    current += event.delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function refineTransition(
  satrec: satellite.SatRec,
  terminal: GroundTerminal,
  leftMs: number,
  rightMs: number,
  toleranceMs: number,
  stateAtRight: boolean,
): number {
  let left = leftMs;
  let right = rightMs;
  while (right - left > toleranceMs) {
    const middle = (left + right) / 2;
    const visible = calculateLinkGeometry(satrec, terminal, new Date(middle))?.visible ?? false;
    if (visible === stateAtRight) right = middle;
    else left = middle;
  }
  return (left + right) / 2;
}

function absoluteMaximum(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length === 0 ? null : Math.max(...numbers.map(Math.abs));
}

function analyzePair(
  satelliteInput: AnalysisSatellite,
  terminal: GroundTerminal,
  startMs: number,
  endMs: number,
  stepMs: number,
  toleranceMs: number,
  includeSamples: boolean,
): PairResult {
  const satrec = toSatrec(satelliteInput.spec);
  const grid: Array<{ timestampMs: number; geometry: LinkGeometry }> = [];
  for (let timestampMs = startMs; timestampMs <= endMs; timestampMs += stepMs) {
    const geometry = calculateLinkGeometry(satrec, terminal, new Date(timestampMs));
    if (geometry) grid.push({ timestampMs, geometry });
  }
  if (grid.length === 0 || grid.at(-1)?.timestampMs !== endMs) {
    const geometry = calculateLinkGeometry(satrec, terminal, new Date(endMs));
    if (geometry) grid.push({ timestampMs: endMs, geometry });
  }

  const intervals: Interval[] = [];
  let currentStart = grid[0]?.geometry.visible ? startMs : null;
  for (let index = 1; index < grid.length; index += 1) {
    const previous = grid[index - 1];
    const current = grid[index];
    if (previous.geometry.visible === current.geometry.visible) continue;
    const transitionMs = refineTransition(
      satrec,
      terminal,
      previous.timestampMs,
      current.timestampMs,
      toleranceMs,
      current.geometry.visible,
    );
    if (current.geometry.visible) currentStart = transitionMs;
    else if (currentStart !== null) {
      intervals.push({ startMs: currentStart, endMs: transitionMs });
      currentStart = null;
    }
  }
  if (currentStart !== null) intervals.push({ startMs: currentStart, endMs });

  const visibleGrid = grid.filter((item) => item.geometry.visible);
  const samples: LinkSample[] = includeSamples
    ? visibleGrid.map(({ geometry }) => ({
      satelliteId: satelliteInput.id,
      terminalId: terminal.id,
      linkKind: terminal.kind,
      timestamp: geometry.timestamp,
      elevationDeg: geometry.elevationDeg,
      azimuthDeg: geometry.azimuthDeg,
      offNadirDeg: geometry.offNadirDeg,
      slantRangeKm: geometry.slantRangeKm,
      rangeRateKmPerSec: geometry.rangeRateKmPerSec,
      oneWayPropagationDelayMs: geometry.oneWayPropagationDelayMs,
      roundTripPropagationDelayMs: geometry.roundTripPropagationDelayMs,
      uplinkDopplerHz: geometry.uplinkDopplerHz,
      downlinkDopplerHz: geometry.downlinkDopplerHz,
      uplinkReceivedFrequencyHz: geometry.uplinkReceivedFrequencyHz,
      downlinkReceivedFrequencyHz: geometry.downlinkReceivedFrequencyHz,
    }))
    : [];

  const windows = intervals.map((interval): ContactWindow => {
    const windowGeometries = grid
      .filter((item) => item.timestampMs >= interval.startMs && item.timestampMs <= interval.endMs)
      .map((item) => item.geometry);
    const geometries = windowGeometries.length > 0
      ? windowGeometries
      : [calculateLinkGeometry(satrec, terminal, new Date((interval.startMs + interval.endMs) / 2))]
        .filter((item): item is LinkGeometry => item !== null);
    return {
      satelliteId: satelliteInput.id,
      terminalId: terminal.id,
      linkKind: terminal.kind,
      aos: new Date(interval.startMs).toISOString(),
      los: new Date(interval.endMs).toISOString(),
      durationSeconds: (interval.endMs - interval.startMs) / 1000,
      maxElevationDeg: Math.max(...geometries.map((item) => item.elevationDeg)),
      minSlantRangeKm: Math.min(...geometries.map((item) => item.slantRangeKm)),
      maxSlantRangeKm: Math.max(...geometries.map((item) => item.slantRangeKm)),
      minOneWayPropagationDelayMs: Math.min(...geometries.map((item) => item.oneWayPropagationDelayMs)),
      maxOneWayPropagationDelayMs: Math.max(...geometries.map((item) => item.oneWayPropagationDelayMs)),
      maxAbsUplinkDopplerHz: absoluteMaximum(geometries.map((item) => item.uplinkDopplerHz)),
      maxAbsDownlinkDopplerHz: absoluteMaximum(geometries.map((item) => item.downlinkDopplerHz)),
    };
  });

  const durations = intervals.map((item) => (item.endMs - item.startMs) / 1000);
  const outages = outageDurations(intervals, startMs, endMs);
  const totalContactSeconds = sumIntervals(intervals);
  return {
    intervals,
    windows,
    samples,
    summary: {
      satelliteId: satelliteInput.id,
      terminalId: terminal.id,
      linkKind: terminal.kind,
      contactCount: intervals.length,
      totalContactSeconds,
      dutyRatio: totalContactSeconds / ((endMs - startMs) / 1000),
      maxContactSeconds: durations.length === 0 ? 0 : Math.max(...durations),
      averageContactSeconds: average(durations),
      maxOutageSeconds: outages.length === 0 ? 0 : Math.max(...outages),
      averageOutageSeconds: average(outages),
    },
  };
}

function buildDutySummary(
  pairs: PairResult[],
  startMs: number,
  endMs: number,
): { summary: DutySummary; endToEndIntervals: Interval[] } {
  const durationSeconds = (endMs - startMs) / 1000;
  const service = unionIntervals(pairs
    .filter((pair) => pair.summary.linkKind === "service")
    .flatMap((pair) => pair.intervals));
  const feeder = unionIntervals(pairs
    .filter((pair) => pair.summary.linkKind === "feeder")
    .flatMap((pair) => pair.intervals));
  const communication = unionIntervals([...service, ...feeder]);
  const endToEnd = intersectIntervals(service, feeder);
  const serviceSeconds = sumIntervals(service);
  const feederSeconds = sumIntervals(feeder);
  const communicationSeconds = sumIntervals(communication);
  const endToEndSeconds = sumIntervals(endToEnd);
  const onDurations = communication.map((item) => (item.endMs - item.startMs) / 1000);
  const offDurations = outageDurations(communication, startMs, endMs);
  return {
    endToEndIntervals: endToEnd,
    summary: {
      serviceRatio: serviceSeconds / durationSeconds,
      feederRatio: feederSeconds / durationSeconds,
      endToEndRatio: endToEndSeconds / durationSeconds,
      communicationRatio: communicationSeconds / durationSeconds,
      serviceSeconds,
      feederSeconds,
      endToEndSeconds,
      communicationSeconds,
      communicationCycleCount: communication.length,
      maxCommunicationOnSeconds: onDurations.length === 0 ? 0 : Math.max(...onDurations),
      averageCommunicationOnSeconds: average(onDurations),
      maxCommunicationOffSeconds: offDurations.length === 0 ? 0 : Math.max(...offDurations),
      averageCommunicationOffSeconds: average(offDurations),
      maxSimultaneousLinks: maxConcurrent(pairs.flatMap((pair) => pair.intervals)),
    },
  };
}

export function analyzeLinkDuty(input: LinkDutyAnalysisInput): LinkDutyAnalysisResult {
  const startMs = input.startTime.getTime();
  const endMs = startMs + input.durationHours * 3_600_000;
  const stepMs = input.stepSeconds * 1000;
  const toleranceMs = input.eventToleranceSeconds * 1000;
  const includeSamples = input.includeSamples ?? true;
  const samples: LinkSample[] = [];
  const allEndToEndIntervals: Interval[] = [];

  const satellites = input.satellites.map((satelliteInput): SatelliteDutyResult => {
    const pairs = input.terminals.map((terminal) => analyzePair(
      satelliteInput,
      terminal,
      startMs,
      endMs,
      stepMs,
      toleranceMs,
      includeSamples,
    ));
    samples.push(...pairs.flatMap((pair) => pair.samples));
    const duty = buildDutySummary(pairs, startMs, endMs);
    allEndToEndIntervals.push(...duty.endToEndIntervals);
    return {
      satelliteId: satelliteInput.id,
      label: satelliteInput.label,
      duty: duty.summary,
      links: pairs.map((pair) => pair.summary),
      contactWindows: pairs.flatMap((pair) => pair.windows),
    };
  });

  const constellationEndToEnd = unionIntervals(allEndToEndIntervals);
  const constellationEndToEndSeconds = sumIntervals(constellationEndToEnd);
  return {
    schemaVersion: 1,
    generator: { name: "constelation-cli", version: "0.1.0" },
    analysis: {
      startTime: input.startTime.toISOString(),
      endTime: new Date(endMs).toISOString(),
      durationHours: input.durationHours,
      stepSeconds: input.stepSeconds,
      eventToleranceSeconds: input.eventToleranceSeconds,
      propagationDelayModel: "geometric-vacuum",
      dopplerConvention: "positive-range-rate-is-receding",
    },
    constellationSummary: {
      endToEndDutyRatio: constellationEndToEndSeconds / ((endMs - startMs) / 1000),
      endToEndSeconds: constellationEndToEndSeconds,
      satelliteCount: input.satellites.length,
      terminalCount: input.terminals.length,
    },
    satellites,
    samples,
    warnings: [],
  };
}
