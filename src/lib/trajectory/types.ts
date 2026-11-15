/**
 * Tabulated trajectory ("ephemeris") tracks: time-tagged positions loaded from
 * a file and replayed in the 3D scene, independent of SGP4/J2. Used for launch
 * vehicles (reconstructed or simulated ascent/return trajectories) and any
 * other object whose motion is given as a table rather than orbital elements.
 *
 * Internally every track is stored Earth-fixed (ECEF, km), because launch and
 * return trajectories are naturally ground-relative and the scene draws
 * Earth-fixed overlays inside a group rotated by GMST (like the KML layer).
 */

/** Frame the source file's positions were given in. */
export type TrajectorySourceFrame = "LLA" | "ECEF" | "ECI";

/** Earth-fixed Cartesian vector in km (or km/s for velocities). */
export interface EcefVector {
  x: number;
  y: number;
  z: number;
}

/** One tabulated state. `velocity` is present only when the file supplied it. */
export interface TrajectorySample {
  /** Absolute time, ms since the Unix epoch (UTC). */
  timeMs: number;
  /** ECEF position in km. */
  position: EcefVector;
  /** ECEF (Earth-relative) velocity in km/s, if given in the source. */
  velocity?: EcefVector;
}

/** A named instant on the track (e.g. "MECO", "Hot staging", "Splashdown"). */
export interface TrajectoryEvent {
  timeMs: number;
  label: string;
}

export interface TrajectoryTrack {
  /** Stable id for React keys and scene bookkeeping. */
  id: string;
  /** Display name (from the file's `# name:` header, else the file name). */
  name: string;
  /** CSS colour string used for trail, marker and event markers. */
  color: string;
  visible: boolean;
  sourceFrame: TrajectorySourceFrame;
  /** Strictly increasing in `timeMs`, at least 2 samples. */
  samples: TrajectorySample[];
  /** Sorted by time; may be empty. */
  events: TrajectoryEvent[];
  /** Optional reference epoch (e.g. lift-off) used for "T+" readouts, ms UTC. */
  epochMs?: number;
}

/** Interpolated state at an arbitrary time inside the track span. */
export interface TrajectoryState {
  timeMs: number;
  /** ECEF position, km. */
  position: EcefVector;
  /** ECEF (Earth-relative) velocity, km/s. */
  velocity: EcefVector;
  /** Geodetic latitude/longitude in degrees, altitude above WGS84 in km. */
  latDeg: number;
  lonDeg: number;
  altKm: number;
  /** Earth-relative speed, km/s. */
  speedKmS: number;
}

/** Result of parsing one file: a track (without id/color/visible) or an error. */
export type TrajectoryParseResult =
  | { ok: true; track: Omit<TrajectoryTrack, "id" | "color" | "visible">; warnings: string[] }
  | { ok: false; error: string };
