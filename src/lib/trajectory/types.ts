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

/**
 * Unit quaternion rotating BODY-frame vectors into ECEF (v_ecef = q · v_body · q*).
 * Body frame: +X = longitudinal axis toward the nose, +Z = reference "belly"
 * side (windward on a belly-first re-entry), +Y = Z × X (right-handed).
 */
export interface BodyQuaternion {
  w: number;
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
  /** Tabulated attitude (body → ECEF), when the file supplied attitude columns. */
  attitude?: BodyQuaternion;
}

/**
 * Rule-based attitude, for tracks without tabulated attitude (e.g. a
 * trajectory reconstructed from webcast telemetry). From `timeMs` on:
 *  - "prograde":   nose along the Earth-relative velocity
 *  - "retrograde": nose against it
 *  - "vertical":   nose along local up (geodetic normal)
 *  - "aoa":        nose rotated from prograde toward local up by `aoaDeg`
 *                  in the velocity/up plane, belly (+Z) facing the flow
 *                  (belly-first re-entry ≈ aoa 60–70°)
 * Mode changes are blended over `transitionS` seconds (default 8 s).
 */
export type AttitudeMode = "prograde" | "retrograde" | "vertical" | "aoa";

export interface AttitudeRule {
  timeMs: number;
  mode: AttitudeMode;
  /** Only for "aoa". */
  aoaDeg?: number;
  transitionS?: number;
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
  /**
   * Attitude rules sorted by time (from `# attitude:` headers). Ignored when
   * the samples carry tabulated attitude. Empty → default prograde, blended
   * to vertical at low speed.
   */
  attitudeRules: AttitudeRule[];
  /**
   * 3D model: a built-in key (see the model registry in
   * `src/lib/trajectory/models.ts`) or a URL/object-URL of a .glb. Undefined →
   * marker dot only.
   */
  model?: string;
  /**
   * Upper stage riding on another vehicle (from `# mount: <until>, <offset_m>`):
   * until `untilMs` the model is drawn `offsetM` metres further along its own
   * nose axis, i.e. stacked on the lower stage that shares the same track
   * points during the joint ascent.
   */
  mount?: { untilMs: number; offsetM: number };
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
