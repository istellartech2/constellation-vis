/**
 * Guided tours ("presentation mode"): a JSON file that walks the viewer
 * through chapters of a scenario — each chapter is a time window with a
 * caption, a playback speed and a camera — replaying tabulated trajectory
 * tracks (see docs/guided-tours.md). Pure types; no React / three.js.
 */

/**
 * A tour time: `"T+hh:mm:ss[.sss]"` / `"T-hh:mm:ss"` (also `T+mm:ss`)
 * relative to the tour epoch, a number of seconds relative to the epoch, or
 * an ISO-8601 UTC timestamp.
 */
export type TourTime = string | number;

/** A track replayed by the tour (a CSV / CCSDS OEM file, see trajectory-layer.md). */
export interface TourTrackRef {
  /** Key used by chapters (`camera.track`, `telemetry`). */
  key: string;
  /** URL relative to the app's base URL (e.g. `demos/flight15/ship.csv`) or absolute. */
  url: string;
  /** Short HUD label (e.g. "BOOSTER"); default: the key in upper case. */
  label?: string;
  /** Optional overrides of the file's `# model:` and the palette colour. */
  model?: string;
  color?: string;
  /**
   * Seconds the vehicle stays drawn at its last sample after the track ends
   * (e.g. the ship standing in the tower after the catch). Default
   * {@link DEFAULT_TOUR_HOLD_S}; 0 makes it disappear at the end.
   */
  holdS?: number;
}

/** Default end hold of tour tracks (s). */
export const DEFAULT_TOUR_HOLD_S = 30;

/**
 * A fixed point shown during the tour: a dot, a label and optionally a static
 * upright model (e.g. `"launch-tower"`).
 */
export interface TourLandmarkDef {
  key: string;
  label?: string;
  lat: number;
  lon: number;
  /** Altitude above WGS84, km (default 0). */
  altKm?: number;
  model?: string;
  /** Bearing (deg from north) of the model's +Y side; for the launch tower, where the column stands. */
  headingDeg?: number;
  color?: string;
  /** Shown from / until these tour times (default: always). */
  from?: TourTime;
  until?: TourTime;
  /** Dot and label only while the camera is within this distance (km). */
  maxDistanceKm?: number;
}

/**
 * Trail display for a chapter (see TrajectoryTrailStyle). In tours the
 * tracks other than the camera's never show their future path.
 */
export interface TourTrail {
  /** Faint full path of the camera's track (default true). */
  future?: boolean;
  /** Bright trail only over the last `windowS` seconds, fading out (default: the whole flown path). */
  windowS?: number;
  /** "earth" (default) or "inertial" (orbits drawn as fixed rings, see trajectory-layer.md). */
  frame?: "earth" | "inertial";
}

/**
 * Chapter camera.
 * - `follow`: ride with the track (side-on, Earth-fixed; the viewer can orbit/zoom).
 * - `overview`: look straight down at the track's position from close range (static).
 * - `globe`: whole-Earth view, initially looking at `track` (if given). With
 *   `chase` (default true when `track` is set) the camera keeps the track
 *   centred; turn it off at speeds where the track laps the Earth in seconds.
 *   `distance` is the camera distance from the Earth's centre in Earth radii
 *   (default: fit the globe to the screen).
 */
export type TourCamera =
  | {
      type: "follow";
      track: string;
      /** Camera distance from the target, metres (default 3 vehicle lengths). */
      distanceM?: number;
      /** Aim this many metres above the vehicle base along the local vertical (default 0). */
      targetUpM?: number;
      /** Another track key kept in frame (target = midpoint, distance grows to fit both). */
      include?: string;
      /** Easing time constant (s) when the framing changes on the same track (default 0.8; 0 = cut). */
      transitionS?: number;
    }
  | { type: "overview"; track: string }
  | {
      type: "globe";
      track?: string;
      distance?: number;
      chase?: boolean;
      /** Tilt the view from the track's position toward its orbit normal (deg, 0–85), so a ring is not seen edge-on. */
      tiltDeg?: number;
    };

/** A camera change inside a chapter (e.g. pull back after an event). */
export interface TourCameraChange {
  at: TourTime;
  camera: TourCamera;
}

/** "周回 n/total" readout for an orbiting track. */
export interface TourOrbitCounter {
  track: string;
  /** Count orbits from this time (default: the chapter start). */
  from?: TourTime;
  /** Number shown after the slash, and the cap of the count. */
  total?: number;
}

export interface TourSpeedChange {
  at: TourTime;
  speed: number;
}

export interface TourChapterDef {
  id: string;
  title: string;
  /** Plain-language caption (2–3 sentences). */
  caption: string;
  start: TourTime;
  end: TourTime;
  /** Playback speed (× real time) at the chapter start. */
  speed: number;
  /** Optional speed changes inside the chapter (e.g. slow down before an event). */
  speedChanges?: TourSpeedChange[];
  camera: TourCamera;
  /** Optional camera changes inside the chapter. */
  cameraChanges?: TourCameraChange[];
  /** Track keys shown in the telemetry HUD. */
  telemetry?: string[];
  /** Trail display in this chapter (default: full trails, Earth-fixed). */
  trail?: TourTrail;
  /** Orbit counter in the HUD. */
  orbitCounter?: TourOrbitCounter;
}

export interface TourEnding {
  title: string;
  caption: string;
  /** Camera for the end card (default: the whole globe from the current direction). */
  camera?: TourCamera;
  /** Trails on the end card; applies to every track (default: full paths). */
  trail?: TourTrail;
}

export interface TourSource {
  label: string;
  url: string;
}

/** The tour JSON file as written. */
export interface TourDefinition {
  id: string;
  title: string;
  subtitle?: string;
  /** Persistent notice (e.g. "reconstruction from public information"). */
  disclaimer?: string;
  /** Caption above the T± clock in the HUD (default 「基準時刻から」, e.g. 「打上げから」). */
  clockLabel?: string;
  /** Small note under the telemetry values (e.g. 「速度・高度は推定」). */
  telemetryNote?: string;
  /** T0 (ISO). Default: the first track's `# epoch:`. */
  epoch?: string;
  tracks: TourTrackRef[];
  /** Fixed points (launch tower, impact point…). */
  landmarks?: TourLandmarkDef[];
  chapters: TourChapterDef[];
  /** End card shown after the last chapter. */
  ending?: TourEnding;
  sources?: TourSource[];
}

export interface ResolvedSpeedChange {
  atMs: number;
  speed: number;
}

export interface ResolvedCameraChange {
  atMs: number;
  camera: TourCamera;
}

export interface ResolvedChapter
  extends Omit<TourChapterDef, "start" | "end" | "speedChanges" | "telemetry" | "cameraChanges" | "orbitCounter"> {
  startMs: number;
  endMs: number;
  /** Sorted by time, all inside (startMs, endMs). */
  speedChanges: ResolvedSpeedChange[];
  /** Sorted by time, all inside (startMs, endMs). */
  cameraChanges: ResolvedCameraChange[];
  telemetry: string[];
  orbitCounter: { track: string; fromMs: number; total?: number } | null;
}

export interface ResolvedLandmark extends Omit<TourLandmarkDef, "from" | "until"> {
  fromMs?: number;
  untilMs?: number;
}

/** A tour with every time resolved to absolute UTC ms. */
export interface ResolvedTour extends Omit<TourDefinition, "chapters" | "landmarks"> {
  epochMs: number;
  chapters: ResolvedChapter[];
  landmarks: ResolvedLandmark[];
}

/** One entry of `public/demos/index.json`. */
export interface DemoEntry {
  id: string;
  title: string;
  description?: string;
  /** Tour JSON URL relative to the app's base URL. */
  tour: string;
}

export type TourResult<T> = { ok: true; value: T } | { ok: false; error: string };
