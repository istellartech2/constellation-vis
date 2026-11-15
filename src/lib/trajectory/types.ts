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
  /**
   * Display-only trail options (no geometry rebuild when changed). Undefined:
   * faint full path + bright traversed path, Earth-fixed.
   */
  trail?: TrajectoryTrailStyle;
  /**
   * Keep the vehicle (model, marker and name label) at its last sample for
   * this long after the track ends, in ms (e.g. a ship standing on the pad
   * after a catch). Default 0: it disappears at the last sample.
   */
  holdEndMs?: number;
}

/**
 * How a track's trail is drawn (see docs/trajectory-layer.md, "Trail options").
 */
export interface TrajectoryTrailStyle {
  /** Draw the faint full path, including the part not flown yet (default true). */
  future?: boolean;
  /**
   * Bright trail limited to the last `windowMs` before the vehicle, fading to
   * transparent toward its old end. Undefined or ≤ 0: the whole traversed path.
   */
  windowMs?: number;
  /**
   * "earth" (default): the trail is Earth-fixed (a ground-relative path that
   * turns with the globe). "inertial": every point is drawn where it was in
   * inertial space, i.e. rotated back by the Earth's rotation since it was
   * flown, so an orbit is a closed ring that does not spin with the globe.
   * The vehicle itself and the newest point coincide in both frames.
   */
  frame?: "earth" | "inertial";
}

/**
 * A fixed point of interest drawn with the trajectory layer (a launch tower,
 * an estimated impact point…): a marker dot, an optional label and an
 * optional static model standing upright on the point.
 */
export interface TrajectoryLandmark {
  id: string;
  label?: string;
  latDeg: number;
  lonDeg: number;
  /** Altitude of the model base / marker above WGS84, km (default 0). */
  altKm?: number;
  /** Built-in model key (e.g. "launch-tower") or GLB URL; drawn upright. */
  model?: string;
  /** Bearing (deg from north, clockwise) the model's +Y side faces; for the tower, where the column stands. */
  headingDeg?: number;
  /** CSS colour of the dot and label (default light grey). */
  color?: string;
  /** Shown only from / until these instants (ms UTC). */
  fromMs?: number;
  untilMs?: number;
  /** Dot and label only while the camera is within this distance (km). The model follows its own pixel-size rule. */
  maxDistanceKm?: number;
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
