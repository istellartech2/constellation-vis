import { DEFAULT_EARTH_MODE, normalizeEarthTextureMode, type EarthTextureMode } from "./earthTextures";
import type { SatelliteCameraMode } from "./visualization";
import { createDefaultIslSettings, DEFAULT_GSL_COLOR, DEFAULT_ISL_COLOR, type IslSettings } from "./isl/types";

/**
 * Persistence of the current "view" — camera framing plus display settings —
 * so they survive a page reload and can be saved/recalled by name. Satellite,
 * ground-station and constellation definitions (and the start time) are
 * deliberately excluded: those are owned by the settings.toml import/export
 * flow in {@link ./config}. Keeping them out is what lets you recall the same
 * framing while changing only the constellation size for comparison.
 */

// Bumped to 2 when IslSettings dropped `participantSatnums`/`shellRanges` in
// favor of stable-key participation. `migrateViewSettings`
// below is the one place old-shaped `display.isl` data gets defaulted away.
const STORAGE_VERSION = 2 as const;
const MIGRATABLE_VERSIONS = new Set<number>([1, STORAGE_VERSION]);
const LAST_VIEW_KEY = "constellation-vis:lastView";
const SAVED_VIEWS_KEY = "constellation-vis:savedViews";

/** Camera framing captured from {@link SatelliteScene}. */
export interface CameraSnapshot {
  mode: SatelliteCameraMode;
  /** free-mode camera position (Vector3 components) */
  position: [number, number, number];
  /** free-mode OrbitControls target (Vector3 components) */
  target: [number, number, number];
  earthCenterDistance: number;
  thirdPersonDistance: number;
  thirdPersonPitch: number;
}

/** Scene reference frame: inertial, Earth-fixed, or Geocentric Solar Ecliptic (Sun fixed). */
export type ViewFrame = "eci" | "ecef" | "gse";

/**
 * Apply the stored/remote `ecef` and `gse` flags to the current frame. Either
 * flag may be absent (partial updates); turning off a flag that is not the
 * active frame leaves the frame unchanged.
 */
export function nextViewFrame(prev: ViewFrame, flags: { ecef?: boolean; gse?: boolean }): ViewFrame {
  if (flags.gse) return "gse";
  if (flags.ecef) return "ecef";
  if ((flags.gse === false && prev === "gse") || (flags.ecef === false && prev === "ecef")) return "eci";
  return prev;
}

/** Every display-related setting held in App.tsx. */
export interface DisplaySettings {
  satRadius: number;
  /** Fixed dot size in CSS px (0 = world-size dots). Absent in older views. */
  satPixelSize?: number;
  /** Dim satellites in the Earth's shadow. Absent in older views. */
  satSunlitShading?: boolean;
  /** Sun-glint flashes. Absent in older views. */
  satGlint?: boolean;
  earthTexture: EarthTextureMode;
  /** Absent in views saved before borders became a setting. */
  showCountryBorders?: boolean;
  /** Absent in views saved before clouds became a setting. */
  showClouds?: boolean;
  showGraticule: boolean;
  showEcliptic: boolean;
  showGeoOrbit: boolean;
  showSunDirection: boolean;
  ecef: boolean;
  /** Sun-fixed GSE view; wins over `ecef`. Absent in views saved before it existed. */
  gse?: boolean;
  showPerturbation: boolean;
  brightEarth: boolean;
  whiteBackground: boolean;
  showGroundStationCones: boolean;
  showSatelliteFovCones: boolean;
  groundConeMinElevationDeg: number;
  groundConeDistanceKm: number;
  groundConeColor: string;
  fovConeHalfAngleDeg: number;
  fovConeColor: string;
  fovConeAlongTrackDeg: number;
  fovConeCrossTrackDeg: number;
  satelliteVisibleColor: string;
  satelliteHiddenColor: string;
  satelliteSelectedColor: string;
  speedExp: number;
  isl: IslSettings;
}

export interface ViewSettings {
  version: typeof STORAGE_VERSION;
  display: DisplaySettings;
  camera: CameraSnapshot;
}

export interface NamedView {
  id: string;
  name: string;
  settings: ViewSettings;
}

/** Read+parse a localStorage key, returning null on any failure. */
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a value to localStorage, swallowing quota/availability errors. */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage unavailable or full — non-fatal */
  }
}

/** Validate that a parsed object is a migratable-version ViewSettings. */
function isValidViewSettings(v: unknown): v is ViewSettings {
  if (!v || typeof v !== "object") return false;
  const obj = v as Partial<ViewSettings>;
  return typeof obj.version === "number" && MIGRATABLE_VERSIONS.has(obj.version) && !!obj.display && !!obj.camera;
}

/**
 * Per-version upgrade steps, keyed by the version a record was *stored as*
 * (not the version it upgrades to). `migrateViewSettings` below applies every
 * step from the stored version up to {@link STORAGE_VERSION} in order, so
 * adding a v3 migration later means adding one new entry here rather than
 * editing a monolithic shape-sniffing function.
 *
 * Only one step exists today: v1 -> v2, when `IslSettings` dropped
 * `participantSatnums`/`shellRanges` for stable-key participation
 * and — in the same pre-release branch — folded the ISL display colors
 * from top-level `display.islGslColor`/`islIslColor` into `isl.gslColor`/
 * `islColor`. `display.isl` may be absent (pre-ISL saves) or in the
 * old v1 shape; in both cases it's discarded rather than trusted, since
 * a stale participation snapshot is worse than losing it. There is
 * deliberately no "v2 record missing isl colors" step: every v2 record this
 * app has ever written already has `isl.gslColor`/`islColor`, since both
 * changes shipped in the same release.
 */
const MIGRATIONS: Record<number, (display: unknown) => unknown> = {
  1: (display) => {
    const legacyDisplay = display as DisplaySettings & { islGslColor?: string; islIslColor?: string };
    const { islGslColor, islIslColor, ...restDisplay } = legacyDisplay;
    const migratedIsl: IslSettings = {
      ...createDefaultIslSettings(),
      gslColor: islGslColor ?? DEFAULT_GSL_COLOR,
      islColor: islIslColor ?? DEFAULT_ISL_COLOR,
    };
    return { ...restDisplay, isl: migratedIsl };
  },
};

function migrateViewSettings(v: ViewSettings): ViewSettings {
  let display: unknown = v.display;
  for (let version = v.version; version < STORAGE_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (step) display = step(display);
  }
  const migrated = display as DisplaySettings;
  // Earth modes used to be stored as image paths; map those (and any mode
  // since removed) onto current ids. Not version-gated: v2 records hold both.
  migrated.earthTexture = normalizeEarthTextureMode(migrated.earthTexture) ?? DEFAULT_EARTH_MODE;
  return { version: STORAGE_VERSION, camera: v.camera, display: migrated };
}

export function loadLastView(): ViewSettings | null {
  const v = readJson<unknown>(LAST_VIEW_KEY);
  return isValidViewSettings(v) ? migrateViewSettings(v) : null;
}

export function saveLastView(view: ViewSettings): void {
  writeJson(LAST_VIEW_KEY, view);
}

export function listSavedViews(): NamedView[] {
  const v = readJson<unknown>(SAVED_VIEWS_KEY);
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (entry): entry is NamedView =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as NamedView).id === "string" &&
        typeof (entry as NamedView).name === "string" &&
        isValidViewSettings((entry as NamedView).settings),
    )
    .map((entry) => ({ ...entry, settings: migrateViewSettings(entry.settings) }));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `view-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Save the current view under a name and return the full updated list. */
export function saveNamedView(name: string, settings: ViewSettings): NamedView[] {
  const views = listSavedViews();
  const entry: NamedView = { id: newId(), name: name.trim() || "(無題)", settings };
  views.push(entry);
  writeJson(SAVED_VIEWS_KEY, views);
  return views;
}

export function deleteNamedView(id: string): NamedView[] {
  const views = listSavedViews().filter((v) => v.id !== id);
  writeJson(SAVED_VIEWS_KEY, views);
  return views;
}

export function renameView(id: string, name: string): NamedView[] {
  const views = listSavedViews().map((v) =>
    v.id === id ? { ...v, name: name.trim() || v.name } : v,
  );
  writeJson(SAVED_VIEWS_KEY, views);
  return views;
}

/** Compose a ViewSettings from current display settings and a camera snapshot. */
export function buildViewSettings(
  display: DisplaySettings,
  camera: CameraSnapshot,
): ViewSettings {
  return { version: STORAGE_VERSION, display, camera };
}
