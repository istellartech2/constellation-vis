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
  | { type: "follow"; track: string }
  | { type: "overview"; track: string }
  | { type: "globe"; track?: string; distance?: number; chase?: boolean };

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
  /** Track keys shown in the telemetry HUD. */
  telemetry?: string[];
}

export interface TourEnding {
  title: string;
  caption: string;
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
  /** T0 (ISO). Default: the first track's `# epoch:`. */
  epoch?: string;
  tracks: TourTrackRef[];
  chapters: TourChapterDef[];
  /** End card shown after the last chapter. */
  ending?: TourEnding;
  sources?: TourSource[];
}

export interface ResolvedSpeedChange {
  atMs: number;
  speed: number;
}

export interface ResolvedChapter extends Omit<TourChapterDef, "start" | "end" | "speedChanges" | "telemetry"> {
  startMs: number;
  endMs: number;
  /** Sorted by time, all inside (startMs, endMs). */
  speedChanges: ResolvedSpeedChange[];
  telemetry: string[];
}

/** A tour with every time resolved to absolute UTC ms. */
export interface ResolvedTour extends Omit<TourDefinition, "chapters"> {
  epochMs: number;
  chapters: ResolvedChapter[];
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
