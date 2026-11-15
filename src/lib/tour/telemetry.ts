/**
 * Webcast-style telemetry readout for a tour track: T+ clock, speed and
 * altitude derived from the tabulated trajectory (cubic Hermite state).
 */
import { trajectoryStateAt } from "../trajectory/interpolate";
import type { TrajectoryTrack } from "../trajectory/types";
import { formatTourClock } from "./parse";

export interface TourTelemetry {
  /** "before": not yet started (held at the first sample); "after": past the last sample. */
  phase: "before" | "active" | "after";
  /** T+ clock relative to the track's epoch (else its first sample). */
  clock: string;
  /** Earth-relative speed, km/h. */
  speedKmh: number;
  altKm: number;
}

/**
 * Readout of `track` at `ms`. Outside the track's span the state is held at
 * the nearest end (the pad before lift-off, the last point after the end),
 * flagged by `phase`. Null for a track without samples.
 */
export function tourTelemetryAt(track: TrajectoryTrack, ms: number): TourTelemetry | null {
  const n = track.samples.length;
  if (n === 0) return null;
  const first = track.samples[0].timeMs;
  const last = track.samples[n - 1].timeMs;
  const phase = ms < first ? "before" : ms > last ? "after" : "active";
  const t = Math.min(Math.max(ms, first), last);
  const state = trajectoryStateAt(track, t);
  if (!state) return null;
  // Held on the pad / at the end point: no motion to report.
  const speedKmS = phase === "active" ? state.speedKmS : 0;
  return {
    phase,
    clock: formatTourClock(ms - (track.epochMs ?? first)),
    speedKmh: speedKmS * 3600,
    altKm: Math.max(0, state.altKm),
  };
}

/** Speed with thousands separators ("27,012"). */
export function formatSpeedKmh(kmh: number): string {
  return Math.round(kmh).toLocaleString("ja-JP");
}

/** Altitude: one decimal below 100 km, integer above. */
export function formatAltitudeKm(km: number): string {
  return km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString("ja-JP");
}
