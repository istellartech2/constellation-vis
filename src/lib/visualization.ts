import { propagateAtJulianDate } from "./propagation";
import { SimulationClock } from "./simulationClock";
// High-level wrapper around the Three.js scene used by the visualizer.
// Moved from useSatelliteScene for better organization.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { toSatrec } from "./satellites";
import type { SatelliteSpec } from "./satellites";
import { catalogFromSpecs, type SatelliteCatalog } from "./satelliteCatalog";
import {
  MASS_FOCUS_LIMIT,
  MassSatelliteLayer,
  isMassMode,
  stationSeesPoint,
  type MassPickHit,
  type MassStation,
} from "./massSatelliteLayer";
import type { CatalogLayerStyle, LayerColorMode } from "./catalogLayers";
import type { GroundStation } from "./groundStations";
import {
  sunVectorECI,
  OBLIQUITY,
  createGraticule,
  createEclipticLine,
  createGeoOrbitLine,
  EARTH_FLATTENING,
} from "./astronomy";
import { KMLRenderer } from "./kmlRenderer";
import {
  freeCameraNear,
  freeCameraZoomSpeed,
  groundClearanceScale,
  heightAboveGlobe,
  rideMinHeight,
} from "./cameraClearance";
import { EARTH_ROTATION_RAD_S, TrajectoryRenderer, type SatelliteVehicleState } from "./trajectory/renderer";
import type { TrajectoryLandmark, TrajectoryTrack } from "./trajectory/types";
import {
  POINT_STYLE_FRAGMENT_PARS,
  POINT_STYLE_VERTEX_PARS,
  PIXEL_DOT_ALPHA,
  applyPointStyle,
  createPointStyleUniforms,
  type PointStyleUniforms,
  type SatellitePointStyle,
} from "./satellitePointStyle";
import { loadKMLFromURL } from "./kml";
import {
  boresightPointsAtEarth,
  computeConeHeightForBoresight,
  computeFovConeQuaternion,
  computeTiltedConeHeight,
} from "./orbitalCoordinates";
import {
  isPlainLvlhAttitude,
  isPlainLvlhContext,
  prepareAttitudeContext,
  satelliteAttitudeFromContext,
  sensorBoresightEci,
  solarArrayIncidence,
  type AttitudeStateProvider,
  type AttitudeTimeContext,
} from "./attitude/satelliteAttitude";
import {
  DEFAULT_SATELLITE_ATTITUDE,
  DEFAULT_SOLAR_ARRAY_TYPE,
  type AttitudeQuaternion,
  type SatelliteAttitudeSettings,
  type SolarArrayType,
} from "./attitude/types";
import { attitudeSettingsKey, resolveSatelliteAttitude } from "./attitude/resolve";
import { bodyToWorldQuaternion } from "./trajectory/models";
import {
  DARK_MONOCHROME_EARTH_MODE,
  EARTH_ASSETS,
  PAPER_ATLAS_EARTH_MODE,
  earthTextureBudget,
  isLayeredEarthMode,
  resolveLayeredEarthAssets,
  resolveProgressiveTexture,
  type EarthTextureMode,
  type ProgressiveTexture,
} from "./earthTextures";
import {
  hasLostEarthContext,
  hideBootSplash,
  isMemoryConstrainedDevice,
  loadEarthImage,
  nextFrame,
  noteEarthContextLost,
  prefersReducedData,
  setBootSplashStatus,
  whenIdle,
} from "./earthTextureLoader";
import { isFiniteCameraSnapshot, type CameraSnapshot, type ViewFrame } from "./viewState";
import { LaunchSiteImageryLayer, type LaunchSiteImageryCredit } from "./launchSiteImagery";
import type { IslEndpoint, IslPathResult, IslSettings, IslShellRange } from "./isl/types";
import { pathEdgeKeys } from "./isl/edgeKey";
import { endpointEci, endpointObserver, type Vec3 } from "./isl/geometry";
import {
  buildIslWorkerSettingsPayload,
  type IslRoutingWorkerComputeRequest,
  type IslRoutingWorkerConfigureRequest,
  type IslRoutingWorkerInitRequest,
  type IslRoutingWorkerResponse,
} from "../workers/islRoutingWorker.types";

/** Equatorial and polar radii of Earth in kilometres. */
const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

/** Geostationary orbit radius (from Earth's centre) in kilometres. */
const GEO_RADIUS_KM = 42164;

/** Sim-time spacing of ground-track samples. */
const GROUND_TRACK_STEP_MS = 30_000;
/** Maximum number of ground-track samples kept in memory. */
const MAX_GROUND_TRACK_POINTS = 288_000; // 100 days at 30 s intervals
const INITIAL_GROUND_TRACK_CAPACITY = 4096;
/** Ground-track height above the surface, lifted slightly to avoid z-fighting. */
const GROUND_TRACK_HEIGHT_KM = EARTH_RADIUS_EQUATOR_KM * 0.001;

const STATION_CONE_SEGMENTS = 32;

/**
 * Unit-height cone (apex at the station, scaled to `heightNorm` by the mesh)
 * opening down to `minElevationDeg` — the same elevation that colours
 * satellites visible/hidden and limits ISL ground links.
 */
function stationConeGeometry(minElevationDeg: number, heightNorm: number): THREE.ConeGeometry {
  const minEl = THREE.MathUtils.clamp(minElevationDeg, 0, 89.9);
  const baseRadius = heightNorm * Math.tan(THREE.MathUtils.degToRad(90 - minEl));
  const geo = new THREE.ConeGeometry(baseRadius, 1, STATION_CONE_SEGMENTS, 1, true);
  geo.translate(0, -0.5, 0);
  return geo;
}
const FOV_CONE_SEGMENTS = 32;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const POINTER_DRAG_THRESHOLD_PX = 5;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 3);

/**
 * Window aspect ratio, or `fallback` while the window has no size (a hidden
 * tab or pane reports 0×0). 0/0 would make the camera — and the saved view —
 * NaN.
 */
function windowAspect(fallback = 1): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return w > 0 && h > 0 ? w / h : fallback;
}
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const FOLLOW_MIN_DISTANCE = 0.12;
const FOLLOW_MAX_DISTANCE = 1.8;
const THIRDPERSON_DEFAULT_PITCH = THREE.MathUtils.degToRad(22);
const THIRDPERSON_MIN_PITCH = THREE.MathUtils.degToRad(-70);
const THIRDPERSON_MAX_PITCH = THREE.MathUtils.degToRad(82);
const FOLLOW_LERP_ALPHA = 0.14;

/** Scene units (Earth equatorial radii) per metre. */
const SCENE_UNITS_PER_M = 1 / 6_378_137;
/** Free camera: closest approach to the Earth's centre (≈60 km above the equator, ≈80 km above the poles). */
const FREE_CAMERA_MIN_DISTANCE = 1 + 60 / EARTH_RADIUS_EQUATOR_KM;
/** Free and satellite-follow cameras: minimum height above the drawn globe (1 km). */
const FREE_CAMERA_MIN_HEIGHT = 1 / EARTH_RADIUS_EQUATOR_KM;
/** Trajectory follow: closest zoom as a fraction of the vehicle length. */
const TRAJECTORY_FOLLOW_MIN_LENGTHS = 0.6;
/** Trajectory follow: initial distance in vehicle lengths. */
const TRAJECTORY_FOLLOW_START_LENGTHS = 3;
/** Trajectory follow: farthest zoom, enough for a ~2000 km regional overview. */
const TRAJECTORY_FOLLOW_MAX_DISTANCE = 2_500_000 * SCENE_UNITS_PER_M;
/** Initial camera elevation above the local horizon, seen from the side. */
const TRAJECTORY_FOLLOW_START_ELEVATION = THREE.MathUtils.degToRad(12);
/** Satellite 近接: farthest zoom (a regional view of the ground below). */
const SATELLITE_FOLLOW_MAX_DISTANCE = 2_000_000 * SCENE_UNITS_PER_M;
/** Satellite 近接: initial camera direction, behind (−along-track) and above, a little to the side. */
const SATELLITE_FOLLOW_START_ELEVATION = THREE.MathUtils.degToRad(25);
const SATELLITE_FOLLOW_START_AZIMUTH = THREE.MathUtils.degToRad(35);
/** Frames the selected dot stays hidden on entering 近接 while the model loads / is first measured (~0.5 s). */
const CLOSE_UP_DOT_GRACE_FRAMES = 30;
/** Default model drawn for editor satellites in the 近接 camera (標準バス). */
const DEFAULT_SATELLITE_MODEL = "satellite-bus";
/** 近接: half-width of the dense orbit segment around the ridden satellite. */
const CLOSE_UP_ORBIT_WINDOW_MS = 15 * 60_000;
/** Vertex capacity of the dense segment (~90 are used). */
const CLOSE_UP_ORBIT_MAX_POINTS = 256;
/** FOV cones whose boresight misses the Earth: grey, fainter. */
const FOV_CONE_MISS_COLOR = 0x9aa0a6;
const FOV_CONE_OPACITY = 0.16;
const FOV_CONE_MISS_OPACITY = 0.08;
/**
 * Dashed boresight drawn along each grey cone (same length as the cone), so a
 * sensor that does not look at the Earth reads as "pointing elsewhere" even
 * on the black sky where the faint grey cone almost disappears. Dash and gap
 * in Earth radii (~45 km / ~30 km).
 */
const FOV_MISS_BORESIGHT_OPACITY = 0.75;
const FOV_MISS_BORESIGHT_DASH = 0.007;
const FOV_MISS_BORESIGHT_GAP = 0.0047;
/** Below ~5 m/s of horizontal speed the flight direction is taken from the track ahead. */
const TRAJECTORY_FOLLOW_MIN_HORIZONTAL_SPEED_SQ = (5 * SCENE_UNITS_PER_M) ** 2;
const TRAJECTORY_FOLLOW_ZOOM_SPEED = 3;
/** Main-camera near plane outside the trajectory follow (Earth radii). */
const DEFAULT_CAMERA_NEAR = 0.1;
/** Cloud shell radius (createEarthClouds); hidden while the follow camera is below it. */
const CLOUD_SHELL_SCALE = 1.008;
/** Thin shells drawn on the globe (borders 1.0005, night lights 1.001); depth-biased while following. */
const SURFACE_SHELL_MAX_SCALE = 1.002;
/**
 * Globe sphere segments (width × height) while riding close to the ground.
 * The standard 128 × 128 sphere's facets sag up to ~1.9 km below the true
 * surface (chord sag R(1 − cos(π/128)) along a parallel), so a vehicle on
 * the pad appears to hover. 512 × 256 (equal angular spacing in both
 * directions) cuts that to ~0.12 km; 384 × 192 (~0.21 km) on memory-
 * constrained devices.
 */
const EARTH_DETAIL_SEGMENTS: readonly [number, number] = [512, 256];
const EARTH_DETAIL_SEGMENTS_CONSTRAINED: readonly [number, number] = [384, 192];
/** Swap to the detailed globe below this camera altitude while riding (Earth radii), back above the second (hysteresis). */
const EARTH_DETAIL_ENTER_ALTITUDE = 300 / EARTH_RADIUS_EQUATOR_KM;
const EARTH_DETAIL_EXIT_ALTITUDE = 350 / EARTH_RADIUS_EQUATOR_KM;
/**
 * FOV cones follow the slew limit (最大レート) only up to this many editor
 * satellites: each slewing cone scans its own past states (~20–30
 * propagations per frame). Above it cones switch instantly; the 近接 model
 * always slews.
 */
const CONE_SLEW_MAX_SATELLITES = 64;
/** While riding, ground-station markers and cones closer than this to the camera are hidden (Earth radii). */
const RIDE_STATION_HIDE_DISTANCE = 200 / EARTH_RADIUS_EQUATOR_KM;

/** Pre-allocated capacity for the ISL path LineSegments geometry. */
const ISL_PATH_INITIAL_SEGMENTS = 64;
const ISL_RECOMPUTE_MIN_REAL_MS = 200;

/** Pick radius around the pointer, in CSS pixels (bigger for touch). */
const PICK_RADIUS_MOUSE_PX = 12;
const PICK_RADIUS_TOUCH_PX = 22;

/**
 * Indexes of the screen points within `radiusPx` of (`x`, `y`), nearest
 * first. Points set to `null` (behind the camera / occluded) are skipped.
 */
export function screenSpaceHits(
  points: ({ x: number; y: number } | null)[],
  x: number,
  y: number,
  radiusPx: number,
): number[] {
  return screenSpaceHitDistances(points, x, y, radiusPx).map((h) => h.index);
}

/** {@link screenSpaceHits} with each hit's distance from the pointer. */
export function screenSpaceHitDistances(
  points: ({ x: number; y: number } | null)[],
  x: number,
  y: number,
  radiusPx: number,
): MassPickHit[] {
  const hits: MassPickHit[] = [];
  points.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= radiusPx) hits.push({ index: i, distance: d });
  });
  return hits.sort((a, b) => a.distance - b.distance);
}

/**
 * Merge editor-satellite hits with catalog-overlay hits (local row indexes,
 * shifted by `catalogOffset` = editor satellite count into global indexes),
 * nearest first.
 */
export function mergePickHits(editorHits: readonly MassPickHit[], catalogHits: readonly MassPickHit[], catalogOffset: number): number[] {
  return [
    ...editorHits,
    ...catalogHits.map((h) => ({ index: h.index + catalogOffset, distance: h.distance })),
  ].sort((a, b) => a.distance - b.distance).map((h) => h.index);
}

export function pickSatelliteHitIndex(
  hitIndexes: number[],
  selectedIndex: number | null,
): number | null {
  if (hitIndexes.length === 0) return null;
  if (selectedIndex === null) return hitIndexes[0] ?? null;
  const selectedHitPos = hitIndexes.indexOf(selectedIndex);
  if (selectedHitPos === -1) return hitIndexes[0] ?? null;
  return hitIndexes[(selectedHitPos + 1) % hitIndexes.length] ?? null;
}

type EarthAnimationBinding = {
  sunDirectionUniform?: THREE.Vector3;
};

type Rgba = readonly [number, number, number, number];

/** Placeholder colors shown until each earth image has loaded. */
const NO_DATA: Rgba = [0, 0, 0, 0];
const ALL_WATER: Rgba = [255, 255, 255, 255];
/** Share of the day map kept visible on the night side (before the per-map `night` factor). */
const NIGHT_LIFT = 0.12;
const DEEP_OCEAN: Rgba = [10, 26, 56, 255];

/**
 * Returns a placeholder texture at once and calls `apply` with each loaded
 * image (the small one, then the large one if there is an upgrade).
 */
type ProgressiveTextureLoader = (
  source: ProgressiveTexture,
  apply: (texture: THREE.Texture) => void,
  colorSpace?: THREE.ColorSpace,
  fallback?: Rgba,
) => THREE.Texture;

type TextureLoaderFn = (
  path: string,
  apply: (texture: THREE.Texture) => void,
  colorSpace?: THREE.ColorSpace,
  fallback?: Rgba,
) => THREE.Texture;

/**
 * Satellite camera modes of the info card (全体／地球中心／後方追跡／近接).
 * "closeUp" (近接) rides rigidly with the selected editor satellite in its
 * LVLH frame and draws its 3D model; it is never persisted — snapshots report
 * the free framing to return to, like the trajectory follow.
 */
export type SatelliteCameraMode = "free" | "earthCenter" | "thirdPerson" | "closeUp";

/** What the ride-along camera follows: a trajectory track (追従) or the selected satellite (近接). */
export type RideSubject = { kind: "trajectory"; id: string } | { kind: "satellite" };

/**
 * The user's orbit offset around a ride subject, carried across a scene
 * rebuild (useSatelliteScene) so the camera is not re-framed side-on.
 * Holder-local: Earth-fixed for a trajectory, the satellite's LVLH for 近接.
 */
export interface RideOffsetSnapshot {
  subject: RideSubject;
  /** Camera − orbit target, scene units. */
  offset: [number, number, number];
  /** Local vertical at the subject when captured (unit). */
  up: [number, number, number];
}

function sameRideSubject(a: RideSubject, b: RideSubject): boolean {
  return a.kind === b.kind && (a.kind !== "trajectory" || a.id === (b as { id: string }).id);
}

export interface SatelliteSceneParams {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  /**
   * Merged catalog of every display layer (CelesTrak groups, TLE/OMM files,
   * filings, synthetic sets), hidden layers included so indexes never shift.
   * Row r has the global satellite index `satellites.length + r`. Always
   * drawn by a separate GPU J2 overlay, display-only: never part of link
   * lines, FOV cones, the focus scan or ISL. Swapped live via
   * {@link SatelliteScene.setCatalog}, without a scene rebuild.
   */
  catalog?: SatelliteCatalog | null;
  /** Per-layer count/colour/visibility in merged order (counts sum to `catalog.count`). Applied live. Default []. */
  catalogStyles?: CatalogLayerStyle[];
  /** Overlay dot colouring: per layer, or by ground-station visibility. Applied live. Default "layer". */
  layerColorMode?: LayerColorMode;
  /**
   * Tabulated trajectory tracks (launch vehicles etc.), replayed against the
   * sim clock. Swapped live via {@link SatelliteScene.setTrajectories}.
   */
  trajectories?: TrajectoryTrack[];
  /**
   * Trajectory track the camera rides with (see
   * {@link SatelliteScene.setTrajectoryFollow}), or null/undefined for none.
   * Read at construction and applied live by useSatelliteScene.
   */
  trajectoryFollowId?: string | null;
  /**
   * Fired when the scene drops the trajectory follow on its own (track
   * removed or hidden, a satellite camera mode selected, a saved view applied
   * in a satellite mode). Not fired for an explicit setTrajectoryFollow(null).
   */
  onTrajectoryFollowEnd?: () => void;
  /**
   * Fixed points drawn with the trajectory layer (launch tower, impact
   * point…). Swapped live via {@link SatelliteScene.setTrajectoryLandmarks}.
   */
  trajectoryLandmarks?: TrajectoryLandmark[];
  /**
   * Presentation mode (guided tours), applied live: everything that belongs
   * to the scenario — editor satellites and their orbit / ground-track lines
   * and cones, display layers, ground stations and their cones, link and ISL
   * lines, KML overlays — is left out of the render and of picking, and the
   * free camera uses the inertial (ECI) frame whatever `viewFrame` says.
   * Only the globe, its overlays (graticule, ecliptic, GEO ring, Sun) and
   * the trajectory layer are drawn.
   */
  presentation?: boolean;
  /**
   * Fired when the scene leaves the 近接 (closeUp) camera on its own (no
   * selected editor satellite, propagation failed); the scene is then in
   * "free". Not fired for setCameraMode.
   */
  onCloseUpEnd?: () => void;
  /**
   * Construction only: orbit offset to resume when the scene starts the same
   * ride (trajectory follow or 近接) it was captured from
   * ({@link SatelliteScene.getRideOffset}); otherwise ignored.
   */
  initialRideOffset?: RideOffsetSnapshot | null;
  /** Attitude law of the editor satellites (FOV cones, 近接 model). Applied live. Default 地球指向. */
  satelliteAttitude?: SatelliteAttitudeSettings;
  /** Solar array type of the 近接 model (1軸追尾 turns the wings). Applied live. Default fixed. */
  solarArrayType?: SolarArrayType;
  /**
   * Model of the editor satellites in the 近接 camera: "satellite-bus" (標準バス,
   * default) or `library:<id>` (already resolved by the caller to an existing
   * library model). Applied live.
   */
  satelliteModel?: string;
  /** 近接 camera overlays: body X/Y/Z triad and the Sun direction seen from the satellite. Applied live. */
  showBodyAxes?: boolean;
  showBodySunDirection?: boolean;
  groundStations: GroundStation[];
  satRadius: number;
  /** Fixed-pixel dots, shadow dimming and glint for every satellite renderer. Applied live. */
  pointStyle: SatellitePointStyle;
  earthTexture: EarthTextureMode;
  showCountryBorders: boolean;
  /** Decorative procedural clouds; only image-based globes draw them. */
  showClouds: boolean;
  showGraticule: boolean;
  showEcliptic: boolean;
  showGeoOrbit: boolean;
  showSunDirection: boolean;
  showGroundStationCones: boolean;
  showSatelliteFovCones: boolean;
  /** Drawn ground-cone length in Earth radii; each cone opens at its station's own minimum elevation. */
  groundConeLength: number;
  groundConeColor: string;
  fovConeHalfAngleDeg: number;
  fovConeColor: string;
  fovConeMinHeight: number;
  /** FOV cone along-track angle offset in degrees (-60 to +60) */
  fovConeAlongTrackDeg: number;
  /** FOV cone cross-track angle offset in degrees (-60 to +60) */
  fovConeCrossTrackDeg: number;
  satelliteVisibleColor: string;
  satelliteHiddenColor: string;
  satelliteSelectedColor: string;
  cameraMode: SatelliteCameraMode;
  /** Free-camera frame: ECI (still), ECEF (turns with the Earth) or GSE (turns with the Sun). */
  viewFrame: ViewFrame;
  /** Show bright earth (uniform lighting) */
  brightEarth: boolean;
  /** Use a white background instead of the default dark space background */
  whiteBackground?: boolean;
  onSelect?: (idx: number | null) => void;
  onSelectStation?: (idx: number | null) => void;
  onSimTimeChange?: (date: Date) => void;
  stationInfoRef?: React.RefObject<HTMLPreElement | null>;
  /** Fired with the latest framing when the user finishes a camera manipulation or the mode changes. */
  onCameraChange?: (snapshot: CameraSnapshot) => void;
  /** ISL routing settings; enabled:false (or endpoints unset) fully disables computation & rendering. */
  islSettings: IslSettings;
  /**
   * Shell index ranges for the current `satellites` array, computed once at
   * the same time (Update click) that produced it — never a stale snapshot.
   * Empty when the constellation has no shells.
   */
  islShellRanges: IslShellRange[];
  /** Fired whenever the ISL path result is (re)computed, and with null when disabled. */
  onIslResult?: (result: IslPathResult | null) => void;
  /** Fired with a user-facing message when the routing worker reports an error, and null once cleared. */
  onIslError?: (message: string | null) => void;
  /**
   * Fired with the imagery credit when a launch-site imagery patch is first
   * drawn, and with null when none is drawn any more (also on dispose).
   * Read from the params the scene was built with; should be stable.
   */
  onLaunchSiteImageryCredit?: (credit: LaunchSiteImageryCredit | null) => void;
}

/**
 * The Three.js scene. Two independent satellite sets are drawn:
 *   - editor satellites (`params.satellites`, global indexes 0..satCount-1):
 *     exact SGP4 on the CPU, or the GPU {@link MassSatelliteLayer} once their
 *     own count exceeds `MASS_MODE_THRESHOLD`. Only these get link lines, FOV
 *     cones, the focus scan and ISL. Changing them rebuilds the scene.
 *   - catalog layers (`params.catalog`, global index satCount + row): a
 *     display-only GPU J2 overlay at any count, swapped live by
 *     {@link setCatalog} and styled live (per-layer colour/visibility,
 *     colour mode) through {@link updateParams} — never a rebuild.
 * Picking, selection, the orbit line, ground track and follow camera work
 * across both by routing global indexes to the right propagator.
 */
export default class SatelliteScene {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly cameraHolder: THREE.Group;
  private readonly disposeFns: (() => void)[] = [];

  /** SGP4 records for every editor satellite in CPU mode; empty in mass mode. */
  private readonly satRecs: satellite.SatRec[];
  /**
   * Editor satellite count (`params.satellites.length`). Catalog rows are
   * NOT included: they never get CPU per-satellite buffers. Global indexes
   * at or above it address catalog rows (`index - satCount`).
   */
  private readonly satCount: number;
  /** GPU layer drawing every editor satellite when `satCount` exceeds the mass-mode threshold. */
  private readonly massLayer: MassSatelliteLayer | null;
  /** GPU J2 overlay drawing the catalog layers (any count); replaced by {@link setCatalog}. */
  private catalogLayer: MassSatelliteLayer | null = null;
  private catalog: SatelliteCatalog | null = null;
  private readonly satPosAttr: THREE.BufferAttribute;
  private readonly satColorAttr: THREE.BufferAttribute;
  private readonly groundPosAttr: THREE.BufferAttribute;
  private readonly stationMeshes: THREE.Mesh[];
  private readonly stationConeGeometries: THREE.ConeGeometry[];
  private readonly stationConeMaterials: THREE.MeshBasicMaterial[];
  private readonly stationConeMeshes: THREE.Mesh[];
  private readonly groundConeColor: THREE.Color;
  /** All satellite–station links in one draw call (2 vertices per visible pair). */
  private readonly linkGeometry: THREE.BufferGeometry;
  private linkPositions = new Float32Array(0);
  private linkCount = 0;
  private readonly linkSegments: THREE.LineSegments;
  /** Shared by the CPU point cloud and both GPU layers. */
  private readonly pointStyleUniforms: PointStyleUniforms;
  /** CPU point cloud only: selected row, so the style keeps it unshaded and large. */
  private readonly cpuSelectedUniform = { value: -1 };
  private readonly earthGroup: THREE.Group;
  private readonly earthResourceDisposers: (() => void)[];
  private readonly earthAnimationBindings: EarthAnimationBinding[];
  private readonly setCountryBordersVisible: (visible: boolean) => void;
  private readonly setCloudsVisible: (visible: boolean) => void;
  /** Swap the globe to the high-segment sphere (close rides) or back. */
  private readonly setEarthDetailed: (on: boolean) => void;
  private earthDetailed = false;
  /** High-resolution patches around launch sites (image-based globes only), loaded when the camera comes down close. */
  private readonly launchSiteImagery: LaunchSiteImageryLayer | null;
  /** Whether some station marker is hidden because it is near the ride camera. */
  private rideStationsHidden = false;
  private readonly graticule: THREE.LineSegments;
  private readonly ecliptic: THREE.Line;
  private readonly geoOrbit: THREE.Line;
  private readonly sunDot: THREE.Mesh;
  private readonly sunlight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly kmlRenderer: KMLRenderer;
  private readonly trajectoryRenderer: TrajectoryRenderer;

  private selectedIndex: number | null = null;
  private selectedStationIndex: number | null = null;
  private orbitLine: THREE.Line | null = null;
  /** Sim time (ms) of each vertex of the global orbit line (one minute apart). */
  private orbitLineTimes: number[] = [];
  /**
   * 近接: dense orbit segment around the ridden satellite (see
   * updateCloseUpOrbit), re-based at {@link renderOrigin}; it replaces the
   * global line's chords within ±CLOSE_UP_ORBIT_WINDOW_MS.
   */
  private closeUpOrbit: THREE.Line | null = null;
  /**
   * World origin of the overlays that are drawn around the ridden satellite
   * in 近接 (FOV cones, station links, ISL path, close-up orbit): the
   * selected satellite's position, else (0, 0, 0). Their vertices / instance
   * translations are written relative to it (float64 subtraction), and the
   * objects sit at it, so three.js forms model-view matrices in float64 and
   * nothing near the satellite is quantised to float32 at |r| ≈ 1 (~0.5 m).
   */
  private readonly renderOrigin = new THREE.Vector3();
  private readonly originScratch = new THREE.Vector3();
  /**
   * Trail of the selected satellite's sub-satellite point. Vertices are stored
   * Earth-fixed and the line is rotated with the Earth each frame, so past
   * samples never need re-projecting; only the live tip vertex moves.
   */
  private groundTrackLine: THREE.Line | null = null;
  private groundTrackPositions = new Float32Array(0);
  private groundTrackCount = 0;
  private groundTrackNextSampleMs = 0;
  private currentSimDate: Date;
  private animationFrameId: number | null = null;

  // Store references for proper disposal
  private satGeometry: THREE.BufferGeometry;
  private satMaterial: THREE.PointsMaterial;
  private groundGeometry: THREE.BufferGeometry;
  private groundMaterial: THREE.PointsMaterial;
  private stationGeo: THREE.SphereGeometry;
  private stationMat: THREE.MeshBasicMaterial;
  private fovConeGeometry: THREE.ConeGeometry;
  private fovConeMaterial: THREE.MeshBasicMaterial;
  /** One instance per drawn FOV cone (every satellite in CPU mode, the focus subset in mass mode). */
  private readonly fovCones: THREE.InstancedMesh;
  private fovConeCount = 0;
  /** Cones whose boresight misses the Earth (non-地球指向 attitudes): grey, fainter; shares the geometry. */
  private readonly fovMissMaterial: THREE.MeshBasicMaterial;
  private readonly fovMissCones: THREE.InstancedMesh;
  private fovMissCount = 0;
  /** Dashed boresight line per grey cone (2 vertices each, filled in pushAttitudeFovCone). */
  private readonly fovMissBoresightGeometry: THREE.BufferGeometry;
  private readonly fovMissBoresightPositions: Float32Array;
  private readonly fovMissBoresightDistances: Float32Array;
  private readonly fovMissBoresightMaterial: THREE.LineDashedMaterial;
  private readonly fovMissBoresights: THREE.LineSegments;
  /**
   * Editor satellites' resolved attitude (global setting + shell/satellite
   * overrides, attitude/resolve.ts), bucketed by equal settings. Rebuilt
   * when the global setting object changes; the satellites themselves only
   * change with a scene rebuild.
   */
  private attitudeGroupsGlobal: SatelliteAttitudeSettings | null = null;
  private attitudeGroups: SatelliteAttitudeSettings[] = [];
  /** Group of each editor satellite; null: every satellite is in group 0 (no overrides). */
  private satAttitudeGroup: Uint32Array | null = null;
  /** This frame's attitude context per group for the cones (null entry: 地球指向, today's code path). */
  private frameAttitudes: (AttitudeTimeContext | null)[] = [];
  /** Past-state lookups of editor satellites for the slew limit, by index (created on demand). */
  private readonly attitudeStateProviders = new Map<number, AttitudeStateProvider>();
  private readonly attitudeQuat: AttitudeQuaternion = { w: 1, x: 0, y: 0, z: 0 };
  private readonly fovConeColor: THREE.Color;
  private readonly satelliteVisibleColor: THREE.Color;
  private readonly satelliteHiddenColor: THREE.Color;
  private readonly satelliteSelectedColor: THREE.Color;
  private readonly fovConeMinHeight: number;
  private linkMaterial: THREE.LineBasicMaterial;

  private readonly islPathGeometry: THREE.BufferGeometry;
  // Reassigned (not readonly) by ensureIslPathCapacity when a path exceeds the
  // current buffer capacity — reallocated on demand (default capacity 64
  // segments) rather than clamped.
  private islPathPosAttr: THREE.BufferAttribute;
  private islPathColorAttr: THREE.BufferAttribute;
  private islPathCapacitySegments = ISL_PATH_INITIAL_SEGMENTS;
  // Scratch vectors reused every frame by applyIslPathToScene — avoids
  // allocating 2 THREE.Vector3 per path segment at up to 60fps.
  private readonly islScratchFrom = new THREE.Vector3();
  private readonly islScratchTo = new THREE.Vector3();
  private readonly islPathLines: THREE.LineSegments;
  private readonly islPathMaterial: THREE.LineBasicMaterial;
  private readonly islEndpointGeo: THREE.SphereGeometry;
  private readonly islEndpointMatA: THREE.MeshBasicMaterial;
  private readonly islEndpointMatB: THREE.MeshBasicMaterial;
  private readonly islEndpointMeshA: THREE.Mesh;
  private readonly islEndpointMeshB: THREE.Mesh;
  private satEciPositions: Vec3[] = [];
  private islLastResult: IslPathResult | null = null;
  private islLastRecomputeSimMs: number | null = null;
  private islLastRecomputeRealMs = 0;
  private islForceRecompute = true;
  private islPreviousPathEdgeKeys: number[] | null = null;
  private readonly islGslColor: THREE.Color;
  private readonly islIslColor: THREE.Color;
  private islGslColorHex: string;
  private islIslColorHex: string;
  /**
   * The path result whose colors are currently baked into
   * `islPathColorAttr`, and whether a color-setting change since then still
   * needs to be applied. `applyIslPathToScene` runs every frame (positions
   * move continuously), but the color buffer only actually needs rewriting
   * when the result reference changes (a new compute) or the ISL/GSL color
   * setting changes — previously it was rewritten and re-uploaded to the GPU
   * unconditionally every frame.
   */
  private islColorsAppliedFor: IslPathResult | null = null;
  private islColorsDirty = true;
  /**
   * Offloads ISL candidate generation + Dijkstra to a worker thread.
   * Lazily created on first enable via {@link ensureIslWorker}.
   */
  private islWorker: Worker | null = null;
  private islWorkerRequestId = 0;
  private islComputeInFlight = false;
  /** Identity of the settings last sent via "configure" — reference equality is enough. */
  private islLastConfiguredSettings: IslSettings | null = null;
  private islLastConfiguredShellRanges: IslShellRange[] | null = null;

  private readonly simulationClock: SimulationClock;
  private lastSimTimeNotificationMs: number | null = null;
  private pointerDownActive = false;
  private pointerDownId: number | null = null;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private didDragDuringPointer = false;
  private readonly followPosition = new THREE.Vector3();
  private readonly followTarget = new THREE.Vector3();
  private readonly followUp = new THREE.Vector3(0, 1, 0);
  private readonly followBasis = new THREE.Vector3(0, 0, 1);
  private readonly tempVectorA = new THREE.Vector3();
  private readonly tempVectorB = new THREE.Vector3();
  private readonly tempVectorC = new THREE.Vector3();
  private readonly tempVectorD = new THREE.Vector3();
  private readonly tempQuaternionA = new THREE.Quaternion();
  private readonly tempQuaternionB = new THREE.Quaternion();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly cachedSelectedPosition = new THREE.Vector3();
  private readonly cachedSelectedVelocity = new THREE.Vector3();
  private hasCachedSelection = false;
  private hasCachedVelocity = false;
  private earthCenterDistance = 0.45;
  private thirdPersonDistance = 0.4;
  private thirdPersonPitch = THIRDPERSON_DEFAULT_PITCH;
  private cameraMode: SatelliteCameraMode;

  // --- Ride-along camera: trajectory 追従 (setTrajectoryFollow) or satellite 近接 (closeUp) ---
  private ride: RideSubject | null = null;
  /** Free-camera framing to restore when the ride ends; also what saved views see meanwhile. */
  private rideReturn: CameraSnapshot | null = null;
  /** Frame the subject from scratch on the next ridden frame. */
  private rideNeedsFraming = false;
  /** Offset to frame the next ride frame with instead of the default (rebuilds). */
  private pendingRideOffset: RideOffsetSnapshot | null = null;
  /** Subject position / velocity in camera-holder coordinates (scene units, per second). */
  private readonly ridePos = new THREE.Vector3();
  private readonly rideVel = new THREE.Vector3();
  private readonly rideUp = new THREE.Vector3(0, 1, 0);
  private readonly ridePrevUp = new THREE.Vector3(0, 1, 0);
  private rideShellsBiased = false;
  /** 近接: this frame's state of the selected satellite (ECI km, km/s; world scene units). */
  private rideSatValid = false;
  private readonly rideSatEciPos = { x: 0, y: 0, z: 0 };
  private readonly rideSatEciVel = { x: 0, y: 0, z: 0 };
  private readonly rideSatWorld = new THREE.Vector3();
  private readonly rideSatWorldVel = new THREE.Vector3();
  private readonly rideBodyToWorld = new THREE.Quaternion();
  /** Whether the selected satellite's dot is currently hidden under its 近接 model. */
  private selectedDotHidden = false;
  /**
   * Frames left during which 近接 keeps the selected dot hidden even before
   * the model reports it covers the dot (its size is measured one frame late
   * and the model may still be loading): without it the first close frame
   * shows the dot as a screen-filling disc.
   */
  private closeUpDotGraceFrames = 0;
  private readonly cpuHideSelectedUniform = { value: 0 };
  /** Tracks last handed to setTrajectories. */
  private trajectoryTracks: TrajectoryTrack[] = [];
  /** Track whose event labels the renderer currently shows. */
  private focusedTrajectoryTrack: string | null = null;
  /** Guided tours: track the free globe camera keeps centred (see setGlobeChase). */
  private globeChaseId: string | null = null;
  private globeChaseLastRealMs: number | null = null;
  /** Tilt of the tour globe view out of the track's orbit plane (see frameGlobe). */
  private globeTiltRad = 0;
  private readonly globeNormal = new THREE.Vector3();
  private readonly globeChaseDir = new THREE.Vector3();
  private readonly globeChaseVel = new THREE.Vector3();
  private readonly globeChaseQuat = new THREE.Quaternion();
  private readonly globeChaseIdentity = new THREE.Quaternion();
  /** Trajectory follow framing (guided tours), see setTrajectoryFollowFraming. */
  private rideTargetUpM = 0;
  private rideTargetUpGoalM = 0;
  private rideDistanceGoalM: number | null = null;
  private rideIncludeId: string | null = null;
  private rideTransitionS = 0.8;
  private rideLastRealMs: number | null = null;
  private readonly rideIncludePos = new THREE.Vector3();
  private readonly rideIncludeVel = new THREE.Vector3();
  /** The globe's first textures are on the GPU (boot splash gone). */
  private earthReady = false;
  /** Scenario objects taken out of this frame's render (presentation), restored right after. */
  private readonly presentationHidden: THREE.Object3D[] = [];
  private presentationKeep: Set<THREE.Object3D> | null = null;

  private params: SatelliteSceneParams;

  /** Track id of the trajectory follow, or null (also null while in 近接). */
  private get trajectoryFollowId(): string | null {
    return this.ride?.kind === "trajectory" ? this.ride.id : null;
  }

  constructor(params: SatelliteSceneParams) {
    this.params = params;
    this.pointStyleUniforms = createPointStyleUniforms(params.pointStyle);
    this.cameraMode = params.cameraMode;
    if (!this.params.mountRef.current) {
      throw new Error("mountRef must be attached to a DOM element");
    }
    const mountNode = this.params.mountRef.current;
    this.currentSimDate = this.params.startTime;
    this.scene = new THREE.Scene();
    if (params.whiteBackground) {
      this.scene.background = new THREE.Color(0xffffff);
    }
    this.camera = new THREE.PerspectiveCamera(
      45,
      windowAspect(),
      0.1,
      1000,
    );
    this.camera.position.set(0, 0, 3);
    this.cameraHolder = new THREE.Group();
    this.cameraHolder.add(this.camera);
    this.scene.add(this.cameraHolder);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Render at device resolution (capped at 2× to bound GPU cost) so the
    // globe and orbit lines stay sharp on Retina / phone screens.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    // Zoom range: down to ~60 km above the surface (the near plane follows
    // the height, see updateFreeCameraRange, and the ground clearance step
    // keeps the camera outside the globe), 30 = far enough to see GEO
    // satellites (~6.6 R) without the Earth shrinking to a dot.
    this.controls.minDistance = FREE_CAMERA_MIN_DISTANCE;
    this.controls.maxDistance = 30;
    this.resetFreeCamera();

    // Notify React when the user finishes manipulating the camera so the view
    // can be persisted. 'end' fires once per drag/zoom gesture, avoiding the
    // per-frame churn of saving on every change.
    // While following a trajectory, the camera sits metres from the vehicle;
    // that framing is never persisted (getCameraSnapshot reports the framing
    // to return to instead), so skip the report altogether.
    const handleControlsEnd = () => {
      if (this.ride !== null) return;
      this.params.onCameraChange?.(this.getCameraSnapshot());
    };
    this.controls.addEventListener("end", handleControlsEnd);
    this.disposeFns.push(() =>
      this.controls.removeEventListener("end", handleControlsEnd),
    );

    const useLayeredEarth = isLayeredEarthMode(params.earthTexture);
    // Sunlight is a DirectionalLight: at 1 AU the rays are parallel. The
    // layered globe keeps a low ambient so the night side reads as night but
    // its continents stay legible next to the city lights.
    this.ambientLight = new THREE.AmbientLight(
      0xffffff,
      params.brightEarth ? 1.5 : 0.2,
    );
    this.scene.add(this.ambientLight);
    this.sunlight = new THREE.DirectionalLight(
      0xffffff,
      params.brightEarth ? 0 : useLayeredEarth ? 2.0 : 1.5,
    );
    this.scene.add(this.sunlight);

    this.groundConeColor = new THREE.Color(this.params.groundConeColor);
    this.fovConeColor = new THREE.Color(this.params.fovConeColor);
    this.satelliteVisibleColor = new THREE.Color(this.params.satelliteVisibleColor);
    this.satelliteHiddenColor = new THREE.Color(this.params.satelliteHiddenColor);
    this.satelliteSelectedColor = new THREE.Color(this.params.satelliteSelectedColor);
    const minHeight = Math.max(this.params.fovConeMinHeight, 0.001);
    this.fovConeMinHeight = minHeight;

    const earth = this.createEarth();
    this.earthGroup = earth.group;
    this.earthResourceDisposers = earth.disposeFns;
    this.earthAnimationBindings = earth.animatedMaterials;
    this.setCountryBordersVisible = earth.setCountryBordersVisible;
    this.setCountryBordersVisible(params.showCountryBorders);
    this.setCloudsVisible = earth.setCloudsVisible;
    this.setCloudsVisible(params.showClouds);
    this.setEarthDetailed = earth.setDetailed;
    this.earthGroup.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.earthGroup);
    this.launchSiteImagery = this.createLaunchSiteImagery();

    this.graticule = createGraticule(10, 0.001, !!params.whiteBackground);
    this.graticule.visible = this.params.showGraticule;
    this.scene.add(this.graticule);

    this.ecliptic = createEclipticLine(1);
    this.ecliptic.visible = this.params.showEcliptic;
    this.scene.add(this.ecliptic);

    this.geoOrbit = createGeoOrbitLine(GEO_RADIUS_KM / EARTH_RADIUS_EQUATOR_KM);
    this.geoOrbit.visible = this.params.showGeoOrbit;
    this.scene.add(this.geoOrbit);

    const sunDotGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const sunDotMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.sunDot = new THREE.Mesh(sunDotGeo, sunDotMat);
    this.sunDot.visible = this.params.showSunDirection;
    this.scene.add(this.sunDot);

    this.stationGeo = new THREE.SphereGeometry(0.01, 8, 8);
    this.stationMat = new THREE.MeshBasicMaterial({
      color: params.whiteBackground ? 0x2563eb : 0xffffff,
    });

    // Editor satellites only: CPU mode keeps exact SGP4 for each of them;
    // mass mode (editor count alone above the threshold) hands them to the
    // GPU J2 layer instead. Catalog rows go to the separate overlay below.
    this.satCount = this.params.satellites.length;
    const massMode = isMassMode(this.satCount);
    this.satRecs = massMode ? [] : this.params.satellites.map((spec) => toSatrec(spec));
    this.massLayer = massMode
      ? new MassSatelliteLayer(
        catalogFromSpecs(this.params.satellites),
        this.currentSimDate.getTime(),
        this.params.satRadius,
        { visible: this.satelliteVisibleColor, hidden: this.satelliteHiddenColor, selected: this.satelliteSelectedColor },
        this.pointStyleUniforms,
      )
      : null;
    const filingMarkers = new Float32Array(this.satRecs.length);
    if (!massMode) {
      this.params.satellites.forEach((s, i) => { filingMarkers[i] = s.meta?.dataStatus === "filing" ? 1 : 0; });
    }

    const satPositions = new Float32Array(this.satRecs.length * 3);
    const satColors = new Float32Array(this.satRecs.length * 3);
    this.satGeometry = new THREE.BufferGeometry();
    this.satPosAttr = new THREE.BufferAttribute(satPositions, 3);
    this.satColorAttr = new THREE.BufferAttribute(satColors, 3);
    this.satGeometry.setAttribute("position", this.satPosAttr);
    this.satGeometry.setAttribute("color", this.satColorAttr);
    this.satGeometry.setAttribute("filingMarker", new THREE.BufferAttribute(filingMarkers, 1));
    const textureCircle = new THREE.TextureLoader().load("./assets/circle.png");
    this.satMaterial = new THREE.PointsMaterial({
      size: this.params.satRadius * 2,
      map: textureCircle,
      transparent: true,
      sizeAttenuation: true,
      vertexColors: true,
    });
    // Preserve the same point/index mapping for picking. Declared filings keep
    // the normal visibility colours but draw as a hollow ring, like a planned
    // object on a map, so they never read as a tracked satellite.
    this.satMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.pointStyleUniforms, {
        uSelectedPoint: this.cpuSelectedUniform,
        uHideSelectedPoint: this.cpuHideSelectedUniform,
      });
      shader.vertexShader = "attribute float filingMarker; varying float vFilingMarker; uniform float uSelectedPoint; uniform float uHideSelectedPoint;\n" + POINT_STYLE_VERTEX_PARS + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("gl_PointSize = size;", "vFilingMarker = filingMarker; gl_PointSize = size * (filingMarker > 0.5 ? 1.35 : 1.0);");
      shader.vertexShader = shader.vertexShader.replace("#include <logdepthbuf_vertex>", `
        {
          vec3 styled = vColor.rgb;
          bool selectedPoint = abs(float(gl_VertexID) - uSelectedPoint) < 0.5;
          gl_PointSize = styleSatPoint(transformed, float(gl_VertexID), selectedPoint, filingMarker > 0.5, gl_PointSize, styled);
          // 近接: the 3D model replaces the selected dot (a world-size dot would fill the view).
          if (selectedPoint && uHideSelectedPoint > 0.5) gl_PointSize = 0.0;
          vColor.rgb = styled;
        }
        #include <logdepthbuf_vertex>
      `);
      shader.fragmentShader = "varying float vFilingMarker;\n" + POINT_STYLE_FRAGMENT_PARS + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", `
        if (vPixelDot > 0.5) {
          diffuseColor.a *= ${PIXEL_DOT_ALPHA};
        } else if (vFilingMarker > 0.5) {
          float d = length(gl_PointCoord - 0.5);
          float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.24, 0.32, d);
          if (ring < 0.01) discard;
          diffuseColor.a *= ring;
        } else {
          #include <map_particle_fragment>
        }
      `);
    };
    this.satMaterial.customProgramCacheKey = () => "filing-hollow-ring-point-style-v1";
    const satPoints = new THREE.Points(this.satGeometry, this.satMaterial);

    const groundPositions = new Float32Array(this.satRecs.length * 3);
    this.groundGeometry = new THREE.BufferGeometry();
    this.groundPosAttr = new THREE.BufferAttribute(groundPositions, 3);
    this.groundGeometry.setAttribute("position", this.groundPosAttr);
    this.groundMaterial = new THREE.PointsMaterial({
      color: 0xa9a9a9,
      map: textureCircle,
      transparent: true,
      size: 0.01,
      sizeAttenuation: true,
    });
    this.applyGroundPointSize();
    const groundPoints = new THREE.Points(this.groundGeometry, this.groundMaterial);

    this.stationConeGeometries = [];
    this.stationConeMaterials = [];
    this.stationConeMeshes = [];
    const heightNorm = Math.max(this.params.groundConeLength, 0.01);
    this.stationMeshes = this.params.groundStations.map((gs) => {
      const mesh = new THREE.Mesh(this.stationGeo, this.stationMat);
      const coneGeo = stationConeGeometry(gs.minElevationDeg, heightNorm);
      const coneMat = new THREE.MeshBasicMaterial({
        color: this.groundConeColor.clone(),
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const coneMesh = new THREE.Mesh(coneGeo, coneMat);
      coneMesh.scale.set(1, heightNorm, 1);
      coneMesh.visible = this.params.showGroundStationCones;
      this.stationConeGeometries.push(coneGeo);
      this.stationConeMaterials.push(coneMat);
      this.stationConeMeshes.push(coneMesh);
      this.scene.add(coneMesh);
      return mesh;
    });
    this.linkMaterial = new THREE.LineBasicMaterial({
      color: params.whiteBackground ? 0x2563eb : 0xffffff,
    });
    this.linkGeometry = new THREE.BufferGeometry();
    this.linkSegments = new THREE.LineSegments(this.linkGeometry, this.linkMaterial);
    this.linkSegments.frustumCulled = false;
    this.ensureLinkCapacity(64);

    this.satEciPositions = this.satRecs.map(() => ({ x: 0, y: 0, z: 0 }));

    const islMaxVertices = ISL_PATH_INITIAL_SEGMENTS * 2;
    const islPositions = new Float32Array(islMaxVertices * 3);
    const islColors = new Float32Array(islMaxVertices * 3);
    this.islPathGeometry = new THREE.BufferGeometry();
    this.islPathPosAttr = new THREE.BufferAttribute(islPositions, 3);
    this.islPathColorAttr = new THREE.BufferAttribute(islColors, 3);
    this.islPathGeometry.setAttribute("position", this.islPathPosAttr);
    this.islPathGeometry.setAttribute("color", this.islPathColorAttr);
    this.islPathGeometry.setDrawRange(0, 0);
    this.islGslColor = new THREE.Color(params.islSettings.gslColor);
    this.islIslColor = new THREE.Color(params.islSettings.islColor);
    this.islGslColorHex = params.islSettings.gslColor;
    this.islIslColorHex = params.islSettings.islColor;
    this.islPathMaterial = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
    this.islPathLines = new THREE.LineSegments(this.islPathGeometry, this.islPathMaterial);
    this.islPathLines.visible = false;
    // Re-based at renderOrigin in 近接; the static bounding sphere would cull it wrongly.
    this.islPathLines.frustumCulled = false;
    this.scene.add(this.islPathLines);

    // Endpoint markers reuse the same two colors as the path segments
    // — matches the pre-existing visual convention of A=GSL-pink, B=ISL-cyan
    // rather than duplicating them as separate hardcoded, settings-independent constants.
    this.islEndpointGeo = new THREE.SphereGeometry(0.014, 12, 12);
    this.islEndpointMatA = new THREE.MeshBasicMaterial({ color: this.islGslColor });
    this.islEndpointMatB = new THREE.MeshBasicMaterial({ color: this.islIslColor });
    this.islEndpointMeshA = new THREE.Mesh(this.islEndpointGeo, this.islEndpointMatA);
    this.islEndpointMeshB = new THREE.Mesh(this.islEndpointGeo, this.islEndpointMatB);
    this.islEndpointMeshA.visible = false;
    this.islEndpointMeshB.visible = false;
    this.scene.add(this.islEndpointMeshA);
    this.scene.add(this.islEndpointMeshB);

    // Deferred until ISL is actually enabled: most sessions never turn
    // it on, so spawning a worker + shipping the full satellite list to it on
    // every scene construction would be pure overhead for them.

    const fovHalfAngleRad = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(this.params.fovConeHalfAngleDeg, 1, 89.9),
    );
    this.fovConeGeometry = new THREE.ConeGeometry(
      Math.tan(fovHalfAngleRad),
      1,
      FOV_CONE_SEGMENTS,
      1,
      true,
    );
    this.fovConeGeometry.translate(0, -0.5, 0);
    this.fovConeMaterial = new THREE.MeshBasicMaterial({
      color: this.fovConeColor,
      transparent: true,
      opacity: FOV_CONE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fovCones = new THREE.InstancedMesh(
      this.fovConeGeometry,
      this.fovConeMaterial,
      Math.max(1, this.massLayer ? MASS_FOCUS_LIMIT + 1 : this.satRecs.length),
    );
    this.fovCones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fovCones.frustumCulled = false;
    this.fovCones.count = 0;
    this.scene.add(this.fovCones);
    this.fovMissMaterial = new THREE.MeshBasicMaterial({
      color: FOV_CONE_MISS_COLOR,
      transparent: true,
      opacity: FOV_CONE_MISS_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fovMissCones = new THREE.InstancedMesh(
      this.fovConeGeometry,
      this.fovMissMaterial,
      Math.max(1, this.massLayer ? MASS_FOCUS_LIMIT + 1 : this.satRecs.length),
    );
    this.fovMissCones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fovMissCones.frustumCulled = false;
    this.fovMissCones.count = 0;
    this.scene.add(this.fovMissCones);
    const missCapacity = this.fovMissCones.instanceMatrix.count;
    this.fovMissBoresightPositions = new Float32Array(missCapacity * 2 * 3);
    this.fovMissBoresightDistances = new Float32Array(missCapacity * 2);
    this.fovMissBoresightGeometry = new THREE.BufferGeometry();
    const boresightPos = new THREE.BufferAttribute(this.fovMissBoresightPositions, 3);
    boresightPos.setUsage(THREE.DynamicDrawUsage);
    const boresightDist = new THREE.BufferAttribute(this.fovMissBoresightDistances, 1);
    boresightDist.setUsage(THREE.DynamicDrawUsage);
    this.fovMissBoresightGeometry.setAttribute("position", boresightPos);
    this.fovMissBoresightGeometry.setAttribute("lineDistance", boresightDist);
    this.fovMissBoresightGeometry.setDrawRange(0, 0);
    this.fovMissBoresightMaterial = new THREE.LineDashedMaterial({
      color: FOV_CONE_MISS_COLOR,
      transparent: true,
      opacity: FOV_MISS_BORESIGHT_OPACITY,
      depthWrite: false,
      dashSize: FOV_MISS_BORESIGHT_DASH,
      gapSize: FOV_MISS_BORESIGHT_GAP,
    });
    this.fovMissBoresights = new THREE.LineSegments(this.fovMissBoresightGeometry, this.fovMissBoresightMaterial);
    this.fovMissBoresights.frustumCulled = false;
    this.scene.add(this.fovMissBoresights);

    this.scene.add(satPoints);
    this.scene.add(groundPoints);
    if (this.massLayer) {
      this.scene.add(this.massLayer.points);
      this.scene.add(this.massLayer.groundPoints);
    }
    this.setCatalog(this.params.catalog ?? null);
    this.stationMeshes.forEach((m) => this.scene.add(m));
    this.scene.add(this.linkSegments);

    // Initialize KML renderer
    this.kmlRenderer = new KMLRenderer(this.scene);
    // Trajectory tracks survive rebuilds: the constructor applies the latest
    // array, and useSatelliteScene swaps it live afterwards.
    this.trajectoryRenderer = new TrajectoryRenderer(this.scene);
    this.setTrajectories(this.params.trajectories ?? []);
    this.setTrajectoryLandmarks(this.params.trajectoryLandmarks ?? []);
    if (this.params.trajectoryFollowId) this.setTrajectoryFollow(this.params.trajectoryFollowId);
    // 近接 survives a rebuild only while a satellite is selected; the first
    // frame drops it (onCloseUpEnd) otherwise.
    if (this.cameraMode === "closeUp") this.startSatelliteRide(null);
    // Rebuilt mid-ride: resume the user's orbit offset (the first frame,
    // below, would otherwise frame the subject from the default angle).
    const resume = this.params.initialRideOffset;
    if (
      resume && this.ride && sameRideSubject(resume.subject, this.ride)
      && [...resume.offset, ...resume.up].every(Number.isFinite)
      && Math.hypot(...resume.offset) > 0 && Math.hypot(...resume.up) > 0
    ) {
      this.pendingRideOffset = resume;
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const getPointerNdc = (event: PointerEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      return pointer;
    };

    const handlePointerDown = (event: PointerEvent) => {
      this.pointerDownActive = true;
      this.pointerDownId = event.pointerId;
      this.pointerDownX = event.clientX;
      this.pointerDownY = event.clientY;
      this.didDragDuringPointer = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!this.pointerDownActive || this.pointerDownId !== event.pointerId) return;
      const dx = event.clientX - this.pointerDownX;
      const dy = event.clientY - this.pointerDownY;
      if (Math.hypot(dx, dy) > POINTER_DRAG_THRESHOLD_PX) {
        this.didDragDuringPointer = true;
      }
      if (
        this.cameraMode === "thirdPerson" &&
        this.selectedIndex !== null
      ) {
        const nextPitch = this.thirdPersonPitch - dy * 0.0065;
        this.thirdPersonPitch = THREE.MathUtils.clamp(
          nextPitch,
          THIRDPERSON_MIN_PITCH,
          THIRDPERSON_MAX_PITCH,
        );
        this.pointerDownX = event.clientX;
        this.pointerDownY = event.clientY;
        this.didDragDuringPointer = true;
      }
    };

    /** Screen-space hits among the CPU-drawn editor satellites. */
    const pickCpuPoints = (rect: DOMRect, clientX: number, clientY: number, radius: number): MassPickHit[] => {
      const posAttr = this.satGeometry.getAttribute("position") as THREE.BufferAttribute;
      const camPos = this.camera.getWorldPosition(new THREE.Vector3());
      const world = new THREE.Vector3();
      const ndc = new THREE.Vector3();
      const toSat = new THREE.Vector3();
      const screenPts: ({ x: number; y: number } | null)[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        world.fromBufferAttribute(posAttr, i).applyMatrix4(satPoints.matrixWorld);
        ndc.copy(world).project(this.camera);
        if (ndc.z > 1 || ndc.z < -1) {
          screenPts.push(null);
          continue;
        }
        toSat.subVectors(world, camPos);
        const dist = toSat.length();
        toSat.divideScalar(dist);
        // Ray–sphere test: does the line of sight hit the Earth before the satellite?
        const b = camPos.dot(toSat);
        const c = camPos.lengthSq() - 1;
        const disc = b * b - c;
        const tHit = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
        if (tHit > 0 && tHit < dist) {
          screenPts.push(null);
          continue;
        }
        screenPts.push({
          x: rect.left + ((ndc.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - ndc.y) / 2) * rect.height,
        });
      }
      return screenSpaceHitDistances(screenPts, clientX, clientY, radius);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!this.pointerDownActive || this.pointerDownId !== event.pointerId) return;
      const wasDrag = this.didDragDuringPointer;
      this.resetPointerInteraction();
      // Presentation: the scenario is not drawn, so it cannot be picked.
      if (wasDrag || this.params.presentation) return;

      getPointerNdc(event);
      raycaster.params.Points!.threshold = this.params.satRadius * 2;
      raycaster.setFromCamera(pointer, this.camera);
      // Raycasting ignores `visible`: skip markers hidden near the ride camera.
      const stationHits = raycaster.intersectObjects(this.stationMeshes, false).filter((hit) => hit.object.visible);
      if (stationHits.length > 0) {
        const hitObj = stationHits[0].object as THREE.Object3D;
        const idx = this.stationMeshes.findIndex((m) => m === hitObj);
        this.selectStation(idx);
        return;
      }
      // Screen-space picking: a fixed pixel radius regardless of zoom level,
      // skipping satellites hidden behind the Earth (unit sphere at origin).
      // Editor satellites and the catalog overlay are picked separately and
      // merged nearest first; overlay rows map to `satCount + row`.
      const rect = this.renderer.domElement.getBoundingClientRect();
      const radius = event.pointerType === "touch" ? PICK_RADIUS_TOUCH_PX : PICK_RADIUS_MOUSE_PX;
      const simMs = this.currentSimDate.getTime();
      if (this.massLayer || this.catalogLayer) this.camera.updateMatrixWorld();
      const editorHits = this.massLayer
        ? this.massLayer.pick(this.camera, rect, event.clientX, event.clientY, radius, simMs)
        : pickCpuPoints(rect, event.clientX, event.clientY, radius);
      const overlay = this.catalogLayer;
      const catalogHits = overlay
        ? overlay.pick(this.camera, rect, event.clientX, event.clientY, radius, simMs, (i) => overlay.isRowVisible(i))
        : [];
      const nextIndex = pickSatelliteHitIndex(mergePickHits(editorHits, catalogHits, this.satCount), this.selectedIndex);
      // 近接: a tap on the model (the selected satellite itself) or on empty
      // space keeps the close-up; only another satellite changes selection.
      if (this.cameraMode === "closeUp" && (nextIndex === null || nextIndex === this.selectedIndex)) return;
      if (nextIndex !== null) {
        this.selectSatellite(nextIndex);
      } else {
        this.clearSelections();
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (this.pointerDownId !== event.pointerId) return;
      this.resetPointerInteraction();
    };

    const handleWheel = (event: WheelEvent) => {
      if (this.selectedIndex === null) return;
      const mode = this.cameraMode;
      if (mode === "earthCenter" || mode === "thirdPerson") {
        event.preventDefault();
        const [current, min, max] = mode === "earthCenter"
          ? [this.earthCenterDistance, FOLLOW_MIN_DISTANCE, FOLLOW_MAX_DISTANCE]
          : [this.thirdPersonDistance, FOLLOW_MIN_DISTANCE, FOLLOW_MAX_DISTANCE];
        const next = THREE.MathUtils.clamp(current * Math.exp(event.deltaY * 0.0012), min, max);
        if (mode === "earthCenter") this.earthCenterDistance = next;
        else this.thirdPersonDistance = next;
      }
    };

    this.renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", handlePointerMove);
    this.renderer.domElement.addEventListener("pointerup", handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    this.renderer.domElement.addEventListener("pointerleave", handlePointerCancel);
    this.renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
    this.disposeFns.push(() => {
      this.renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      this.renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      this.renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      this.renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      this.renderer.domElement.removeEventListener("pointerleave", handlePointerCancel);
      this.renderer.domElement.removeEventListener("wheel", handleWheel);
    });

    this.simulationClock = new SimulationClock(this.params.startTime.getTime(), performance.now(), this.params.speedRef.current);

    const handleResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = windowAspect(this.camera.aspect);
      this.camera.updateProjectionMatrix();
      this.applyViewOffset();
      this.kmlRenderer.setResolution(window.innerWidth, window.innerHeight);
      this.trajectoryRenderer.setResolution(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    this.disposeFns.push(() => window.removeEventListener("resize", handleResize));

    this.animate();
  }

  setCameraMode(mode: SatelliteCameraMode) {
    if (mode === this.cameraMode) return;
    // The satellite camera modes take precedence over a trajectory follow.
    if (mode !== "free") this.endTrajectoryFollow(true);
    const previous = this.cameraMode;
    if (previous === "closeUp") {
      // Leaving 近接: back to the free framing from before it (like the end
      // of a trajectory follow), or hand over to another satellite mode.
      this.endRide(false, mode === "free");
      this.cameraMode = mode;
      if (mode === "free") {
        this.params.onCameraChange?.(this.getCameraSnapshot());
        return;
      }
    } else if (mode === "closeUp") {
      const back = previous === "free" ? this.getCameraSnapshot() : null;
      this.cameraMode = mode;
      this.startSatelliteRide(back);
      this.params.onCameraChange?.(this.getCameraSnapshot());
      return;
    }
    this.cameraMode = mode;
    if (mode === "free") {
      this.resetFreeCamera();
      this.params.onCameraChange?.(this.getCameraSnapshot());
      return;
    }

    if (!this.hasCachedSelection) {
      this.params.onCameraChange?.(this.getCameraSnapshot());
      return;
    }
    const pos = this.cachedSelectedPosition;
    if (mode === "earthCenter") {
      this.earthCenterDistance = this.getDefaultEarthCenterDistance(pos);
    }
    if (mode === "thirdPerson") {
      this.thirdPersonDistance = this.getDefaultThirdPersonDistance(pos);
      this.thirdPersonPitch = THIRDPERSON_DEFAULT_PITCH;
      if (this.hasCachedVelocity && this.cachedSelectedVelocity.lengthSq() > 1e-8) {
        this.followBasis.copy(this.cachedSelectedVelocity).normalize();
      }
    }
    this.params.onCameraChange?.(this.getCameraSnapshot());
  }

  /**
   * Swap the catalog-layer overlay without rebuilding the scene: the old
   * overlay's GPU resources are freed and a new one is built at the current
   * sim time, styled from the current `catalogStyles` / `layerColorMode`.
   * A selected catalog row is cleared (onSelect(null)) since its index may
   * now address a different satellite. No-op for the catalog already shown.
   */
  setCatalog(catalog: SatelliteCatalog | null) {
    if (catalog === this.catalog) return;
    if (this.selectedIndex !== null && this.selectedIndex >= this.satCount) this.clearSatelliteSelection();
    if (this.catalogLayer) {
      this.scene.remove(this.catalogLayer.points);
      this.scene.remove(this.catalogLayer.groundPoints);
      this.catalogLayer.dispose();
      this.catalogLayer = null;
    }
    this.catalog = catalog;
    if (!catalog || catalog.count === 0) return;
    const layer = new MassSatelliteLayer(
      catalog,
      this.currentSimDate.getTime(),
      this.params.satRadius,
      { visible: this.satelliteVisibleColor, hidden: this.satelliteHiddenColor, selected: this.satelliteSelectedColor },
      this.pointStyleUniforms,
    );
    layer.setLayerStyles(this.params.catalogStyles ?? []);
    layer.setColorMode(this.params.layerColorMode ?? "layer");
    this.catalogLayer = layer;
    this.scene.add(layer.points);
    this.scene.add(layer.groundPoints);
  }

  /**
   * Replace the trajectory tracks without rebuilding the scene. No-op for the
   * array already shown; only tracks whose samples/events/colour changed are
   * rebuilt, and visibility toggles just show/hide the existing geometry.
   */
  setTrajectories(tracks: TrajectoryTrack[]) {
    this.trajectoryTracks = tracks;
    this.trajectoryRenderer.setTracks(tracks);
  }

  /** Replace the trajectory landmarks (no-op for the array already shown). */
  setTrajectoryLandmarks(landmarks: TrajectoryLandmark[]) {
    this.trajectoryRenderer.setLandmarks(landmarks);
  }

  /** Whether the globe's first textures are on the GPU (the boot splash is gone). */
  isEarthReady(): boolean {
    return this.earthReady;
  }

  /**
   * Framing of the current (or next) trajectory follow, for guided tours.
   * `setTrajectoryFollow` resets it to the default (start at 3 vehicle
   * lengths, orbit about the vehicle base); call this right after it.
   *  - `distanceM`: camera distance from the orbit target. Applied directly
   *    when the follow starts, else eased over `transitionS`; afterwards the
   *    viewer's zoom is free again.
   *  - `targetUpM`: raise the orbit target above the vehicle base along the
   *    local vertical (e.g. to the middle of a stacked rocket).
   *  - `includeId`: a second track kept in frame: the target becomes the
   *    midpoint of the two and the distance never drops below what fits
   *    both (with a margin), e.g. stage separation.
   *  - `transitionS`: easing time constant for the above (default 0.8 s; 0 snaps).
   */
  setTrajectoryFollowFraming(framing: {
    distanceM?: number | null;
    targetUpM?: number;
    includeId?: string | null;
    transitionS?: number;
  } | null) {
    const f = framing ?? {};
    this.rideDistanceGoalM = f.distanceM !== undefined && f.distanceM !== null && f.distanceM > 0 ? f.distanceM : null;
    this.rideTargetUpGoalM = Number.isFinite(f.targetUpM) ? (f.targetUpM as number) : 0;
    this.rideIncludeId = f.includeId ?? null;
    this.rideTransitionS = f.transitionS !== undefined && f.transitionS >= 0 ? f.transitionS : 0.8;
    if (this.rideNeedsFraming) this.rideTargetUpM = this.rideTargetUpGoalM;
  }

  private resetRideFraming() {
    this.rideTargetUpM = 0;
    this.rideTargetUpGoalM = 0;
    this.rideDistanceGoalM = null;
    this.rideIncludeId = null;
    this.rideTransitionS = 0.8;
    this.rideLastRealMs = null;
  }

  /**
   * Overview of a trajectory track: point the free camera straight down at
   * its current position (or its first sample when the sim time is outside
   * its span), from close range. Honours the free-camera frame (ECI/ECEF/GSE
   * holder rotation) and does not change it. Does nothing while following a
   * trajectory, in the satellite camera modes, or for unknown ids.
   */
  focusTrajectory(id: string) {
    if (this.cameraMode !== "free" || this.ride !== null) return;
    // Right after a follow ends the holder still has the Earth-fixed follow
    // rotation; bring it to the free-camera frame first so the framing below
    // is computed in the frame the next frame will render with.
    this.syncCameraHolder(this.currentSimDate, satellite.gstime(this.currentSimDate));
    const track = this.trajectoryTracks.find((t) => t.id === id);
    if (!track || track.samples.length === 0) return;
    const simMs = this.currentSimDate.getTime();
    const first = track.samples[0].timeMs;
    const last = track.samples[track.samples.length - 1].timeMs;
    const t = simMs < first || simMs > last ? first : simMs;
    const local = this.tempVectorA;
    if (!this.trajectoryRenderer.localStateAt(id, t, local, this.tempVectorC)) return;
    // Earth-fixed → world (the overlay group is rotated by GMST), then into
    // the camera holder's local frame where OrbitControls operate.
    local.applyAxisAngle(UP_AXIS, satellite.gstime(this.currentSimDate));
    this.tempQuaternionA.copy(this.cameraHolder.quaternion).invert();
    local.applyQuaternion(this.tempQuaternionA);
    const radius = local.length();
    if (radius < 1e-6) return;
    // Close enough that a ~100 km booster flight is legible, but keep the
    // track well beyond the 0.1 near plane for higher tracks.
    const distance = THREE.MathUtils.clamp(
      Math.max(1.15, radius + 0.15),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.controls.enabled = true;
    this.controls.target.copy(DEFAULT_CAMERA_TARGET);
    this.camera.position.copy(local).setLength(distance);
    this.camera.up.copy(UP_AXIS).applyQuaternion(this.cameraHolder.quaternion);
    this.camera.lookAt(this.cameraHolder.localToWorld(this.tempVectorB.copy(DEFAULT_CAMERA_TARGET)));
    this.controls.update();
    // Report the framing so the next scene rebuild restores it instead of the
    // previously saved view.
    this.params.onCameraChange?.(this.getCameraSnapshot());
  }

  /**
   * Whole-globe framing for the free camera (guided tours): look at the
   * Earth's centre from `distance` Earth radii (default: fit the globe to the
   * screen, as the default view), from the direction of track `id`'s current
   * position (clamped into its span) or, without a track, from the current
   * direction. `tiltDeg` (−85…85) tilts that direction toward the track's
   * orbit normal (negative: away from it; kept by the globe chase), so an
   * orbit ring is seen as an ellipse instead of edge-on; the track then sits
   * off-centre. A small tilt gives a side-on view of a flat ellipse. Not reported through
   * onCameraChange. Does nothing while following a trajectory or in the
   * satellite camera modes.
   */
  frameGlobe(id: string | null = null, distance?: number, tiltDeg = 0) {
    if (this.cameraMode !== "free" || this.ride !== null) return;
    this.syncCameraHolder(this.currentSimDate, satellite.gstime(this.currentSimDate));
    this.globeTiltRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(tiltDeg, -85, 85));
    const dir = this.globeChaseDir;
    if (!(id !== null && this.trackDirectionInHolder(id, this.currentSimDate, dir, this.globeTiltRad))) {
      dir.subVectors(this.camera.position, this.controls.target);
      if (dir.lengthSq() < 1e-12) dir.copy(DEFAULT_CAMERA_POSITION);
      dir.normalize();
    }
    // Fit the globe to the area not covered by the tour's title and captions.
    const { vHalf, hHalf } = this.visibleHalfAngles();
    const fitDistance = Math.max(DEFAULT_CAMERA_POSITION.length(), 1.12 / Math.sin(Math.min(vHalf, hHalf)));
    const d = THREE.MathUtils.clamp(distance ?? fitDistance, this.controls.minDistance, this.controls.maxDistance);
    this.controls.enabled = true;
    this.controls.target.copy(DEFAULT_CAMERA_TARGET);
    this.camera.position.copy(dir).multiplyScalar(d);
    this.camera.up.copy(UP_AXIS).applyQuaternion(this.cameraHolder.quaternion);
    this.camera.lookAt(this.cameraHolder.localToWorld(this.tempVectorB.copy(DEFAULT_CAMERA_TARGET)));
    this.controls.update();
  }

  /**
   * Guided tours: while the free camera is not following anything, turn it
   * about the Earth's centre each frame so trajectory track `id` stays in
   * the middle of the view (smoothed, the distance — zoom — is kept). Null
   * stops it. Not persisted; the scene never sets it on its own.
   */
  setGlobeChase(id: string | null) {
    this.globeChaseId = id;
    this.globeChaseLastRealMs = null;
  }

  /**
   * Unit direction of track `id` at `simDate` (clamped into its span) in
   * camera-holder coordinates, tilted by `tiltRad` from the track's position
   * toward its orbit normal (r × v with the inertial velocity), so a whole-
   * globe view sees the orbit plane from above rather than edge-on.
   */
  private trackDirectionInHolder(id: string, simDate: Date, out: THREE.Vector3, tiltRad = 0): boolean {
    const track = this.trajectoryTracks.find((t) => t.id === id);
    if (!track || track.samples.length === 0) return false;
    const first = track.samples[0].timeMs;
    const last = track.samples[track.samples.length - 1].timeMs;
    const t = Math.min(Math.max(simDate.getTime(), first), last);
    if (!this.trajectoryRenderer.localStateAt(id, t, out, this.globeChaseVel)) return false;
    const gst = satellite.gstime(simDate);
    out.applyAxisAngle(UP_AXIS, gst);
    if (tiltRad !== 0 && out.lengthSq() > 1e-12) {
      // Inertial velocity = Earth-relative + ω × r, with ω along the scene's +Y.
      const vel = this.globeChaseVel.applyAxisAngle(UP_AXIS, gst);
      vel.x += EARTH_ROTATION_RAD_S * out.z;
      vel.z -= EARTH_ROTATION_RAD_S * out.x;
      const normal = this.globeNormal.crossVectors(out, vel);
      if (normal.lengthSq() > 1e-24) {
        normal.normalize();
        out.normalize().multiplyScalar(Math.cos(tiltRad)).addScaledVector(normal, Math.sin(tiltRad));
      }
    }
    this.tempQuaternionA.copy(this.cameraHolder.quaternion).invert();
    out.applyQuaternion(this.tempQuaternionA);
    if (out.lengthSq() < 1e-12) return false;
    out.normalize();
    return true;
  }

  /** Per-frame globe chase (before OrbitControls.update), see {@link setGlobeChase}. */
  private updateGlobeChase(simDate: Date, nowReal: number) {
    const id = this.globeChaseId;
    if (id === null) return;
    const dtS = this.globeChaseLastRealMs === null ? 0 : Math.min(0.5, (nowReal - this.globeChaseLastRealMs) / 1000);
    const first = this.globeChaseLastRealMs === null;
    this.globeChaseLastRealMs = nowReal;
    const dir = this.globeChaseDir;
    if (!this.trackDirectionInHolder(id, simDate, dir, this.globeTiltRad)) return;
    this.controls.target.copy(DEFAULT_CAMERA_TARGET);
    const offset = this.tempVectorB.copy(this.camera.position);
    const distance = offset.length();
    if (distance < 1e-6) return;
    offset.divideScalar(distance);
    // Exponential smoothing (time constant 0.5 s); snap on the first frame.
    const alpha = first ? 1 : 1 - Math.exp(-dtS / 0.5);
    this.globeChaseQuat.setFromUnitVectors(offset, dir);
    // Partial turn = slerp(identity → full turn, alpha), written as a slerp
    // of the full turn back toward identity: slerpQuaternions(I, q, alpha)
    // with q === this copies I over q first and always yields identity.
    this.globeChaseQuat.slerp(this.globeChaseIdentity, 1 - alpha);
    offset.applyQuaternion(this.globeChaseQuat);
    this.camera.position.copy(offset).multiplyScalar(distance);
  }

  /**
   * Ride along with trajectory track `id` (null: stop). The camera holder is
   * held Earth-fixed so the ground does not turn, OrbitControls orbit and
   * zoom around the vehicle (limits scaled to its model length) with the
   * local vertical as "up", and the vehicle is re-centred rigidly each
   * frame from the same sim time used for drawing. The first followed frame
   * frames the vehicle from the side. Ignored in the satellite camera modes
   * (ends the follow, with onTrajectoryFollowEnd). Stopping restores the
   * free-camera framing from before the follow.
   */
  setTrajectoryFollow(id: string | null) {
    if (id === this.trajectoryFollowId) return;
    if (id === null) {
      this.endTrajectoryFollow(false);
      return;
    }
    if (this.cameraMode !== "free") {
      this.endTrajectoryFollow(false);
      this.params.onTrajectoryFollowEnd?.();
      return;
    }
    if (this.ride === null) this.rideReturn = this.getCameraSnapshot();
    this.ride = { kind: "trajectory", id };
    this.rideNeedsFraming = true;
    this.pendingRideOffset = null;
    this.resetRideFraming();
  }

  /**
   * The current ride's orbit offset (null when not riding or not framed
   * yet), for {@link SatelliteSceneParams.initialRideOffset} after a rebuild.
   */
  getRideOffset(): RideOffsetSnapshot | null {
    if (this.ride === null) return null;
    if (this.rideNeedsFraming) return this.pendingRideOffset;
    const offset = this.tempVectorA.subVectors(this.camera.position, this.controls.target);
    const up = this.ridePrevUp;
    return {
      subject: { ...this.ride },
      offset: [offset.x, offset.y, offset.z],
      up: [up.x, up.y, up.z],
    };
  }

  /**
   * Start the 近接 ride with the selected satellite (cameraMode is already
   * "closeUp"). `back` is the free framing to return to; null means the
   * default framing (entered from another satellite mode or a rebuild).
   */
  private startSatelliteRide(back: CameraSnapshot | null) {
    this.rideReturn = back && back.mode === "free" && isFiniteCameraSnapshot(back) ? back : this.defaultFreeSnapshot();
    this.ride = { kind: "satellite" };
    this.rideNeedsFraming = true;
    this.pendingRideOffset = null;
    this.rideSatValid = false;
    // Hide the dot before the camera moves in (see closeUpDotGraceFrames).
    this.closeUpDotGraceFrames = CLOSE_UP_DOT_GRACE_FRAMES;
    this.setSelectedDotHidden(true);
  }

  /** The default free framing (resetFreeCamera) as a snapshot, without moving the camera. */
  private defaultFreeSnapshot(): CameraSnapshot {
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const fitDistance = 1.15 / Math.sin(Math.min(vHalf, hHalf));
    const position = DEFAULT_CAMERA_POSITION.clone().setLength(Math.max(DEFAULT_CAMERA_POSITION.length(), fitDistance));
    return {
      mode: "free",
      position: [position.x, position.y, position.z],
      target: [DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z],
      earthCenterDistance: this.earthCenterDistance,
      thirdPersonDistance: this.thirdPersonDistance,
      thirdPersonPitch: this.thirdPersonPitch,
    };
  }

  getTrajectoryFollow(): string | null {
    return this.trajectoryFollowId;
  }

  /**
   * Jump the simulation clock to `date` without rebuilding the scene. Playback
   * speed is unchanged. Time-dependent state that assumes continuous time
   * (selected satellite's trail and orbit line, ISL path) is restarted.
   */
  seekTo(date: Date) {
    const ms = date.getTime();
    if (!Number.isFinite(ms)) return;
    this.simulationClock.reset(ms, performance.now());
    this.currentSimDate = new Date(ms);
    this.params.onSimTimeChange?.(this.currentSimDate);
    this.lastSimTimeNotificationMs = ms;
    if (this.params.timeRef.current) this.params.timeRef.current.textContent = this.formatTime(this.currentSimDate);
    // Selected satellite: restart its trail at the new time (a forward jump
    // must not back-fill the skipped interval) and redraw its orbit from now.
    if (this.selectedIndex !== null) {
      this.updateTrack();
      if (this.groundTrackLine) {
        this.groundTrackCount = 0;
        this.groundTrackNextSampleMs = ms;
        this.updateGroundTrack(satellite.gstime(this.currentSimDate));
      }
    }
    // ISL: drop the old path (its edges are meaningless at the new time),
    // ignore any in-flight compute, and recompute now — even while paused. A
    // jump is not an autonomous handover, so it is not counted as a switch.
    this.islWorkerRequestId++;
    this.islComputeInFlight = false;
    this.islForceRecompute = true;
    this.islPreviousPathEdgeKeys = null;
    if (this.islLastResult !== null) {
      this.islLastResult = null;
      this.applyIslPathToScene(null);
      this.params.onIslResult?.(null);
    }
  }

  /** Capture the current camera framing for persistence. */
  getSimulationTime(): Date {
    return new Date(this.currentSimDate.getTime());
  }

  getCameraSnapshot(): CameraSnapshot {
    // Never expose the close ride framing (saved views, persistence): it
    // would restore a camera metres above some point on the ground. 近接 is
    // not persisted either: the free framing to return to is reported.
    if (this.ride !== null && this.rideReturn) return { ...this.rideReturn };
    return {
      mode: this.cameraMode,
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      earthCenterDistance: this.earthCenterDistance,
      thirdPersonDistance: this.thirdPersonDistance,
      thirdPersonPitch: this.thirdPersonPitch,
    };
  }

  /**
   * Restore a previously captured camera framing. For free mode the camera
   * position/target are applied directly; for the follow modes the distance and
   * pitch drive {@link updateCameraFollow} on subsequent frames.
   */
  applyCameraSnapshot(snap: CameraSnapshot) {
    if (this.ride !== null) {
      // While riding, a free framing (e.g. the saved view re-applied after
      // a rebuild) becomes the framing to return to; a satellite mode ends
      // the ride first.
      if ((snap.mode === "free" || snap.mode === "closeUp") && isFiniteCameraSnapshot(snap)) {
        this.rideReturn = { ...snap, mode: "free" };
        return;
      }
      if (this.ride.kind === "trajectory") this.endTrajectoryFollow(true);
      else this.endRide(false, false);
    }
    if (snap.mode === "closeUp") {
      // Never written by this scene; treat it as "close up again, returning here".
      this.cameraMode = "closeUp";
      this.startSatelliteRide({ ...snap, mode: "free" });
      return;
    }
    if (!isFiniteCameraSnapshot(snap)) {
      // A broken saved view (see isFiniteCameraSnapshot): fall back to the
      // default framing and report it so the stored view is overwritten.
      this.cameraMode = "free";
      this.resetFreeCamera();
      this.params.onCameraChange?.(this.getCameraSnapshot());
      return;
    }
    this.cameraMode = snap.mode;
    this.earthCenterDistance = snap.earthCenterDistance;
    this.thirdPersonDistance = snap.thirdPersonDistance;
    this.thirdPersonPitch = snap.thirdPersonPitch;
    if (snap.mode === "free") {
      this.controls.enabled = true;
      this.controls.target.set(snap.target[0], snap.target[1], snap.target[2]);
      this.camera.position.set(snap.position[0], snap.position[1], snap.position[2]);
      this.camera.up.copy(UP_AXIS);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
    }
  }

  /**
   * Apply non-structural parameter changes to the live scene without rebuilding
   * it. Visibility toggles and cone tilt are already read from {@link params}
   * by the animate loop every frame, so updating {@link params} is enough for
   * those; the remaining items below are state that is only set up once at
   * construction (object visibility not read in the loop, cached colors, and
   * geometry derived from angles/ranges) and so must be updated explicitly.
   *
   * Structural changes (satellite/ground-station lists, earth texture,
   * bright-earth lighting, white background) still require a full rebuild and
   * are NOT handled here — see {@link useSatelliteScene}. The catalog itself
   * is swapped by {@link setCatalog}; its styles and colour mode apply here.
   */
  updateParams(next: SatelliteSceneParams) {
    const prev = this.params;
    this.params = next;

    // ISL settings changes must trigger an immediate recompute even while paused
    // (§1.6.3); the throttled sim/real-time checks in updateIslMarkersAndPath
    // otherwise only fire once the sim clock advances.
    if (next.islSettings !== prev.islSettings || next.islShellRanges !== prev.islShellRanges) {
      this.islForceRecompute = true;
    }

    // Endpoint changes are user-driven, not autonomous handover — reset the
    // hysteresis/switch-tracking state so they don't get miscounted as a path
    // switch, and drop the stale path immediately so it never renders a
    // geometrically-impossible line from the old path's tail to the new
    // marker position while the fresh compute is in flight.
    if (
      next.islSettings.endpointA !== prev.islSettings.endpointA ||
      next.islSettings.endpointB !== prev.islSettings.endpointB
    ) {
      this.islPreviousPathEdgeKeys = null;
      if (this.islLastResult !== null) {
        this.islLastResult = null;
        this.applyIslPathToScene(null);
        this.params.onIslResult?.(null);
      }
    }

    // Visibility of objects the animate loop does not touch.
    this.graticule.visible = next.showGraticule;
    this.setCountryBordersVisible(next.showCountryBorders);
    this.setCloudsVisible(next.showClouds);
    this.ecliptic.visible = next.showEcliptic;
    this.geoOrbit.visible = next.showGeoOrbit;
    this.sunDot.visible = next.showSunDirection;

    // Satellite point size.
    if (next.satRadius !== prev.satRadius) {
      this.satMaterial.size = next.satRadius * 2;
      this.massLayer?.setSatRadius(next.satRadius);
      this.catalogLayer?.setSatRadius(next.satRadius);
    }
    if (next.pointStyle !== prev.pointStyle) {
      applyPointStyle(this.pointStyleUniforms, next.pointStyle);
      this.applyGroundPointSize();
    }

    // Catalog-layer colour/visibility: uniform updates on the overlay only.
    if (this.catalogLayer) {
      if (next.catalogStyles !== prev.catalogStyles) this.catalogLayer.setLayerStyles(next.catalogStyles ?? []);
      if (next.layerColorMode !== prev.layerColorMode) this.catalogLayer.setColorMode(next.layerColorMode ?? "layer");
      // Hiding the layer of the selected row drops the selection.
      const sel = this.selectedIndex;
      if (sel !== null && sel >= this.satCount && !this.catalogLayer.isRowVisible(sel - this.satCount)) {
        this.clearSatelliteSelection();
      }
    }

    // Colors: mutate the cached Color objects in place. fovConeMaterial.color
    // shares the fovConeColor reference, so it updates with it; the per-station
    // cone materials were cloned, so update each explicitly.
    this.satelliteVisibleColor.set(next.satelliteVisibleColor);
    this.satelliteHiddenColor.set(next.satelliteHiddenColor);
    this.satelliteSelectedColor.set(next.satelliteSelectedColor);
    this.fovConeColor.set(next.fovConeColor);
    this.groundConeColor.set(next.groundConeColor);
    this.stationConeMaterials.forEach((m) => m.color.set(next.groundConeColor));
    if (this.islGslColorHex !== next.islSettings.gslColor || this.islIslColorHex !== next.islSettings.islColor) {
      this.islGslColor.set(next.islSettings.gslColor);
      this.islIslColor.set(next.islSettings.islColor);
      this.islEndpointMatA.color.set(next.islSettings.gslColor);
      this.islEndpointMatB.color.set(next.islSettings.islColor);
      this.islGslColorHex = next.islSettings.gslColor;
      this.islIslColorHex = next.islSettings.islColor;
      this.islColorsDirty = true;
    }

    // FOV cone geometry depends on the half-angle.
    if (next.fovConeHalfAngleDeg !== prev.fovConeHalfAngleDeg) {
      const rad = THREE.MathUtils.degToRad(
        THREE.MathUtils.clamp(next.fovConeHalfAngleDeg, 1, 89.9),
      );
      const geo = new THREE.ConeGeometry(Math.tan(rad), 1, FOV_CONE_SEGMENTS, 1, true);
      geo.translate(0, -0.5, 0);
      this.fovConeGeometry.dispose();
      this.fovConeGeometry = geo;
      this.fovCones.geometry = geo;
      this.fovMissCones.geometry = geo;
    }

    // Ground-station cone geometry depends on the drawn length (the opening
    // angle is the station's own minimum elevation, fixed for this scene).
    if (next.groundConeLength !== prev.groundConeLength) {
      const heightNorm = Math.max(next.groundConeLength, 0.01);
      this.stationConeMeshes.forEach((mesh, idx) => {
        const geo = stationConeGeometry(next.groundStations[idx].minElevationDeg, heightNorm);
        this.stationConeGeometries[idx].dispose();
        this.stationConeGeometries[idx] = geo;
        mesh.geometry = geo;
        mesh.scale.set(1, heightNorm, 1);
      });
    }
  }

  private resetPointerInteraction() {
    this.pointerDownActive = false;
    this.pointerDownId = null;
    this.didDragDuringPointer = false;
  }

  private resetFreeCamera() {
    this.controls.enabled = true;
    this.controls.target.copy(DEFAULT_CAMERA_TARGET);
    // Back the camera off on narrow (portrait) screens so the whole globe
    // fits horizontally; DEFAULT_CAMERA_POSITION is tuned for landscape.
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const fitDistance = 1.15 / Math.sin(Math.min(vHalf, hHalf));
    this.camera.position
      .copy(DEFAULT_CAMERA_POSITION)
      .setLength(Math.max(DEFAULT_CAMERA_POSITION.length(), fitDistance));
    this.camera.up.copy(UP_AXIS);
    this.camera.lookAt(DEFAULT_CAMERA_TARGET);
    this.controls.update();
  }

  private getDefaultEarthCenterDistance(selectedSatPosition: THREE.Vector3) {
    const altitude = Math.max(selectedSatPosition.length() - 1, 0);
    return THREE.MathUtils.clamp(
      0.32 + altitude * 0.9,
      FOLLOW_MIN_DISTANCE,
      FOLLOW_MAX_DISTANCE,
    );
  }

  private getDefaultThirdPersonDistance(selectedSatPosition: THREE.Vector3) {
    const altitude = Math.max(selectedSatPosition.length() - 1, 0);
    return THREE.MathUtils.clamp(
      0.24 + altitude * 1.35,
      FOLLOW_MIN_DISTANCE,
      FOLLOW_MAX_DISTANCE,
    );
  }

  private selectStation(idx: number | null) {
    this.selectedStationIndex = idx;
    this.params.onSelectStation?.(idx);
  }

  private resetGroundTrack() {
    this.clearGroundTrack();
    const material = new THREE.LineBasicMaterial({ color: 0x00ffff });
    this.groundTrackLine = new THREE.Line(new THREE.BufferGeometry(), material);
    this.groundTrackLine.frustumCulled = false;
    this.groundTrackPositions = new Float32Array(INITIAL_GROUND_TRACK_CAPACITY * 3);
    this.groundTrackCount = 0;
    this.groundTrackNextSampleMs = this.currentSimDate.getTime();
    this.bindGroundTrackBuffer();
    this.scene.add(this.groundTrackLine);
    this.updateGroundTrack(satellite.gstime(this.currentSimDate));
  }

  private clearGroundTrack() {
    if (this.groundTrackLine) {
      this.groundTrackLine.geometry.dispose();
      (this.groundTrackLine.material as THREE.Material).dispose();
      this.scene.remove(this.groundTrackLine);
      this.groundTrackLine = null;
    }
    this.groundTrackPositions = new Float32Array(0);
    this.groundTrackCount = 0;
  }

  private bindGroundTrackBuffer() {
    if (!this.groundTrackLine) return;
    const attr = new THREE.BufferAttribute(this.groundTrackPositions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.groundTrackLine.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", attr);
    this.groundTrackLine.geometry = geometry;
  }

  /** Write the Earth-fixed sub-satellite point at `date` into vertex `index`. */
  private writeGroundTrackVertex(satIndex: number, date: Date, index: number): boolean {
    const pv = this.propagateIndex(satIndex, date);
    if (!pv) return false;
    const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    const ecf = satellite.geodeticToEcf({
      longitude: geo.longitude,
      latitude: geo.latitude,
      height: GROUND_TRACK_HEIGHT_KM,
    });
    const o = index * 3;
    this.groundTrackPositions[o] = ecf.x / EARTH_RADIUS_EQUATOR_KM;
    this.groundTrackPositions[o + 1] = ecf.z / EARTH_RADIUS_POLAR_KM;
    this.groundTrackPositions[o + 2] = -ecf.y / EARTH_RADIUS_EQUATOR_KM;
    return true;
  }

  /** Make room for at least `needed` vertices, growing or dropping the oldest half. */
  private ensureGroundTrackCapacity(needed: number) {
    const capacity = this.groundTrackPositions.length / 3;
    if (needed <= capacity) return;
    if (capacity < MAX_GROUND_TRACK_POINTS + 1) {
      const next = new Float32Array(Math.min(capacity * 2, MAX_GROUND_TRACK_POINTS + 1) * 3);
      next.set(this.groundTrackPositions);
      this.groundTrackPositions = next;
      this.bindGroundTrackBuffer();
      return;
    }
    const drop = Math.floor(this.groundTrackCount / 2);
    this.groundTrackPositions.copyWithin(0, drop * 3, this.groundTrackCount * 3);
    this.groundTrackCount -= drop;
  }

  /**
   * Append any samples due since the last frame and move the live tip to the
   * exact current position, so the trail grows continuously rather than in
   * sample-sized steps.
   */
  private updateGroundTrack(gmst: number) {
    const line = this.groundTrackLine;
    if (!line || this.selectedIndex === null) return;
    const satIndex = this.selectedIndex;
    const nowMs = this.currentSimDate.getTime();
    // Time moved backwards (seek/reverse): restart the trail from here.
    if (this.groundTrackCount > 0 && nowMs < this.groundTrackNextSampleMs - GROUND_TRACK_STEP_MS) {
      this.groundTrackCount = 0;
      this.groundTrackNextSampleMs = nowMs;
    }
    while (this.groundTrackNextSampleMs <= nowMs) {
      this.ensureGroundTrackCapacity(this.groundTrackCount + 2);
      const sampleDate = new Date(this.groundTrackNextSampleMs);
      if (this.writeGroundTrackVertex(satIndex, sampleDate, this.groundTrackCount)) this.groundTrackCount += 1;
      this.groundTrackNextSampleMs += GROUND_TRACK_STEP_MS;
    }
    this.ensureGroundTrackCapacity(this.groundTrackCount + 1);
    const hasTip = this.writeGroundTrackVertex(satIndex, this.currentSimDate, this.groundTrackCount);
    line.geometry.setDrawRange(0, this.groundTrackCount + (hasTip ? 1 : 0));
    line.geometry.getAttribute("position").needsUpdate = true;
    line.rotation.y = gmst;
  }

  /**
   * ECI state (km, km/s) of global satellite index `i` at `date` from
   * whichever propagator draws it — SGP4 for CPU-drawn editor satellites,
   * the GPU layers' J2 twin for mass-mode editor satellites and catalog rows
   * (`i >= satCount`) — so orbit lines, tracks and the follow camera stay on
   * the drawn point.
   */
  private propagateIndex(i: number, date: Date): { position: Vec3; velocity: Vec3 | null } | null {
    if (i >= this.satCount) return this.catalogLayer?.stateAt(i - this.satCount, date.getTime()) ?? null;
    if (this.massLayer) return this.massLayer.stateAt(i, date.getTime());
    const pv = satellite.propagate(this.satRecs[i], date);
    if (!pv?.position) return null;
    return { position: pv.position, velocity: pv.velocity ?? null };
  }

  private orbitPeriodMinutes(i: number): number {
    if (i >= this.satCount) return this.catalogLayer?.periodMinutes(i - this.satCount) ?? 0;
    return this.massLayer ? this.massLayer.periodMinutes(i) : (2 * Math.PI) / this.satRecs[i].no;
  }

  /** CPU sub-satellite points: world size, or fixed pixels in pixel mode (as the GPU layers do). */
  private applyGroundPointSize() {
    const px = this.params.pointStyle.pixelSize;
    const attenuate = px <= 0;
    const map = attenuate ? this.satMaterial.map : null;
    this.groundMaterial.size = attenuate ? 0.01 : Math.max(px - 1, 1) * this.renderer.getPixelRatio();
    if (this.groundMaterial.sizeAttenuation !== attenuate || this.groundMaterial.map !== map) {
      this.groundMaterial.sizeAttenuation = attenuate;
      this.groundMaterial.map = map;
      this.groundMaterial.needsUpdate = true;
    }
  }

  private selectSatellite(idx: number) {
    this.selectedIndex = idx;
    this.cpuSelectedUniform.value = !this.massLayer && idx < this.satCount ? idx : -1;
    this.massLayer?.setSelected(idx < this.satCount ? idx : null);
    this.catalogLayer?.setSelected(idx >= this.satCount ? idx - this.satCount : null);
    this.params.onSelect?.(idx);
    this.updateTrack();
    this.resetGroundTrack();
  }

  private clearSatelliteSelection() {
    this.selectedIndex = null;
    this.cpuSelectedUniform.value = -1;
    this.massLayer?.setSelected(null);
    this.catalogLayer?.setSelected(null);
    this.hasCachedSelection = false;
    this.hasCachedVelocity = false;
    this.params.onSelect?.(null);
    this.updateTrack();
    this.clearGroundTrack();
  }

  private clearSelections() {
    this.clearSatelliteSelection();
    this.selectStation(null);
  }

  private updateTrack() {
    if (this.orbitLine) {
      this.orbitLine.geometry.dispose();
      this.scene.remove(this.orbitLine);
      this.orbitLine = null;
    }
    if (this.selectedIndex === null) return;
    const satIndex = this.selectedIndex;
    const points: THREE.Vector3[] = [];
    const periodMinutes = this.orbitPeriodMinutes(satIndex);
    // Cap at ~2 days so a GEO/HEO pick never builds a huge line.
    const trackMinutes = Math.min(Math.round(periodMinutes * 2), 2880);
    const startMs = this.currentSimDate.getTime();
    this.orbitLineTimes = [];
    for (let m = 0; m <= trackMinutes; m += 1) {
      const d = new Date(startMs + m * 60000);
      const pv = this.propagateIndex(satIndex, d);
      if (pv) {
        this.orbitLineTimes.push(d.getTime());
        const { x, y, z } = pv.position;
        points.push(
          new THREE.Vector3(
            x / EARTH_RADIUS_EQUATOR_KM,
            z / EARTH_RADIUS_POLAR_KM,
            -y / EARTH_RADIUS_EQUATOR_KM,
          ),
        );
      }
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      // Slate on the light theme: dark enough for the white sky, light
      // enough to stay visible where the orbit crosses the dark Earth.
      color: this.params.whiteBackground ? 0x64748b : 0xffffff,
    });
    this.orbitLine = new THREE.Line(geom, mat);
    this.scene.add(this.orbitLine);
  }

  /**
   * Set {@link renderOrigin} for this frame (before any re-based overlay is
   * written): the selected editor satellite's position while riding it in
   * 近接 — from the same propagator and time as the 近接 model, so the cone
   * apex, links and close-up orbit meet the model exactly — else the origin.
   */
  private updateRenderOrigin(simDate: Date, following: boolean) {
    this.renderOrigin.set(0, 0, 0);
    const sel = this.selectedIndex;
    if (following && this.ride?.kind === "satellite" && sel !== null && sel < this.satCount) {
      const st = this.propagateIndex(sel, simDate);
      const p = st?.position;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        this.renderOrigin.set(p.x / EARTH_RADIUS_EQUATOR_KM, p.z / EARTH_RADIUS_POLAR_KM, -p.y / EARTH_RADIUS_EQUATOR_KM);
      }
    }
    for (const object of [this.fovCones, this.fovMissCones, this.fovMissBoresights, this.linkSegments, this.islPathLines]) {
      object.position.copy(this.renderOrigin);
    }
  }

  /**
   * 近接: the global orbit line is 1-minute chords (~460 km in LEO, sagging
   * up to ~4 km inside the orbit) in absolute float32, which looks angular
   * and misses the model at close range. While riding, its vertices within
   * ±CLOSE_UP_ORBIT_WINDOW_MS of now are hidden (geometry groups) and this
   * dense segment — propagated every frame with the model's propagator, a
   * vertex exactly at now, steps growing from 1 s to 60 s outward — is drawn
   * instead, re-based at {@link renderOrigin}. Its ends are the global line's
   * own vertices, so the two join seamlessly. Outside 近接 nothing changes.
   */
  private updateCloseUpOrbit(simDate: Date, riding: boolean) {
    const line = this.orbitLine;
    const sel = this.selectedIndex;
    const active =
      riding && this.ride?.kind === "satellite" && this.rideSatValid && line !== null && sel !== null && this.renderOrigin.lengthSq() > 0;
    if (!active) {
      if (line && Array.isArray(line.material)) {
        line.material = line.material[0];
        line.geometry.clearGroups();
      }
      if (this.closeUpOrbit) this.closeUpOrbit.visible = false;
      return;
    }
    const material = (Array.isArray(line.material) ? line.material[0] : line.material) as THREE.LineBasicMaterial;
    const nowMs = simDate.getTime();
    const times = this.orbitLineTimes;
    const lo = nowMs - CLOSE_UP_ORBIT_WINDOW_MS;
    const hi = nowMs + CLOSE_UP_ORBIT_WINDOW_MS;
    let a = -1;
    let b = times.length;
    for (let k = 0; k < times.length; k++) {
      if (times[k] <= lo) a = k;
      if (times[k] >= hi) {
        b = k;
        break;
      }
    }
    const startMs = a >= 0 ? times[a] : lo;
    const endMs = b < times.length ? times[b] : hi;

    // Sample times: now, then outward with steps growing ×1.15 from 1 s to 60 s.
    const sampleTimes = this.closeUpOrbitTimes;
    sampleTimes.length = 0;
    const back: number[] = [];
    for (let t = nowMs, step = 1000; t > startMs; step = Math.min(step * 1.15, 60_000)) {
      t = Math.max(t - step, startMs);
      back.push(t);
    }
    for (let k = back.length - 1; k >= 0; k--) sampleTimes.push(back[k]);
    sampleTimes.push(nowMs);
    for (let t = nowMs, step = 1000; t < endMs; step = Math.min(step * 1.15, 60_000)) {
      t = Math.min(t + step, endMs);
      sampleTimes.push(t);
    }

    let orbit = this.closeUpOrbit;
    if (!orbit) {
      const geometry = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(new Float32Array(CLOSE_UP_ORBIT_MAX_POINTS * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", attr);
      orbit = new THREE.Line(geometry, material);
      orbit.name = "CloseUpOrbit";
      orbit.frustumCulled = false;
      this.scene.add(orbit);
      this.closeUpOrbit = orbit;
    }
    orbit.material = material;
    orbit.position.copy(this.renderOrigin);
    const attr = orbit.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const c = this.renderOrigin;
    let n = 0;
    for (const t of sampleTimes) {
      if (n >= CLOSE_UP_ORBIT_MAX_POINTS) break;
      let x: number;
      let y: number;
      let z: number;
      if (t === nowMs) {
        x = c.x;
        y = c.y;
        z = c.z;
      } else {
        const st = this.propagateIndex(sel, new Date(t));
        const p = st?.position;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
        x = p.x / EARTH_RADIUS_EQUATOR_KM;
        y = p.z / EARTH_RADIUS_POLAR_KM;
        z = -p.y / EARTH_RADIUS_EQUATOR_KM;
      }
      arr[n * 3] = x - c.x;
      arr[n * 3 + 1] = y - c.y;
      arr[n * 3 + 2] = z - c.z;
      n++;
    }
    attr.needsUpdate = true;
    orbit.geometry.setDrawRange(0, n);
    orbit.visible = line.visible;

    // Global line: everything but the replaced window (vertices a..b are covered).
    const geometry = line.geometry;
    const total = times.length;
    geometry.clearGroups();
    if (a >= 1) geometry.addGroup(0, a + 1, 0);
    if (b <= total - 2) geometry.addGroup(b, total - b, 0);
    if (!Array.isArray(line.material)) line.material = [material];
  }

  private readonly closeUpOrbitTimes: number[] = [];

  // Reused across calls: avoids allocating a fresh observer literal
  // every frame for each of the two endpoints.
  private readonly islScratchObserver = { longitude: 0, latitude: 0, height: 0 };

  private islEndpointScenePosition(endpoint: IslEndpoint, gmst: number, target: THREE.Vector3): THREE.Vector3 {
    endpointObserver(endpoint, this.islScratchObserver);
    const eci = endpointEci(this.islScratchObserver, gmst);
    return target.set(
      eci.x / EARTH_RADIUS_EQUATOR_KM,
      eci.z / EARTH_RADIUS_POLAR_KM,
      -eci.y / EARTH_RADIUS_EQUATOR_KM,
    );
  }

  private islNodeScenePosition(nodeId: number, target: THREE.Vector3): THREE.Vector3 {
    // The routing worker only knows the editor satellites; its two endpoint
    // node ids follow them, ahead of any catalog rows drawn after them.
    const satCount = this.params.satellites.length;
    if (nodeId === satCount) return target.copy(this.islEndpointMeshA.position);
    if (nodeId === satCount + 1) return target.copy(this.islEndpointMeshB.position);
    const p = this.massLayer
      ? this.propagateIndex(nodeId, this.currentSimDate)?.position ?? { x: 0, y: 0, z: 0 }
      : this.satEciPositions[nodeId];
    return target.set(
      p.x / EARTH_RADIUS_EQUATOR_KM,
      p.z / EARTH_RADIUS_POLAR_KM,
      -p.y / EARTH_RADIUS_EQUATOR_KM,
    );
  }

  /**
   * Recompute (throttled per §1.6.3) and render the ISL path, and keep the
   * endpoint markers positioned every frame regardless of recompute timing.
   */
  private updateIslMarkersAndPath(simDate: Date, gmst: number, nowRealMs: number) {
    const settings = this.params.islSettings;
    const endpointA = settings.endpointA;
    const endpointB = settings.endpointB;
    const active = settings.enabled && !!endpointA && !!endpointB;

    this.islEndpointMeshA.visible = active;
    this.islEndpointMeshB.visible = active;

    if (!active) {
      this.islPathLines.visible = false;
      this.islPathGeometry.setDrawRange(0, 0);
      this.islLastRecomputeSimMs = null;
      this.islPreviousPathEdgeKeys = null;
      // Invalidate any in-flight worker request so a late response can't
      // resurrect a path after ISL has been disabled.
      this.islWorkerRequestId++;
      this.islComputeInFlight = false;
      this.params.onIslError?.(null);
      if (this.islLastResult !== null) {
        this.islLastResult = null;
        this.params.onIslResult?.(null);
      }
      return;
    }

    this.islEndpointMeshA.position.copy(this.islEndpointScenePosition(endpointA, gmst, this.islScratchFrom));
    this.islEndpointMeshB.position.copy(this.islEndpointScenePosition(endpointB, gmst, this.islScratchTo));

    const simMs = simDate.getTime();
    const dueBySim =
      this.islLastRecomputeSimMs === null ||
      Math.abs(simMs - this.islLastRecomputeSimMs) >= settings.recomputeIntervalSimS * 1000;
    const dueByReal = nowRealMs - this.islLastRecomputeRealMs >= ISL_RECOMPUTE_MIN_REAL_MS;

    if (!this.islForceRecompute && !(dueBySim && dueByReal)) {
      this.applyIslPathToScene(this.islLastResult);
      return;
    }

    // Node list stays fixed until the worker responds — keep rendering the
    // last known path with fresh (moving) vertex positions this frame.
    this.applyIslPathToScene(this.islLastResult);

    // Avoid piling up requests if the worker is still busy with a previous one.
    // Crucially, do NOT consume islForceRecompute or advance the throttle
    // timestamps here — otherwise a setting change that arrives while a
    // compute is in flight is silently dropped, and (while paused, so the sim
    // clock never re-triggers dueBySim) never gets picked up again.
    // Leaving the flag set means the very next non-in-flight frame retries.
    if (this.islComputeInFlight) return;
    this.islComputeInFlight = true;
    this.islForceRecompute = false;
    this.islLastRecomputeSimMs = simMs;
    this.islLastRecomputeRealMs = nowRealMs;

    const worker = this.ensureIslWorker();

    // Only re-send the settings payload when it actually changed identity
    // — otherwise every recompute (up to 5/s) would structured-clone
    // the full shellRanges/cost/linkModel payload for no reason.
    if (
      this.islLastConfiguredSettings !== settings ||
      this.islLastConfiguredShellRanges !== this.params.islShellRanges
    ) {
      const configureRequest: IslRoutingWorkerConfigureRequest = {
        id: 0,
        type: "configure",
        payload: buildIslWorkerSettingsPayload(settings, this.params.islShellRanges, endpointA, endpointB),
      };
      // Message order is preserved per worker, so this is guaranteed to be
      // applied before the "compute" posted right below it.
      worker.postMessage(configureRequest);
      this.islLastConfiguredSettings = settings;
      this.islLastConfiguredShellRanges = this.params.islShellRanges;
    }

    const requestId = ++this.islWorkerRequestId;
    const computeRequest: IslRoutingWorkerComputeRequest = {
      id: requestId,
      type: "compute",
      payload: {
        simDateIso: simDate.toISOString(),
        previousPathEdgeKeys: this.islPreviousPathEdgeKeys ?? undefined,
      },
    };
    worker.postMessage(computeRequest);
  }

  /** Lazily creates and initializes the ISL routing worker. */
  private ensureIslWorker(): Worker {
    if (this.islWorker) return this.islWorker;
    const worker = new Worker(new URL("../workers/islRoutingWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", this.handleIslWorkerMessage);
    const initRequest: IslRoutingWorkerInitRequest = {
      id: 0,
      type: "init",
      payload: { satellites: this.params.satellites },
    };
    worker.postMessage(initRequest);
    this.islWorker = worker;
    return worker;
  }

  private handleIslWorkerMessage = (event: MessageEvent<IslRoutingWorkerResponse>) => {
    const message = event.data;
    if (message.type === "ack" || message.type === "sweepResult") return; // the scene only issues "compute" requests

    if (message.id !== this.islWorkerRequestId) return; // superseded by a later request
    this.islComputeInFlight = false;

    if (message.type === "error") {
      console.error("ISL routing worker error:", message.message);
      this.params.onIslError?.(message.message);
      return;
    }
    this.params.onIslError?.(null);

    const result = message.payload.result;
    if (result.reachable) {
      this.islPreviousPathEdgeKeys = pathEdgeKeys(result.edges);
    }
    this.islLastResult = result;
    this.params.onIslResult?.(result);
    this.applyIslPathToScene(result);
  };

  /**
   * Grow the ISL path LineSegments buffers to fit `requiredSegments`, doubling
   * capacity as needed — a fixed cap that silently clamped longer paths
   * would misrender them, so the buffer grows instead.
   * The replaced attribute's GPU buffer is reclaimed lazily by the renderer's
   * WeakMap-keyed attribute cache once the old BufferAttribute is
   * unreferenced; not disposed eagerly here since three.js does not expose a
   * public per-attribute deallocation call. Bounded and rare in practice
   * (default settings keep paths well under 64 hops; a realistic re-grow
   * happens at most a handful of times per scene lifetime).
   */
  private ensureIslPathCapacity(requiredSegments: number) {
    if (requiredSegments <= this.islPathCapacitySegments) return;
    let capacity = this.islPathCapacitySegments;
    while (capacity < requiredSegments) capacity *= 2;
    this.islPathCapacitySegments = capacity;

    const maxVertices = capacity * 2;
    this.islPathPosAttr = new THREE.BufferAttribute(new Float32Array(maxVertices * 3), 3);
    this.islPathColorAttr = new THREE.BufferAttribute(new Float32Array(maxVertices * 3), 3);
    this.islPathGeometry.setAttribute("position", this.islPathPosAttr);
    this.islPathGeometry.setAttribute("color", this.islPathColorAttr);
    // The new color attribute starts zeroed — force a full rewrite.
    this.islColorsDirty = true;
  }

  private applyIslPathToScene(result: IslPathResult | null) {
    if (!result || !result.reachable || result.edges.length === 0) {
      this.islPathLines.visible = false;
      this.islPathGeometry.setDrawRange(0, 0);
      this.islColorsAppliedFor = null;
      return;
    }

    const segments = result.edges.length;
    this.ensureIslPathCapacity(segments);

    // Positions move every frame even when the edge list hasn't changed, so
    // they're always rewritten. Colors only depend on each edge's kind and
    // the two color settings, so re-writing (and re-uploading to the GPU)
    // every frame is wasted work outside of an actual new result or color
    // change — at most ~5/s, not 60/s.
    const rewriteColors = this.islColorsAppliedFor !== result || this.islColorsDirty;

    for (let s = 0; s < segments; s++) {
      const edge = result.edges[s];
      const fromPos = this.islNodeScenePosition(edge.fromNodeId, this.islScratchFrom);
      const toPos = this.islNodeScenePosition(edge.toNodeId, this.islScratchTo);
      const v0 = s * 2;
      const v1 = v0 + 1;
      const c = this.renderOrigin;
      this.islPathPosAttr.setXYZ(v0, fromPos.x - c.x, fromPos.y - c.y, fromPos.z - c.z);
      this.islPathPosAttr.setXYZ(v1, toPos.x - c.x, toPos.y - c.y, toPos.z - c.z);
      if (rewriteColors) {
        const color = edge.kind === "isl" ? this.islIslColor : this.islGslColor;
        this.islPathColorAttr.setXYZ(v0, color.r, color.g, color.b);
        this.islPathColorAttr.setXYZ(v1, color.r, color.g, color.b);
      }
    }
    this.islPathPosAttr.needsUpdate = true;
    if (rewriteColors) {
      this.islPathColorAttr.needsUpdate = true;
      this.islColorsAppliedFor = result;
      this.islColorsDirty = false;
    }
    this.islPathGeometry.setDrawRange(0, segments * 2);
    this.islPathLines.visible = true;
  }

  /** Insets (px) currently applied via the camera view offset. */
  private viewInset = { left: 0, bottom: 0, top: 0 };

  /**
   * Shift the rendered image so the globe stays centred in the area not
   * covered by the side panel (desktop, left) or bottom sheet (phones).
   * The panel publishes the covered size on <html data-view-inset-left /
   * data-sheet-inset>; eased here for a smooth slide.
   */
  /**
   * Screen areas covered by UI, from <html> data attributes: the side panel
   * on the left (`data-view-inset-left`), the phone sheet or a guided tour's
   * caption stack at the bottom (`data-sheet-inset`, `data-tour-inset-bottom`)
   * and a tour's title at the top (`data-tour-inset-top`). The projection is
   * shifted so the camera's centre of view is the middle of the uncovered area.
   */
  private updateViewInset() {
    const ds = document.documentElement.dataset;
    const target = {
      left: Number(ds.viewInsetLeft ?? 0) || 0,
      bottom: Math.max(Number(ds.sheetInset ?? 0) || 0, Number(ds.tourInsetBottom ?? 0) || 0),
      top: Number(ds.tourInsetTop ?? 0) || 0,
    };
    const cur = this.viewInset;
    if (
      Math.abs(target.left - cur.left) < 0.5 &&
      Math.abs(target.bottom - cur.bottom) < 0.5 &&
      Math.abs(target.top - cur.top) < 0.5
    ) return;
    const ease = (from: number, to: number) => {
      const next = from + (to - from) * 0.2;
      return Math.abs(to - next) < 0.5 ? to : next;
    };
    cur.left = ease(cur.left, target.left);
    cur.bottom = ease(cur.bottom, target.bottom);
    cur.top = ease(cur.top, target.top);
    this.applyViewOffset();
  }

  private applyViewOffset() {
    const { left, bottom, top } = this.viewInset;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (left === 0 && bottom === 0 && top === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -left / 2, (bottom - top) / 2, w, h);
  }

  /**
   * Half view angles (rad) of the area not covered by UI (see
   * updateViewInset): what a framing has to fit into.
   */
  private visibleHalfAngles(): { vHalf: number; hHalf: number } {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const { left, bottom, top } = this.viewInset;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const fracV = THREE.MathUtils.clamp((h - bottom - top) / h, 0.3, 1);
    const fracH = THREE.MathUtils.clamp((w - left) / w, 0.3, 1);
    return { vHalf: Math.atan(tanV * fracV), hHalf: Math.atan(tanH * fracH) };
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.updateViewInset();
    const nowReal = performance.now();
    const simDate = this.simulationClock.tick(nowReal, this.params.speedRef.current);
    this.currentSimDate = simDate;
    if (
      this.lastSimTimeNotificationMs === null ||
      Math.abs(simDate.getTime() - this.lastSimTimeNotificationMs) >= 1000
    ) {
      this.params.onSimTimeChange?.(simDate);
      this.lastSimTimeNotificationMs = simDate.getTime();
    }

    const rotAngle = satellite.gstime(simDate);
    this.earthGroup.rotation.y = rotAngle;
    this.graticule.rotation.y = rotAngle;
    this.kmlRenderer.updateRotation(rotAngle);
    this.trajectoryRenderer.update(simDate, rotAngle);
    const { x: sx, y: sy, z: sz } = sunVectorECI(simDate);
    const following = this.syncCameraHolder(simDate, rotAngle);
    this.updateRenderOrigin(simDate, following);
    // OrbitControls orbits in the holder's local frame, but Object3D.lookAt
    // reads `camera.up` in world space. Keep it on the holder's +Y so a tilted
    // (GSE) holder keeps ecliptic north up instead of re-rolling to ECI north.
    if (this.cameraMode === "free" && !following) {
      this.camera.up.copy(UP_AXIS).applyQuaternion(this.cameraHolder.quaternion);
    }

    this.sunlight.position.set(sx * 10, sz * 10, -sy * 10);
    this.sunDot.position.set(sx, sz, -sy);
    this.pointStyleUniforms.uSunDir.value.set(sx, sz, -sy).normalize();
    this.pointStyleUniforms.uTime.value = nowReal / 1000;
    this.pointStyleUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    for (const entry of this.earthAnimationBindings) {
      entry.sunDirectionUniform?.set(sx, sz, -sy);
    }

    const gmst = rotAngle;
    const observerGds = this.params.groundStations.map((gs) => ({
      longitude: satellite.degreesToRadians(gs.longitudeDeg),
      latitude: satellite.degreesToRadians(gs.latitudeDeg),
      height: gs.heightKm,
    }));
    const minElevationRads = this.params.groundStations.map((gs) =>
      THREE.MathUtils.degToRad(gs.minElevationDeg),
    );
    const gsEcis = observerGds.map((gd) => {
      const ecf = satellite.geodeticToEcf(gd);
      return satellite.ecfToEci(ecf, gmst);
    });
    // Reuse class-level temps; safe since updateCameraFollow runs after this loop
    const tmpQuat = this.tempQuaternionA;
    const tmpDir = this.tempVectorA;
    const halfAngleRad = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(this.params.fovConeHalfAngleDeg, 0.1, 89.5),
    );
    const sinHalfAngle = Math.sin(halfAngleRad);
    const cosHalfAngle = Math.cos(halfAngleRad);
    let hasSelectedSat = false;
    let hasSelectedVelocity = false;

    this.stationMeshes.forEach((m, idx) => {
      const p = gsEcis[idx];
      const stationPosition = new THREE.Vector3(
        p.x / EARTH_RADIUS_EQUATOR_KM,
        p.z / EARTH_RADIUS_POLAR_KM,
        -p.y / EARTH_RADIUS_EQUATOR_KM,
      );
      m.position.copy(stationPosition);
      const coneMesh = this.stationConeMeshes[idx];
      if (coneMesh) {
        if (this.params.showGroundStationCones) {
          coneMesh.visible = true;
          coneMesh.position.copy(stationPosition);
          tmpDir.copy(stationPosition).normalize().negate();
          if (tmpDir.lengthSq() > 0) {
            tmpQuat.setFromUnitVectors(UP_AXIS, tmpDir);
            coneMesh.setRotationFromQuaternion(tmpQuat);
          }
        } else {
          coneMesh.visible = false;
        }
      }
    });

    if (this.params.stationInfoRef && this.params.stationInfoRef.current && this.selectedStationIndex !== null) {
      const m = this.stationMeshes[this.selectedStationIndex];
      const v = m.position.clone().project(this.camera);
      const x = ((v.x + 1) / 2) * this.renderer.domElement.clientWidth;
      const y = ((-v.y + 1) / 2) * this.renderer.domElement.clientHeight;
      this.params.stationInfoRef.current.style.left = `${x}px`;
      this.params.stationInfoRef.current.style.top = `${y}px`;
    }

    const gsScene = gsEcis.map((p) => new THREE.Vector3(
      p.x / EARTH_RADIUS_EQUATOR_KM,
      p.z / EARTH_RADIUS_POLAR_KM,
      -p.y / EARTH_RADIUS_EQUATOR_KM,
    ));
    this.linkCount = 0;
    this.fovConeCount = 0;
    this.fovMissCount = 0;
    // One attitude context per frame per attitude group (null: 地球指向 → today's path).
    this.prepareFrameAttitudes(simDate);
    const satPosition = this.tempVectorB;

    const julianDate = satellite.jday(simDate);
    for (let i = 0; i < this.satRecs.length; i++) {
      const rec = this.satRecs[i];
      const pv = propagateAtJulianDate(rec, julianDate);
      if (pv?.position) {
        const { x, y, z } = pv.position;
        satPosition.set(
          x / EARTH_RADIUS_EQUATOR_KM,
          z / EARTH_RADIUS_POLAR_KM,
          -y / EARTH_RADIUS_EQUATOR_KM,
        );
        this.satPosAttr.setXYZ(i, satPosition.x, satPosition.y, satPosition.z);
        this.satEciPositions[i].x = x;
        this.satEciPositions[i].y = y;
        this.satEciPositions[i].z = z;
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        const groundEcf = satellite.geodeticToEcf({
          longitude: geo.longitude,
          latitude: geo.latitude,
          height: 0,
        });
        const groundEci = satellite.ecfToEci(groundEcf, gmst);
        this.groundPosAttr.setXYZ(
          i,
          groundEci.x / EARTH_RADIUS_EQUATOR_KM,
          groundEci.z / EARTH_RADIUS_POLAR_KM,
          -groundEci.y / EARTH_RADIUS_EQUATOR_KM,
        );

        const satEcf = satellite.eciToEcf(pv.position, gmst);
        let anyVisible = false;
        for (let gi = 0; gi < observerGds.length; gi++) {
          const look = satellite.ecfToLookAngles(observerGds[gi], satEcf);
          // Visibility is determined solely by elevation angle to support satellites at any altitude
          if (look.elevation > minElevationRads[gi]) {
            anyVisible = true;
            this.pushLink(gsScene[gi], satPosition);
          }
        }
        if (this.selectedIndex === i) {
          this.cacheSelectedState(satPosition, pv.velocity ?? null);
          hasSelectedSat = true;
          hasSelectedVelocity = !!pv.velocity;
          this.satColorAttr.setXYZ(i, this.satelliteSelectedColor.r, this.satelliteSelectedColor.g, this.satelliteSelectedColor.b);
        } else if (anyVisible) {
          this.satColorAttr.setXYZ(i, this.satelliteVisibleColor.r, this.satelliteVisibleColor.g, this.satelliteVisibleColor.b);
        } else {
          this.satColorAttr.setXYZ(i, this.satelliteHiddenColor.r, this.satelliteHiddenColor.g, this.satelliteHiddenColor.b);
        }

        if (this.params.showSatelliteFovCones) {
          this.pushFovCone(i, pv.position, pv.velocity ?? null, satPosition, sinHalfAngle, cosHalfAngle);
        }
      } else {
        // Propagation failed: explicitly mark satellite as hidden (no link, no cone).
        // (The ISL routing worker re-propagates independently and applies the
        // same failed-propagation exclusion on its own copy of the satrecs.)
        this.satColorAttr.setXYZ(i, this.satelliteHiddenColor.r, this.satelliteHiddenColor.g, this.satelliteHiddenColor.b);
      }
    }

    if (this.massLayer || this.catalogLayer) {
      const simMs = simDate.getTime();
      const stations = this.massStations(gmst, gsEcis);
      this.renderer.getDrawingBufferSize(this.drawingBufferSize);
      const pointScale = this.drawingBufferSize.y / 2;
      if (this.massLayer) this.updateMassLayer(simMs, stations, pointScale, gsScene, sinHalfAngle, cosHalfAngle);
      this.catalogLayer?.update(simMs, stations, pointScale);
    }

    // GPU-drawn selection (mass-mode editor satellite or catalog row): only
    // the selected satellite is propagated on the CPU. Catalog rows are
    // display-only, so they get no FOV cone.
    const selected = this.selectedIndex;
    if (selected !== null && (this.massLayer || selected >= this.satCount)) {
      const st = this.propagateIndex(selected, simDate);
      if (st) {
        satPosition.set(
          st.position.x / EARTH_RADIUS_EQUATOR_KM,
          st.position.z / EARTH_RADIUS_POLAR_KM,
          -st.position.y / EARTH_RADIUS_EQUATOR_KM,
        );
        this.cacheSelectedState(satPosition, st.velocity);
        hasSelectedSat = true;
        hasSelectedVelocity = !!st.velocity;
        if (this.params.showSatelliteFovCones && selected < this.satCount) {
          this.pushFovCone(selected, st.position, st.velocity, satPosition, sinHalfAngle, cosHalfAngle);
        }
      }
    }

    this.linkGeometry.setDrawRange(0, this.linkCount * 2);
    (this.linkGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    this.fovCones.count = this.fovConeCount;
    this.fovCones.instanceMatrix.needsUpdate = true;
    this.fovMissCones.count = this.fovMissCount;
    if (this.fovMissCount > 0) this.fovMissCones.instanceMatrix.needsUpdate = true;
    this.fovMissBoresightGeometry.setDrawRange(0, this.fovMissCount * 2);
    if (this.fovMissCount > 0) {
      this.fovMissBoresightGeometry.getAttribute("position").needsUpdate = true;
      this.fovMissBoresightGeometry.getAttribute("lineDistance").needsUpdate = true;
    }

    if (this.satRecs.length > 0) {
      this.satPosAttr.needsUpdate = true;
      this.satColorAttr.needsUpdate = true;
      this.groundPosAttr.needsUpdate = true;
      this.satGeometry.computeBoundingSphere();
      this.groundGeometry.computeBoundingSphere();
    }

    this.updateGroundTrack(gmst);
    this.updateIslMarkersAndPath(simDate, gmst, nowReal);

    if (this.params.timeRef.current) this.params.timeRef.current.textContent = this.formatTime(simDate);

    this.updateCameraFollow(hasSelectedSat, hasSelectedVelocity);
    const riding = following && this.updateRide(simDate.getTime(), nowReal);
    if (this.cameraMode === "free" && !following && this.globeChaseId !== null) this.updateGlobeChase(simDate, nowReal);
    if (this.cameraMode === "free" || this.cameraMode === "closeUp") {
      this.controls.update();
    }
    this.applyGroundClearance(riding);
    if (riding) this.finishRideFrame();
    else this.updateFreeCameraRange();
    this.updateRideStationMarkers(riding);
    this.updateSatelliteVehicle(simDate, riding);
    this.updateCloseUpOrbit(simDate, riding);
    if (this.focusedTrajectoryTrack !== this.trajectoryFollowId) {
      this.focusedTrajectoryTrack = this.trajectoryFollowId;
      this.trajectoryRenderer.setFocusedTrack(this.trajectoryFollowId);
    }
    this.updateLaunchSiteImagery(rotAngle, nowReal);
    const hidden = this.hidePresentationScenario();
    this.renderer.render(this.scene, this.camera);
    if (hidden) this.restorePresentationScenario();
    // Vehicle models: a second, camera-relative metre-scale pass with its own
    // depth (early-outs when there is nothing to draw).
    this.trajectoryRenderer.renderVehicles(this.renderer, this.camera, simDate, rotAngle);
  };

  /**
   * Presentation mode: take every scenario object out of this frame's render
   * (only the globe group, its overlays, lights, the camera and the
   * trajectory layer stay). Visibility is restored right after the render,
   * so the per-frame code that owns each object's visibility is untouched.
   */
  private hidePresentationScenario(): boolean {
    if (!this.params.presentation) return false;
    const keep = (this.presentationKeep ??= new Set<THREE.Object3D>([
      this.cameraHolder,
      this.ambientLight,
      this.sunlight,
      this.earthGroup,
      this.graticule,
      this.ecliptic,
      this.geoOrbit,
      this.sunDot,
      this.trajectoryRenderer.getRootObject(),
    ]));
    const hidden = this.presentationHidden;
    hidden.length = 0;
    for (const child of this.scene.children) {
      if (keep.has(child) || !child.visible) continue;
      child.visible = false;
      hidden.push(child);
    }
    return hidden.length > 0;
  }

  private restorePresentationScenario() {
    for (const child of this.presentationHidden) child.visible = true;
    this.presentationHidden.length = 0;
  }

  /**
   * Per-frame ride-along camera, before OrbitControls.update(): fetch the
   * subject's state at `simMs` in camera-holder coordinates, move the orbit
   * target onto it and translate the camera by the same amount — no lag.
   *   - trajectory (追従): Earth-fixed holder, state from the track (clamped
   *     into its span, so a seek just before lift-off holds on the pad);
   *   - satellite (近接): LVLH holder set in {@link syncCameraHolder} from this
   *     frame's state, so the satellite sits still at (0, r, 0) and the Earth
   *     turns below.
   * The camera's offset is carried along with the local vertical so its view
   * of the horizon stays put. Returns false (and ends the ride) when the
   * subject is gone.
   */
  private updateRide(simMs: number, nowReal: number): boolean {
    const ride = this.ride;
    if (ride === null) return false;
    const pos = this.ridePos;
    const vel = this.rideVel;
    let lengthM: number;
    let maxDistance: number;
    let track: TrajectoryTrack | null = null;
    let t = simMs;
    if (ride.kind === "trajectory") {
      track = this.trajectoryTracks.find((tr) => tr.id === ride.id) ?? null;
      if (!track || !track.visible || track.samples.length === 0) {
        this.endTrajectoryFollow(true);
        return false;
      }
      const first = track.samples[0].timeMs;
      const last = track.samples[track.samples.length - 1].timeMs;
      t = Math.min(Math.max(simMs, first), last);
      // Not drawable (e.g. a degenerate track the renderer skipped): hold the
      // camera where it is rather than dropping the follow on a transient.
      if (!this.trajectoryRenderer.localStateAt(ride.id, t, pos, vel)) return true;
      if (t !== simMs) vel.set(0, 0, 0);
      lengthM = Math.max(this.trajectoryRenderer.vehicleLengthM(ride.id), 1);
      maxDistance = TRAJECTORY_FOLLOW_MAX_DISTANCE;
    } else {
      if (!this.rideSatValid) return true;
      // World → holder-local (the holder is the satellite's LVLH frame).
      this.tempQuaternionA.copy(this.cameraHolder.quaternion).invert();
      pos.copy(this.rideSatWorld).applyQuaternion(this.tempQuaternionA);
      vel.copy(this.rideSatWorldVel).applyQuaternion(this.tempQuaternionA);
      lengthM = Math.max(this.trajectoryRenderer.satelliteVehicleLengthM(this.satelliteModel()), 1);
      maxDistance = SATELLITE_FOLLOW_MAX_DISTANCE;
    }
    if (pos.lengthSq() < 1e-12) return true;
    // Tour framing (setTrajectoryFollowFraming): eased target lift, companion
    // track kept in frame, distance goal.
    let fitDistance = 0;
    let alpha = 1;
    if (ride.kind === "trajectory") {
      const dtS = this.rideLastRealMs === null ? 0 : Math.min(0.5, (nowReal - this.rideLastRealMs) / 1000);
      alpha = this.rideNeedsFraming || this.rideTransitionS <= 0 ? 1 : 1 - Math.exp(-dtS / this.rideTransitionS);
      this.rideLastRealMs = nowReal;
      const includeId = this.rideIncludeId;
      const other = includeId !== null ? this.trajectoryTracks.find((tr) => tr.id === includeId) : undefined;
      if (other && other.visible && other.samples.length > 0) {
        const t2 = Math.min(Math.max(simMs, other.samples[0].timeMs), other.samples[other.samples.length - 1].timeMs);
        if (this.trajectoryRenderer.localStateAt(other.id, t2, this.rideIncludePos, this.rideIncludeVel)) {
          const separation = pos.distanceTo(this.rideIncludePos);
          pos.add(this.rideIncludePos).multiplyScalar(0.5);
          const { vHalf, hHalf } = this.visibleHalfAngles();
          const halfFov = Math.min(vHalf, hHalf);
          fitDistance = (0.5 * separation * 1.4) / Math.tan(Math.max(halfFov, 0.05));
        }
      }
      this.rideTargetUpM += (this.rideTargetUpGoalM - this.rideTargetUpM) * alpha;
      if (this.rideTargetUpM !== 0) {
        pos.addScaledVector(this.tempVectorC.copy(pos).normalize(), this.rideTargetUpM * SCENE_UNITS_PER_M);
      }
    }
    const up = this.rideUp.copy(pos).normalize();
    const length = lengthM * SCENE_UNITS_PER_M;
    this.controls.minDistance = TRAJECTORY_FOLLOW_MIN_LENGTHS * length;
    this.controls.maxDistance = Math.max(maxDistance, 10 * length);
    // The zoom range spans ~5 decades (metres to a regional view): faster
    // wheel/pinch steps so it does not take hundreds of notches.
    this.controls.zoomSpeed = TRAJECTORY_FOLLOW_ZOOM_SPEED;

    const offset = this.tempVectorD;
    if (this.rideNeedsFraming) {
      this.rideNeedsFraming = false;
      const resume = this.pendingRideOffset;
      this.pendingRideOffset = null;
      if (resume) {
        // Rebuilt mid-ride: the offset from before, carried to today's vertical.
        offset.fromArray(resume.offset);
        this.tempQuaternionB.setFromUnitVectors(this.tempVectorC.fromArray(resume.up).normalize(), up);
        offset.applyQuaternion(this.tempQuaternionB);
        offset.setLength(THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance));
      } else {
        if (track) this.trajectoryFollowDirection(track, t, up, vel, offset);
        else this.satelliteFollowDirection(up, vel, offset);
        const goal = this.rideDistanceGoalM !== null ? this.rideDistanceGoalM * SCENE_UNITS_PER_M : TRAJECTORY_FOLLOW_START_LENGTHS * length;
        offset.multiplyScalar(Math.max(goal, fitDistance));
        this.rideDistanceGoalM = null;
      }
      this.controls.enabled = true;
    } else {
      offset.subVectors(this.camera.position, this.controls.target);
      this.tempQuaternionB.setFromUnitVectors(this.ridePrevUp, up);
      offset.applyQuaternion(this.tempQuaternionB);
      // Ease toward the framing's distance goal (then release the zoom), and
      // never closer than what keeps the companion track in frame.
      const current = offset.length();
      let goal = this.rideDistanceGoalM !== null ? this.rideDistanceGoalM * SCENE_UNITS_PER_M : current;
      if (fitDistance > goal) goal = fitDistance;
      if (current > 0 && goal !== current) {
        const next = current + (goal - current) * alpha;
        offset.setLength(next);
        if (this.rideDistanceGoalM !== null && Math.abs(next - goal) <= 0.005 * goal) this.rideDistanceGoalM = null;
      }
    }
    this.ridePrevUp.copy(up);
    this.controls.target.copy(pos);
    this.camera.position.copy(pos).add(offset);
    // Near the ground keep the camera above the vehicle's local horizontal
    // plane, so orbiting does not dive under the globe; high up, any angle.
    const altitude = pos.length() - 1;
    this.controls.maxPolarAngle = altitude > 3 * offset.length() ? Math.PI : Math.PI / 2;
    this.setOrbitControlsUp(up);
    return true;
  }

  /**
   * Unit direction from the vehicle to the initial camera: horizontal and
   * perpendicular to the flight direction (ascent and return seen in
   * profile, not straight down), raised slightly above the local horizon.
   */
  private trajectoryFollowDirection(
    track: TrajectoryTrack,
    t: number,
    up: THREE.Vector3,
    vel: THREE.Vector3,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const downrange = this.tempVectorB.copy(vel).addScaledVector(up, -vel.dot(up));
    if (downrange.lengthSq() < TRAJECTORY_FOLLOW_MIN_HORIZONTAL_SPEED_SQ) {
      // Vertical lift-off or a hold on the pad: use where the track goes.
      const first = track.samples[0].timeMs;
      const last = track.samples[track.samples.length - 1].timeMs;
      const later = this.tempVectorC;
      const here = this.tempVectorA;
      if (
        this.trajectoryRenderer.localStateAt(track.id, Math.min(last, Math.max(t, first) + 120_000), later, out) &&
        this.trajectoryRenderer.localStateAt(track.id, t, here, out)
      ) {
        downrange.subVectors(later, here);
        downrange.addScaledVector(up, -downrange.dot(up));
      }
    }
    if (downrange.lengthSq() < 1e-20) {
      // Still nothing: due east (the scene's +Y is the Earth's axis).
      downrange.crossVectors(UP_AXIS, up);
      if (downrange.lengthSq() < 1e-12) downrange.set(1, 0, 0);
    }
    downrange.normalize();
    const side = this.tempVectorC.crossVectors(up, downrange).normalize();
    return out
      .copy(side)
      .multiplyScalar(Math.cos(TRAJECTORY_FOLLOW_START_ELEVATION))
      .addScaledVector(up, Math.sin(TRAJECTORY_FOLLOW_START_ELEVATION))
      .normalize();
  }

  /**
   * 近接 initial camera direction (unit, holder-local): behind the satellite
   * (against the along-track direction), raised above its local horizontal
   * and turned a little to the side so the bus is seen obliquely with the
   * Earth below.
   */
  private satelliteFollowDirection(up: THREE.Vector3, vel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const along = this.tempVectorB.copy(vel).addScaledVector(up, -vel.dot(up));
    if (along.lengthSq() < 1e-20) along.crossVectors(UP_AXIS, up);
    if (along.lengthSq() < 1e-20) along.set(1, 0, 0);
    along.normalize();
    const side = this.tempVectorC.crossVectors(along, up).normalize();
    const el = SATELLITE_FOLLOW_START_ELEVATION;
    const az = SATELLITE_FOLLOW_START_AZIMUTH;
    return out
      .copy(along)
      .multiplyScalar(-Math.cos(el) * Math.cos(az))
      .addScaledVector(side, Math.cos(el) * Math.sin(az))
      .addScaledVector(up, Math.sin(el))
      .normalize();
  }

  /**
   * OrbitControls caches the rotation from `object.up` to +Y at construction
   * (`_quat` / `_quatInverse`, three r186) and orbits about that axis. Point
   * it at the holder-local vertical `up` while following; identity restores
   * the default (+Y) behaviour.
   */
  private setOrbitControlsUp(up: THREE.Vector3) {
    const internals = this.controls as unknown as { _quat?: THREE.Quaternion; _quatInverse?: THREE.Quaternion };
    if (!internals._quat || !internals._quatInverse) return;
    internals._quat.setFromUnitVectors(up, UP_AXIS);
    internals._quatInverse.copy(internals._quat).invert();
  }

  /**
   * After OrbitControls.update() while riding: re-aim the camera (its
   * lookAt reads the target as a world point and camera.up in world space;
   * both are holder-local here), then fit the near plane and the thin Earth
   * shells to the close range.
   */
  private finishRideFrame() {
    const target = this.controls.target;
    const up = this.rideUp;
    this.tempMatrix.lookAt(this.camera.position, target, up);
    this.camera.quaternion.setFromRotationMatrix(this.tempMatrix);
    this.camera.up.copy(up).applyQuaternion(this.cameraHolder.quaternion);

    // Near plane: well inside the camera–vehicle distance (models are drawn
    // in their own pass, so this only has to keep trails and the globe), but
    // no smaller than needed to resolve the 0.0005-radius border shell out
    // at the horizon: depth resolution there is ≈ h²/(near·2²⁴) with
    // h² = |cam|² − 1. Far stays 1000: with far ≫ near the resolution does
    // not depend on far, so shrinking it would buy nothing.
    const distance = this.camera.position.distanceTo(target);
    const horizonSq = Math.max(this.camera.position.lengthSq() - 1, 0);
    // Also never beyond half the camera's height above the ground (after the
    // clearance step), so the surface right below is not clipped either.
    const near = THREE.MathUtils.clamp(
      Math.min(Math.max(0.2 * distance, horizonSq / 2000), 0.5 * distance, 0.5 * this.cameraHeight),
      1e-7,
      DEFAULT_CAMERA_NEAR,
    );
    this.setCameraNear(near);
    this.setSurfaceShellDepthBias(true);
    this.updateCloseRangeGlobe();
  }

  /**
   * Clouds and globe detail for a camera close to the ground (rides and the
   * free camera): below the cloud shell its double-sided sphere would roof
   * the sky; low over the ground the 128-segment facets (~2 km sag) show, so
   * the detailed globe is used there (hysteresis, so it is not rebuilt on
   * every wobble).
   */
  private updateCloseRangeGlobe() {
    const radius = this.camera.position.length();
    this.setCloudsVisible(this.params.showClouds && radius > CLOUD_SHELL_SCALE + 0.0005);
    const cameraAltitude = radius - 1;
    const detailed = this.earthDetailed
      ? cameraAltitude < EARTH_DETAIL_EXIT_ALTITUDE
      : cameraAltitude < EARTH_DETAIL_ENTER_ALTITUDE;
    if (detailed || this.earthDetailed) this.setEarthDetailed(detailed);
    this.earthDetailed = detailed;
  }

  /** Camera height above the drawn globe after this frame's clearance step (scene units). */
  private cameraHeight = Number.POSITIVE_INFINITY;

  /**
   * Ground clearance for every camera mode, after the controls / ride /
   * follow have moved the camera and before anything is aimed or drawn:
   * if the camera is closer to the drawn globe (ellipsoid, scene +Y polar)
   * than the minimum — max(50 m, 2 % of the target distance) while riding,
   * 1 km otherwise — it is pushed radially outward. The holder only rotates
   * about the Earth's centre, so scaling the holder-local position is the
   * same radial push in world space. OrbitControls re-reads the camera
   * position on its next update, so nothing fights it; the free camera is
   * re-aimed here, rides are re-aimed by finishRideFrame.
   */
  private applyGroundClearance(riding: boolean) {
    const world = this.tempVectorA.copy(this.camera.position).applyQuaternion(this.cameraHolder.quaternion);
    const minHeight = riding
      ? rideMinHeight(this.camera.position.distanceTo(this.controls.target), 1 / SCENE_UNITS_PER_M)
      : FREE_CAMERA_MIN_HEIGHT;
    const k = groundClearanceScale(world, minHeight);
    if (k !== 1) {
      this.camera.position.multiplyScalar(k);
      world.multiplyScalar(k);
      if (!riding && this.cameraMode === "free") {
        this.camera.lookAt(this.cameraHolder.localToWorld(this.tempVectorB.copy(this.controls.target)));
      }
    }
    this.cameraHeight = heightAboveGlobe(world);
  }

  /**
   * Outside rides: near plane from the camera's height (a close zoom never
   * clips the surface; 0.1 at the default whole-globe view), zoom speed
   * scaled with the height for the free camera, thin globe shells biased
   * toward the camera once the near plane is small, and the close-range
   * globe (clouds / detail).
   */
  private updateFreeCameraRange() {
    const radius = this.camera.position.length();
    const near = freeCameraNear(this.cameraHeight, radius);
    this.setCameraNear(near);
    this.setSurfaceShellDepthBias(near < DEFAULT_CAMERA_NEAR * 0.5);
    if (this.cameraMode === "free") this.controls.zoomSpeed = freeCameraZoomSpeed(this.cameraHeight, radius);
    this.updateCloseRangeGlobe();
  }

  /**
   * While riding, hide ground-station markers (64 km spheres) and their
   * cones within {@link RIDE_STATION_HIDE_DISTANCE} of the camera, so a
   * station at the launch site does not swallow the view. Station meshes
   * are scene children (world space); the camera is holder-local.
   */
  private updateRideStationMarkers(riding: boolean) {
    if (!riding) {
      if (!this.rideStationsHidden) return;
      this.rideStationsHidden = false;
      for (const mesh of this.stationMeshes) mesh.visible = true;
      // The per-frame station loop restores the cones' own visibility.
      return;
    }
    const cameraWorld = this.tempVectorA.copy(this.camera.position).applyMatrix4(this.cameraHolder.matrixWorld);
    const limitSq = RIDE_STATION_HIDE_DISTANCE * RIDE_STATION_HIDE_DISTANCE;
    let anyHidden = false;
    this.stationMeshes.forEach((mesh, idx) => {
      const near = mesh.position.distanceToSquared(cameraWorld) < limitSq;
      mesh.visible = !near;
      if (near) {
        anyHidden = true;
        const cone = this.stationConeMeshes[idx];
        if (cone) cone.visible = false;
      }
    });
    this.rideStationsHidden = anyHidden;
  }

  private setCameraNear(near: number) {
    if (Math.abs(this.camera.near - near) <= near * 0.02) return;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Pull the thin overlays drawn on the globe (country borders, night
   * lights) a few depth steps toward the camera, so they keep winning the
   * depth test against the surface under the tiny near plane of the ride-along
   * camera. Unchanged outside it.
   */
  private setSurfaceShellDepthBias(on: boolean) {
    if (!on && !this.rideShellsBiased) return;
    this.rideShellsBiased = on;
    for (const child of this.earthGroup.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      const scale = mesh.scale.x;
      if (scale <= 1 || scale > SURFACE_SHELL_MAX_SCALE) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.polygonOffset = on;
        material.polygonOffsetFactor = on ? -1 : 0;
        material.polygonOffsetUnits = on ? -4 : 0;
      }
    }
  }

  /**
   * Orient the camera holder for this frame: Earth-fixed while following a
   * trajectory (the holder then matches the trajectory overlay group exactly,
   * same rotation.y about the origin, so overlay-local positions are
   * holder-local positions); the selected satellite's LVLH frame in 近接
   * (+X along-track, +Y radial up, propagated here at `simDate` so the ride
   * has no one-frame lag); else the free-camera view frame (ECI / ECEF /
   * GSE), else ECI for the other satellite camera modes. Returns whether a
   * ride (trajectory follow or 近接) is active. 近接 without a usable
   * selected editor satellite is dropped here (onCloseUpEnd).
   */
  private syncCameraHolder(simDate: Date, rotAngle: number): boolean {
    if (this.ride?.kind === "satellite" && this.cameraMode === "closeUp") {
      if (this.updateSatelliteRideState(simDate)) {
        const radial = this.tempVectorA.copy(this.rideSatWorld).normalize();
        const along = this.tempVectorB.copy(this.rideSatWorldVel).addScaledVector(radial, -this.rideSatWorldVel.dot(radial));
        if (along.lengthSq() > 1e-24) {
          along.normalize();
          const third = this.tempVectorC.crossVectors(along, radial);
          this.tempMatrix.makeBasis(along, radial, third);
          this.cameraHolder.quaternion.setFromRotationMatrix(this.tempMatrix);
        }
        this.cameraHolder.updateMatrixWorld();
        return true;
      }
      this.dropCloseUp();
    }
    const following = this.trajectoryFollowId !== null && this.cameraMode === "free";
    const frame = following
      ? "ecef"
      : this.cameraMode === "free"
        ? (this.params.presentation ? "eci" : this.params.viewFrame)
        : "eci";
    if (frame === "gse") {
      const { x: sx, y: sy, z: sz } = sunVectorECI(simDate);
      this.setSunFixedHolder(sx, sz, -sy);
    } else {
      this.cameraHolder.rotation.set(0, frame === "ecef" ? rotAngle : 0, 0);
    }
    this.cameraHolder.updateMatrixWorld();
    return following;
  }

  /**
   * 近接: propagate the selected editor satellite at `simDate` with the
   * propagator that draws it (SGP4, or the GPU layer's J2 twin in mass mode).
   * False without a selected editor satellite or a velocity.
   */
  private updateSatelliteRideState(simDate: Date): boolean {
    this.rideSatValid = false;
    const sel = this.selectedIndex;
    if (sel === null || sel >= this.satCount) return false;
    const st = this.propagateIndex(sel, simDate);
    if (!st || !st.velocity) return false;
    const p = st.position;
    const v = st.velocity;
    if (![p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite)) return false;
    this.rideSatEciPos.x = p.x; this.rideSatEciPos.y = p.y; this.rideSatEciPos.z = p.z;
    this.rideSatEciVel.x = v.x; this.rideSatEciVel.y = v.y; this.rideSatEciVel.z = v.z;
    // Same mapping as the drawn point (x/Re, z/Rp, −y/Re); velocity in scene units per second.
    this.rideSatWorld.set(p.x / EARTH_RADIUS_EQUATOR_KM, p.z / EARTH_RADIUS_POLAR_KM, -p.y / EARTH_RADIUS_EQUATOR_KM);
    this.rideSatWorldVel.set(v.x / EARTH_RADIUS_EQUATOR_KM, v.z / EARTH_RADIUS_POLAR_KM, -v.y / EARTH_RADIUS_EQUATOR_KM);
    this.rideSatValid = true;
    return true;
  }

  /** Leave 近接 on the scene's own initiative: back to the free framing, and tell the app. */
  private dropCloseUp() {
    this.endRide(false, true);
    this.params.onCloseUpEnd?.();
    this.params.onCameraChange?.(this.getCameraSnapshot());
  }

  /** End a trajectory follow (no-op otherwise); `notify` fires onTrajectoryFollowEnd. */
  private endTrajectoryFollow(notify: boolean) {
    if (this.ride?.kind !== "trajectory") return;
    this.endRide(false, this.cameraMode === "free");
    if (notify) this.params.onTrajectoryFollowEnd?.();
  }

  /**
   * Stop the ride (no-op when not riding): restore the near plane, zoom
   * limits, OrbitControls' up axis, clouds, shell depth bias and the selected
   * dot. With `restore`, switch to the free camera and put back the framing
   * from before the ride (in the free view frame).
   */
  private endRide(_notify: boolean, restore: boolean) {
    if (this.ride === null) return;
    this.ride = null;
    this.rideNeedsFraming = false;
    this.pendingRideOffset = null;
    this.rideSatValid = false;
    this.resetRideFraming();
    const back = this.rideReturn;
    this.rideReturn = null;
    this.setOrbitControlsUp(UP_AXIS);
    this.controls.minDistance = FREE_CAMERA_MIN_DISTANCE;
    this.controls.maxDistance = 30;
    this.controls.zoomSpeed = 1;
    this.controls.maxPolarAngle = Math.PI;
    this.setCameraNear(DEFAULT_CAMERA_NEAR);
    this.setCloudsVisible(this.params.showClouds);
    this.setSurfaceShellDepthBias(false);
    if (this.earthDetailed) {
      this.earthDetailed = false;
      this.setEarthDetailed(false);
    }
    this.closeUpDotGraceFrames = 0;
    this.setSelectedDotHidden(false);
    this.trajectoryRenderer.setSatelliteVehicle(null);
    if (restore) {
      this.cameraMode = "free";
      // Re-orient the holder to the free view frame first, so the framing is
      // applied in the frame the next frame renders with.
      this.syncCameraHolder(this.currentSimDate, satellite.gstime(this.currentSimDate));
      if (back && back.mode === "free" && isFiniteCameraSnapshot(back)) this.applyCameraSnapshot(back);
      else this.resetFreeCamera();
    }
  }

  // --- 近接: satellite model, attitude overlays, attitude cones ---------------

  /**
   * Global attitude setting of the editor satellites (通信タブ; defaults when unset).
   */
  private attitudeSettings(): SatelliteAttitudeSettings {
    return this.params.satelliteAttitude ?? DEFAULT_SATELLITE_ATTITUDE;
  }

  /** (Re)bucket the editor satellites by resolved attitude when the global setting changed. */
  private ensureAttitudeGroups() {
    const global = this.attitudeSettings();
    if (global === this.attitudeGroupsGlobal) return;
    this.attitudeGroupsGlobal = global;
    this.attitudeGroups = [global];
    this.satAttitudeGroup = null;
    const specs = this.params.satellites;
    const keys = new Map<string, number>([[attitudeSettingsKey(global), 0]]);
    for (let i = 0; i < specs.length; i++) {
      const resolved = resolveSatelliteAttitude(specs[i], global);
      if (resolved === global) continue;
      const key = attitudeSettingsKey(resolved);
      let group = keys.get(key);
      if (group === undefined) {
        group = this.attitudeGroups.length;
        keys.set(key, group);
        this.attitudeGroups.push(resolved);
      }
      if (group === 0) continue;
      this.satAttitudeGroup ??= new Uint32Array(specs.length);
      this.satAttitudeGroup[i] = group;
    }
  }

  /** Resolved attitude settings of editor satellite `index`. */
  private satelliteAttitudeSettings(index: number): SatelliteAttitudeSettings {
    this.ensureAttitudeGroups();
    return this.attitudeGroups[this.satAttitudeGroup?.[index] ?? 0];
  }

  /**
   * Attitude context for one settings group at `simDate`; null keeps
   * today's exact 地球指向 cone (plain LVLH, or a 地上局指向 whose station is
   * gone, without a schedule).
   */
  private attitudeContext(simDate: Date, settings: SatelliteAttitudeSettings): AttitudeTimeContext | null {
    if (isPlainLvlhAttitude(settings, this.params.groundStations)) return null;
    const ctx = prepareAttitudeContext(simDate, settings, this.params.groundStations);
    return isPlainLvlhContext(ctx) ? null : ctx;
  }

  /**
   * Past states of editor satellite `index` for the slew limit, from the
   * propagator that draws it (SGP4, or the GPU layer's J2 twin). Fresh
   * objects: the layers' stateAt reuses its scratch.
   */
  private attitudeStateProvider(index: number): AttitudeStateProvider {
    let provider = this.attitudeStateProviders.get(index);
    if (!provider) {
      provider = (ms) => {
        const st = this.propagateIndex(index, new Date(ms));
        if (!st?.velocity) return null;
        const { position: p, velocity: v } = st;
        return { position: { x: p.x, y: p.y, z: p.z }, velocity: { x: v.x, y: v.y, z: v.z } };
      };
      this.attitudeStateProviders.set(index, provider);
    }
    return provider;
  }

  /** Per-frame attitude contexts of every group for the FOV cones (empty when cones are off). */
  private prepareFrameAttitudes(simDate: Date) {
    this.frameAttitudes.length = 0;
    if (!this.params.showSatelliteFovCones) return;
    this.ensureAttitudeGroups();
    for (const settings of this.attitudeGroups) this.frameAttitudes.push(this.attitudeContext(simDate, settings));
  }

  /**
   * After the camera is final: hand the selected satellite's model state to
   * the vehicle pass while in 近接 (attitude, 1軸追尾 drive, overlays), else
   * clear it. Hides the selected dot once the model covers it.
   */
  private satelliteModel(): string {
    return this.params.satelliteModel || DEFAULT_SATELLITE_MODEL;
  }

  private updateSatelliteVehicle(simDate: Date, riding: boolean) {
    if (!riding || this.ride?.kind !== "satellite" || !this.rideSatValid) {
      this.trajectoryRenderer.setSatelliteVehicle(null);
      // Still entering 近接 (no propagated state yet): keep the dot hidden.
      const entering = this.ride?.kind === "satellite" && this.closeUpDotGraceFrames > 0;
      if (entering) this.closeUpDotGraceFrames--;
      this.setSelectedDotHidden(entering);
      return;
    }
    // rideSatValid implies an editor satellite is selected.
    const index = this.selectedIndex!;
    const settings = this.satelliteAttitudeSettings(index);
    const ctx = prepareAttitudeContext(simDate, settings, this.params.groundStations);
    const q = satelliteAttitudeFromContext(
      this.rideSatEciPos,
      this.rideSatEciVel,
      ctx,
      this.attitudeQuat,
      this.attitudeStateProvider(index),
    );
    const bodyToWorld = bodyToWorldQuaternion(q, 0, this.rideBodyToWorld);
    const sun = sunVectorECI(simDate);
    const sunNorm = Math.hypot(sun.x, sun.y, sun.z) || 1;
    const sunUnit = { x: sun.x / sunNorm, y: sun.y / sunNorm, z: sun.z / sunNorm };
    const { driveAngleRad } = solarArrayIncidence(q, sunUnit, this.params.solarArrayType ?? DEFAULT_SOLAR_ARRAY_TYPE);
    const w = this.rideSatWorld;
    const r = w.length() || 1;
    const state: SatelliteVehicleState = {
      model: this.satelliteModel(),
      x: w.x,
      y: w.y,
      z: w.z,
      bodyToWorld,
      driveAngleRad,
      up: { x: w.x / r, y: w.y / r, z: w.z / r },
      showAxes: this.params.showBodyAxes === true,
      // ECI (x, y, z) → world (x, z, −y).
      sunDirection: this.params.showBodySunDirection ? { x: sunUnit.x, y: sunUnit.z, z: -sunUnit.y } : null,
    };
    this.trajectoryRenderer.setSatelliteVehicle(state);
    // Last frame's size decides (one-frame lag, as for trajectory markers);
    // right after entering, hide regardless until the model has been measured.
    const covers = this.trajectoryRenderer.satelliteVehicleCoversMarker();
    if (covers) this.closeUpDotGraceFrames = 0;
    else if (this.closeUpDotGraceFrames > 0) this.closeUpDotGraceFrames--;
    this.setSelectedDotHidden(covers || this.closeUpDotGraceFrames > 0);
  }

  /**
   * Hide the selected satellite's dot (CPU points: a shader uniform; GPU
   * layer: its selected size) while the 近接 model replaces it. A world-size
   * dot ~100 km across would otherwise fill the view metres from the camera.
   */
  private setSelectedDotHidden(hidden: boolean) {
    if (hidden === this.selectedDotHidden) return;
    this.selectedDotHidden = hidden;
    this.cpuHideSelectedUniform.value = hidden ? 1 : 0;
    this.massLayer?.setSelectedPointHidden(hidden);
  }

  private ensureLinkCapacity(links: number) {
    if (links * 6 <= this.linkPositions.length) return;
    const next = new Float32Array(Math.max(links, (this.linkPositions.length / 6) * 2) * 6);
    next.set(this.linkPositions);
    this.linkPositions = next;
    // Free the old GPU buffer before swapping in the larger attribute.
    this.linkGeometry.dispose();
    const attr = new THREE.BufferAttribute(next, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.linkGeometry.setAttribute("position", attr);
  }

  private pushLink(from: THREE.Vector3, to: THREE.Vector3) {
    this.ensureLinkCapacity(this.linkCount + 1);
    const o = this.linkCount * 6;
    const a = this.linkPositions;
    const c = this.renderOrigin;
    a[o] = from.x - c.x; a[o + 1] = from.y - c.y; a[o + 2] = from.z - c.z;
    a[o + 3] = to.x - c.x; a[o + 4] = to.y - c.y; a[o + 5] = to.z - c.z;
    this.linkCount++;
  }

  private cacheSelectedState(satPosition: THREE.Vector3, velocityEci: Vec3 | null) {
    this.cachedSelectedPosition.copy(satPosition);
    this.hasCachedSelection = true;
    if (!velocityEci) return;
    this.cachedSelectedVelocity.set(
      velocityEci.x,
      velocityEci.z,
      -velocityEci.y,
    ).multiplyScalar(1 / EARTH_RADIUS_EQUATOR_KM);
    this.hasCachedVelocity = true;
    if (this.cachedSelectedVelocity.lengthSq() > 1e-8) {
      this.followBasis.copy(this.cachedSelectedVelocity).normalize();
    }
  }

  private readonly coneMatrix = new THREE.Matrix4();
  private readonly coneQuaternion = new THREE.Quaternion();
  private readonly coneScale = new THREE.Vector3();
  private readonly coneDirection = new THREE.Vector3();

  /**
   * Append one FOV cone instance. 地球指向 (the default): today's exact
   * geometry, skipped when the cone does not reach the Earth. Other
   * attitudes (satellite `index`'s resolved setting, shell/satellite overrides
   * included): the boresight of this frame's attitude law; a cone whose axis
   * misses the Earth is drawn grey and fainter (to its edge's Earth
   * intersection, else to the satellite's altitude).
   */
  private pushFovCone(
    index: number,
    positionEci: Vec3,
    velocityEci: Vec3 | null,
    satPosition: THREE.Vector3,
    sinHalfAngle: number,
    cosHalfAngle: number,
  ) {
    const attitude = this.frameAttitudes[this.satAttitudeGroup?.[index] ?? 0];
    if (attitude) {
      this.pushAttitudeFovCone(index, attitude, positionEci, velocityEci, satPosition);
      return;
    }
    if (this.fovConeCount >= this.fovCones.instanceMatrix.count) return;
    const hasTilt = this.params.fovConeAlongTrackDeg !== 0 || this.params.fovConeCrossTrackDeg !== 0;
    let coneHeightKm: number | null = null;
    if (hasTilt && velocityEci) {
      // Use ray-sphere intersection for tilted cones
      coneHeightKm = computeTiltedConeHeight(
        positionEci,
        velocityEci,
        this.params.fovConeAlongTrackDeg,
        this.params.fovConeCrossTrackDeg,
        this.params.fovConeHalfAngleDeg,
        EARTH_RADIUS_EQUATOR_KM,
      );
    } else {
      // Use nadir-based calculation for non-tilted cones
      const { x, y, z } = positionEci;
      const rSat = Math.sqrt(x * x + y * y + z * z);
      const sinTerm = rSat * sinHalfAngle;
      const underRoot = (EARTH_RADIUS_EQUATOR_KM * EARTH_RADIUS_EQUATOR_KM) - (sinTerm * sinTerm);
      if (underRoot > 0 && sinHalfAngle > 0) {
        const slantLengthKm = rSat * cosHalfAngle - Math.sqrt(underRoot);
        if (slantLengthKm > 0) coneHeightKm = slantLengthKm * cosHalfAngle;
      }
    }
    if (coneHeightKm === null || coneHeightKm <= 0) return;

    // Use the LVLH frame when velocity is available, else point at nadir.
    const fovQuat = velocityEci
      ? computeFovConeQuaternion(
        positionEci,
        velocityEci,
        this.params.fovConeAlongTrackDeg,
        this.params.fovConeCrossTrackDeg,
      )
      : null;
    if (fovQuat) {
      this.coneQuaternion.copy(fovQuat);
    } else {
      this.coneDirection.copy(satPosition).normalize().negate();
      if (this.coneDirection.lengthSq() === 0) return;
      this.coneQuaternion.setFromUnitVectors(DOWN_AXIS, this.coneDirection);
    }
    const normalizedHeight = coneHeightKm / EARTH_RADIUS_EQUATOR_KM;
    this.coneScale.setScalar(Math.max(normalizedHeight, this.fovConeMinHeight));
    this.coneMatrix.compose(this.originScratch.copy(satPosition).sub(this.renderOrigin), this.coneQuaternion, this.coneScale);
    this.fovCones.setMatrixAt(this.fovConeCount++, this.coneMatrix);
  }

  private readonly boresightScratch = { x: 0, y: 0, z: 0 };

  private pushAttitudeFovCone(
    index: number,
    ctx: AttitudeTimeContext,
    positionEci: Vec3,
    velocityEci: Vec3 | null,
    satPosition: THREE.Vector3,
  ) {
    const stateAt = this.satCount <= CONE_SLEW_MAX_SATELLITES ? this.attitudeStateProvider(index) : undefined;
    const q = satelliteAttitudeFromContext(positionEci, velocityEci ?? undefined, ctx, this.attitudeQuat, stateAt);
    const dir = sensorBoresightEci(q, this.params.fovConeAlongTrackDeg, this.params.fovConeCrossTrackDeg, this.boresightScratch);
    const hits = boresightPointsAtEarth(positionEci, dir, EARTH_RADIUS_EQUATOR_KM);
    const mesh = hits ? this.fovCones : this.fovMissCones;
    const count = hits ? this.fovConeCount : this.fovMissCount;
    if (count >= mesh.instanceMatrix.count) return;
    let heightKm = computeConeHeightForBoresight(positionEci, dir, this.params.fovConeHalfAngleDeg, EARTH_RADIUS_EQUATOR_KM);
    if (heightKm === null || heightKm <= 0) {
      if (hits) return;
      const r = Math.hypot(positionEci.x, positionEci.y, positionEci.z);
      heightKm = Math.max(r - EARTH_RADIUS_EQUATOR_KM, 0);
    }
    this.coneDirection.set(dir.x, dir.z, -dir.y);
    if (this.coneDirection.lengthSq() === 0) return;
    this.coneQuaternion.setFromUnitVectors(DOWN_AXIS, this.coneDirection.normalize());
    const height = Math.max(heightKm / EARTH_RADIUS_EQUATOR_KM, this.fovConeMinHeight);
    this.coneScale.setScalar(height);
    const local = this.originScratch.copy(satPosition).sub(this.renderOrigin);
    this.coneMatrix.compose(local, this.coneQuaternion, this.coneScale);
    mesh.setMatrixAt(count, this.coneMatrix);
    if (hits) {
      this.fovConeCount++;
      return;
    }
    // Dashed boresight from the satellite along the cone axis, cone height long.
    const pos = this.fovMissBoresightPositions;
    const d = this.coneDirection;
    const o = count * 6;
    pos[o] = local.x;
    pos[o + 1] = local.y;
    pos[o + 2] = local.z;
    pos[o + 3] = local.x + d.x * height;
    pos[o + 4] = local.y + d.y * height;
    pos[o + 5] = local.z + d.z * height;
    this.fovMissBoresightDistances[count * 2] = 0;
    this.fovMissBoresightDistances[count * 2 + 1] = height;
    this.fovMissCount++;
  }

  private readonly drawingBufferSize = new THREE.Vector2();

  /** Ground stations in the form the GPU layers' visibility test uses. */
  private massStations(gmst: number, gsEcis: Vec3[]): MassStation[] {
    const cosG = Math.cos(gmst);
    const sinG = Math.sin(gmst);
    return this.params.groundStations.map((gs, gi) => {
      const lat = THREE.MathUtils.degToRad(gs.latitudeDeg);
      const lon = THREE.MathUtils.degToRad(gs.longitudeDeg);
      const ux = Math.cos(lat) * Math.cos(lon);
      const uy = Math.cos(lat) * Math.sin(lon);
      return {
        eci: gsEcis[gi],
        // Geodetic up rotated from Earth-fixed to inertial, like ecfToEci.
        up: { x: ux * cosG - uy * sinG, y: ux * sinG + uy * cosG, z: Math.sin(lat) },
        sinMinElevation: Math.sin(THREE.MathUtils.degToRad(gs.minElevationDeg)),
      };
    });
  }

  /**
   * Mass mode per-frame work for the editor satellites: GPU uniforms, plus
   * CPU propagation of only the capped focus subset (links, FOV cones). The
   * selected satellite is handled in the animate loop.
   */
  private updateMassLayer(
    simMs: number,
    stations: MassStation[],
    pointScale: number,
    gsScene: THREE.Vector3[],
    sinHalfAngle: number,
    cosHalfAngle: number,
  ) {
    const layer = this.massLayer!;
    layer.update(simMs, stations, pointScale);

    const satPosition = this.tempVectorC;
    const conesOn = this.params.showSatelliteFovCones;
    const pairs = layer.advanceFocusScan(simMs, stations);
    let lastSat = -1;
    for (let k = 0; k < pairs.length; k += 2) {
      const i = pairs[k];
      const s = pairs[k + 1];
      const st = layer.stateAt(i, simMs);
      if (!stationSeesPoint(stations[s], st.position.x, st.position.y, st.position.z)) continue;
      satPosition.set(
        st.position.x / EARTH_RADIUS_EQUATOR_KM,
        st.position.z / EARTH_RADIUS_POLAR_KM,
        -st.position.y / EARTH_RADIUS_EQUATOR_KM,
      );
      this.pushLink(gsScene[s], satPosition);
      if (conesOn && i !== lastSat) this.pushFovCone(i, st.position, st.velocity, satPosition, sinHalfAngle, cosHalfAngle);
      lastSat = i;
    }
  }

  private updateCameraFollow(
    hasSelectedSat: boolean,
    hasSelectedVelocity: boolean,
  ) {
    // 近接 is driven by the ride (OrbitControls orbit/zoom about the satellite).
    const isFreeCamera = this.cameraMode === "free" || this.cameraMode === "closeUp" || !hasSelectedSat;
    this.controls.enabled = isFreeCamera;
    if (isFreeCamera) return;

    const pos = this.cachedSelectedPosition;
    const vel = hasSelectedVelocity ? this.cachedSelectedVelocity : null;

    if (this.cameraMode === "earthCenter") {
      this.configureEarthCenterCamera(pos);
    } else {
      this.configureThirdPersonCamera(pos, vel);
    }

    const holderQuat = this.cameraHolder.quaternion;
    this.tempQuaternionA.copy(holderQuat).invert();
    this.tempVectorD.copy(this.followPosition).applyQuaternion(this.tempQuaternionA);
    this.camera.position.lerp(this.tempVectorD, FOLLOW_LERP_ALPHA);

    this.controls.target.lerp(this.followTarget, FOLLOW_LERP_ALPHA);

    this.tempMatrix.lookAt(this.followPosition, this.followTarget, this.followUp);
    this.tempQuaternionB.setFromRotationMatrix(this.tempMatrix);
    this.tempQuaternionA.copy(holderQuat).invert().multiply(this.tempQuaternionB);
    this.camera.quaternion.slerp(this.tempQuaternionA, FOLLOW_LERP_ALPHA);
  }

  /**
   * GSE: the camera holder's local +X follows the Sun and local +Y the
   * ecliptic north pole, so the free camera sees the Sun fixed on its right
   * and the Earth's axis tilted by the obliquity. Arguments are the Sun unit
   * vector in scene axes (ECI x, z, -y).
   */
  private setSunFixedHolder(sunX: number, sunY: number, sunZ: number) {
    const xAxis = this.tempVectorA.set(sunX, sunY, sunZ).normalize();
    // Ecliptic north (0, -sin ε, cos ε) in ECI, mapped to scene axes.
    const yAxis = this.tempVectorB.set(0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY));
    yAxis.addScaledVector(xAxis, -yAxis.dot(xAxis)).normalize();
    const zAxis = this.tempVectorC.crossVectors(xAxis, yAxis);
    this.tempMatrix.makeBasis(xAxis, yAxis, zAxis);
    this.cameraHolder.quaternion.setFromRotationMatrix(this.tempMatrix);
  }

  private configureEarthCenterCamera(selectedSatPosition: THREE.Vector3) {
    const towardEarth = this.tempVectorA.copy(selectedSatPosition).normalize().negate();
    this.followTarget.copy(selectedSatPosition);
    this.followPosition
      .copy(selectedSatPosition)
      .addScaledVector(towardEarth, -this.earthCenterDistance);

    const right = this.tempVectorB;
    if (this.followBasis.lengthSq() > 1e-8) {
      right.copy(this.followBasis);
    } else {
      right.copy(UP_AXIS);
    }
    right.addScaledVector(towardEarth, -right.dot(towardEarth));
    if (right.lengthSq() < 1e-8) {
      right.copy(UP_AXIS).addScaledVector(towardEarth, -UP_AXIS.dot(towardEarth));
    }
    if (right.lengthSq() < 1e-8) {
      right.set(1, 0, 0);
    }
    right.normalize();
    this.followUp.copy(right).cross(towardEarth).normalize();
  }

  private configureThirdPersonCamera(
    selectedSatPosition: THREE.Vector3,
    selectedSatVelocity: THREE.Vector3 | null,
  ) {
    const forward = this.tempVectorA;
    if (selectedSatVelocity && selectedSatVelocity.lengthSq() > 1e-8) {
      forward.copy(selectedSatVelocity).normalize();
      this.followBasis.copy(forward);
    } else if (this.followBasis.lengthSq() > 1e-8) {
      forward.copy(this.followBasis).normalize();
    } else {
      forward.copy(selectedSatPosition).normalize().cross(UP_AXIS);
      if (forward.lengthSq() < 1e-8) {
        forward.set(1, 0, 0);
      } else {
        forward.normalize();
      }
      this.followBasis.copy(forward);
    }

    const radial = this.tempVectorB.copy(selectedSatPosition).normalize();
    const right = this.tempVectorC.copy(forward).cross(radial);
    if (right.lengthSq() < 1e-8) {
      right.copy(UP_AXIS).cross(forward);
    }
    right.normalize();
    const altitude = Math.max(selectedSatPosition.length() - 1, 0);
    const lookAhead = THREE.MathUtils.clamp(0.08 + altitude * 0.55, 0.08, 0.4);
    const pitchCos = Math.cos(this.thirdPersonPitch);
    const pitchSin = Math.sin(this.thirdPersonPitch);
    const offsetDirection = this.followUp
      .copy(forward)
      .multiplyScalar(-pitchCos)
      .addScaledVector(radial, pitchSin)
      .normalize();

    // Keep Earth toward the bottom of the frame by defining screen-down as the
    // projection of the Earth-center direction onto the camera plane.
    const earthDown = this.tempVectorC
      .copy(radial)
      .negate()
      .addScaledVector(offsetDirection, radial.dot(offsetDirection));
    if (earthDown.lengthSq() < 1e-8) {
      earthDown.copy(radial).negate();
    }
    earthDown.normalize();
    const derivedUp = this.followUp.copy(earthDown).negate();
    if (derivedUp.lengthSq() < 1e-8) {
      derivedUp.copy(radial);
    }
    derivedUp.normalize();

    this.followTarget.copy(selectedSatPosition).addScaledVector(forward, lookAhead);
    this.followPosition
      .copy(selectedSatPosition)
      .addScaledVector(offsetDirection, this.thirdPersonDistance);
  }

  private formatTime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fmtLine = (date: Date) =>
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    const utc = fmtLine(d);
    const jstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const jst = fmtLine(jstDate);
    return `${utc} UTC\n${jst} JST`;
  }

  /**
   * Load and render a KML file
   */
  async loadKML(url: string, append = false): Promise<void> {
    try {
      const kmlDoc = await loadKMLFromURL(url);
      this.kmlRenderer.renderKMLDocument(kmlDoc, append);
    } catch (error) {
      console.error('Failed to load KML:', error);
      throw error;
    }
  }

  /**
   * Clear KML geometries from the scene
   */
  clearKML(): void {
    this.kmlRenderer.clear();
  }

  dispose() {
    // Cancel animation frame first
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.islWorker?.removeEventListener("message", this.handleIslWorkerMessage);
    this.islWorker?.terminate();

    this.disposeFns.forEach((fn) => fn());
    
    // Clear the scene first
    while(this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
    
    // Dispose all geometries
    this.satGeometry.dispose();
    this.groundGeometry.dispose();
    this.stationGeo.dispose();
    this.stationConeGeometries.forEach((g) => g.dispose());
    this.fovConeGeometry.dispose();
    this.linkGeometry.dispose();
    this.fovCones.dispose();
    this.fovMissCones.dispose();
    this.fovMissBoresightGeometry.dispose();
    this.massLayer?.dispose();
    this.catalogLayer?.dispose();
    this.catalogLayer = null;
    this.islPathGeometry.dispose();
    this.islEndpointGeo.dispose();

    // Dispose all materials
    this.satMaterial.dispose();
    if (this.satMaterial.map) this.satMaterial.map.dispose();
    this.groundMaterial.dispose();
    if (this.groundMaterial.map) this.groundMaterial.map.dispose();
    this.stationMat.dispose();
    this.stationConeMaterials.forEach((m) => m.dispose());
    this.fovConeMaterial.dispose();
    this.fovMissMaterial.dispose();
    this.fovMissBoresightMaterial.dispose();
    this.linkMaterial.dispose();
    this.islPathMaterial.dispose();
    this.islEndpointMatA.dispose();
    this.islEndpointMatB.dispose();
    
    // Dispose earth mesh
    this.earthResourceDisposers.forEach((dispose) => dispose());
    this.launchSiteImagery?.dispose();
    
    // Dispose graticule, ecliptic, geo orbit, and sun dot
    this.graticule.geometry.dispose();
    this.ecliptic.geometry.dispose();
    this.geoOrbit.geometry.dispose();
    this.sunDot.geometry.dispose();
    if (this.sunDot.material instanceof THREE.Material) {
      this.sunDot.material.dispose();
    }
    
    if (this.orbitLine) {
      this.orbitLine.geometry.dispose();
    }
    if (this.closeUpOrbit) {
      this.closeUpOrbit.geometry.dispose();
      this.scene.remove(this.closeUpOrbit);
      this.closeUpOrbit = null;
    }
    this.clearGroundTrack();
    
    // Dispose KML renderer
    this.kmlRenderer.dispose();
    this.trajectoryRenderer.dispose();
    
    this.controls.dispose();
    this.renderer.dispose();
    
    if (this.params.mountRef.current && this.params.mountRef.current.contains(this.renderer.domElement)) {
      this.params.mountRef.current.removeChild(this.renderer.domElement);
    }
  }

  /**
   * Launch-site imagery: photo patches only make sense on the image-based
   * globes (not the monochrome maps), and are skipped entirely when the
   * browser asks to save data. Memory-constrained devices load them at half
   * resolution.
   */
  private createLaunchSiteImagery(): LaunchSiteImageryLayer | null {
    const mode = this.params.earthTexture;
    if (!isLayeredEarthMode(mode) || prefersReducedData()) return null;
    const lighting = resolveLayeredEarthAssets(mode, 4096).lighting;
    const layer = new LaunchSiteImageryLayer({
      brightEarth: !!this.params.brightEarth,
      nightLift: NIGHT_LIFT * lighting.night,
      anisotropy: Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8),
      halfResolution: isMemoryConstrainedDevice() || hasLostEarthContext(),
      initTexture: (texture) => this.renderer.initTexture(texture),
      onCreditChange: (credit) => this.params.onLaunchSiteImageryCredit?.(credit),
    });
    // A sub-group: setDetailed / setSurfaceShellDepthBias only walk the
    // globe group's direct meshes, and must leave the patches alone.
    this.earthGroup.add(layer.group);
    this.earthAnimationBindings.push({ sunDirectionUniform: layer.sunDirection });
    // Decoded pixels are released after upload, so after a context loss the
    // patches are dropped and load again while the camera is still close.
    const canvas = this.renderer.domElement;
    const handleContextLost = () => layer.releaseAll();
    canvas.addEventListener("webglcontextlost", handleContextLost);
    this.disposeFns.push(() => canvas.removeEventListener("webglcontextlost", handleContextLost));
    return layer;
  }

  /** Feed the camera position, in the Earth group's (Earth-fixed, unflattened) frame, to the launch-site imagery. */
  private updateLaunchSiteImagery(rotAngle: number, nowReal: number) {
    const layer = this.launchSiteImagery;
    if (!layer) return;
    const local = this.camera.getWorldPosition(this.tempVectorA);
    local.applyAxisAngle(UP_AXIS, -rotAngle);
    local.y /= EARTH_FLATTENING;
    layer.update(local, nowReal);
  }

  /** Largest earth texture side to load on this GPU and device. */
  private earthTextureSize() {
    return earthTextureBudget(
      this.renderer.capabilities.maxTextureSize,
      isMemoryConstrainedDevice() || hasLostEarthContext(),
    );
  }

  private createEarth() {
    const group = new THREE.Group();
    const geometry = new THREE.SphereGeometry(1, 128, 128);
    const disposeFns: (() => void)[] = [];
    const animatedMaterials: EarthAnimationBinding[] = [];
    const anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    const abortController = new AbortController();
    const initialLoads: Promise<void>[] = [];
    const upgrades: (() => Promise<void>)[] = [];
    const restores: (() => void)[] = [];

    let disposed = false;
    disposeFns.push(() => {
      disposed = true;
      abortController.abort();
    });

    // A 1×1 stand-in keeps the globe from drawing black while images
    // download, and keeps each material slot non-null so swapping in the
    // real image does not recompile shaders.
    const placeholder = (rgba: Rgba, colorSpace: THREE.ColorSpace) => {
      const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      texture.colorSpace = colorSpace;
      texture.needsUpdate = true;
      disposeFns.push(() => texture.dispose());
      return texture;
    };

    // Decode off the main thread, then upload to the GPU right away instead
    // of during the next draw, and drop the CPU copy.
    const fetchTexture = async (path: string, colorSpace: THREE.ColorSpace) => {
      const decoded = await loadEarthImage(path, abortController.signal);
      if (disposed) {
        decoded.release();
        return null;
      }
      const texture = new THREE.Texture(decoded.image);
      texture.flipY = decoded.flipY;
      texture.colorSpace = colorSpace;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      this.renderer.initTexture(texture);
      decoded.release();
      disposeFns.push(() => texture.dispose());
      // A failed upload (out of GPU memory, or the context was lost) leaves
      // a texture that samples black; keep the previous image instead.
      const gl = this.renderer.getContext();
      if (gl.isContextLost() || gl.getError() === gl.OUT_OF_MEMORY) {
        texture.dispose();
        throw new Error("GPU upload failed");
      }
      return texture;
    };

    // Show a flat color first, then the small image, then (once the globe
    // is on screen and the page is idle) the large one. `apply` must point
    // every material slot at the new texture.
    const loadProgressiveTexture: ProgressiveTextureLoader = (
      source,
      apply,
      colorSpace = THREE.NoColorSpace,
      fallback = NO_DATA,
    ) => {
      const stand = placeholder(fallback, colorSpace);
      let current: THREE.Texture = stand;
      const replace = (texture: THREE.Texture | null) => {
        if (!texture) return;
        apply(texture);
        current.dispose();
        current = texture;
      };
      const load = (path: string, isUpgrade = false) =>
        fetchTexture(path, colorSpace).then((texture) => {
          // An 8k image still decoding when the context was lost is dropped.
          if (isUpgrade && hasLostEarthContext()) texture?.dispose();
          else replace(texture);
        }, (error: unknown) => {
          if (!disposed) console.warn(`Earth texture failed to load: ${path}`, error);
        });
      initialLoads.push(load(source.initial));
      const { upgrade } = source;
      if (upgrade) upgrades.push(() => load(upgrade, true));
      // The decoded pixels were released after upload, so a restored context
      // has nothing to re-upload: show the flat color and fetch the small
      // image again (never the 8k one, which may be what lost the context).
      restores.push(() => {
        if (!(current instanceof THREE.DataTexture)) replace(placeholder(fallback, colorSpace));
        void load(source.initial);
      });
      return stand;
    };

    const loadTexture: TextureLoaderFn = (path, apply, colorSpace, fallback) =>
      loadProgressiveTexture({ initial: path }, apply, colorSpace, fallback);

    const darkMonochrome = this.params.earthTexture === DARK_MONOCHROME_EARTH_MODE;
    const paperAtlas = this.params.earthTexture === PAPER_ATLAS_EARTH_MODE;
    const layeredEarthMode = isLayeredEarthMode(this.params.earthTexture)
      ? this.params.earthTexture
      : null;
    const layeredAssets = layeredEarthMode
      ? resolveLayeredEarthAssets(layeredEarthMode, this.earthTextureSize())
      : null;

    const surfaceMesh = layeredAssets
      ? this.createLayeredEarthSurface(geometry, group, layeredAssets, loadProgressiveTexture)
      : this.createMonochromeSurface(geometry, group, loadTexture, loadProgressiveTexture, paperAtlas);

    // Optional overlays are built on first use, so their images are only
    // downloaded when someone turns them on.
    const lazyOverlay = (create: () => THREE.Mesh) => {
      let mesh: THREE.Mesh | null = null;
      return (visible: boolean) => {
        if (!visible && !mesh) return;
        if (!mesh) {
          const created = create();
          disposeFns.push(() => {
            created.geometry.dispose();
            (created.material as THREE.Material).dispose();
          });
          mesh = created;
        }
        mesh.visible = visible;
      };
    };

    let setCountryBordersVisible: (visible: boolean) => void;
    let setCloudsVisible: (visible: boolean) => void = () => {};
    if (layeredAssets) {
      setCountryBordersVisible = lazyOverlay(() => this.createCountryBorders(geometry, group, loadTexture));
      setCloudsVisible = lazyOverlay(() => this.createEarthClouds(geometry, group, layeredAssets, loadTexture));
    } else {
      const showBorders = (surfaceMesh.material as THREE.ShaderMaterial).uniforms.showBorders;
      setCountryBordersVisible = (visible) => {
        showBorders.value = visible;
      };
    }

    if (layeredAssets || darkMonochrome || paperAtlas) {
      animatedMaterials.push(surfaceMesh.userData.shaderEntry);
    }

    if (layeredAssets) {
      const nightLights = this.createNightLights(geometry, group, layeredAssets, loadProgressiveTexture);
      disposeFns.push(() => {
        nightLights.geometry.dispose();
        (nightLights.material as THREE.Material).dispose();
      });
      animatedMaterials.push(nightLights.userData.shaderEntry);
    }

    if (layeredAssets || darkMonochrome) {
      const atmosphere = this.createAtmosphere(geometry, group, darkMonochrome);
      const atmosphereOuter = atmosphere.userData.companion as THREE.Mesh | undefined;
      disposeFns.push(() => {
        atmosphere.geometry.dispose();
        (atmosphere.material as THREE.Material).dispose();
        if (atmosphereOuter) {
          atmosphereOuter.geometry.dispose();
          (atmosphereOuter.material as THREE.Material).dispose();
        }
      });
      animatedMaterials.push(atmosphere.userData.shaderEntry);
      if (atmosphereOuter) {
        animatedMaterials.push(atmosphereOuter.userData.shaderEntry);
      }
    }

    // iOS Safari drops WebGL contexts under memory pressure or in the
    // background; three restores the scene but cannot restore our images.
    const canvas = this.renderer.domElement;
    const handleContextLost = () => noteEarthContextLost();
    const handleContextRestored = () => {
      if (!disposed) for (const restore of restores) restore();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    disposeFns.push(() => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    });

    disposeFns.unshift(() => {
      surfaceMesh.geometry.dispose();
      (surfaceMesh.material as THREE.Material).dispose();
    });

    // Close rides: one shared high-segment sphere replaces every layer's
    // 128-segment geometry (they differ only by mesh.scale), see
    // EARTH_DETAIL_SEGMENTS. Lazily built, disposed when the ride climbs
    // out or ends; the originals are kept in userData and put back.
    let detailedGeometry: THREE.SphereGeometry | null = null;
    const setDetailed = (on: boolean) => {
      if (on) {
        if (!detailedGeometry) {
          const [w, h] = isMemoryConstrainedDevice() ? EARTH_DETAIL_SEGMENTS_CONSTRAINED : EARTH_DETAIL_SEGMENTS;
          detailedGeometry = new THREE.SphereGeometry(1, w, h);
        }
        // Re-run every ride frame: overlays created lazily mid-ride
        // (borders, clouds) start on the 128-segment clone.
        for (const child of group.children) {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || mesh.geometry === detailedGeometry || !(mesh.geometry instanceof THREE.SphereGeometry)) continue;
          mesh.userData.standardGeometry = mesh.geometry;
          mesh.geometry = detailedGeometry;
        }
        return;
      }
      if (!detailedGeometry) return;
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        const standard = mesh.userData.standardGeometry as THREE.BufferGeometry | undefined;
        if (!mesh.isMesh || !standard) continue;
        mesh.geometry = standard;
        delete mesh.userData.standardGeometry;
      }
      detailedGeometry.dispose();
      detailedGeometry = null;
    };
    // First: the other disposers free `mesh.geometry`, which must be the originals.
    disposeFns.unshift(() => setDetailed(false));

    // Startup: report progress, reveal the globe once the small images are
    // on the GPU, then fetch the 8k images one at a time so they neither
    // compete with the first images for bandwidth nor stack GPU uploads.
    const firstImages = [...initialLoads];
    let loaded = 0;
    for (const load of firstImages) {
      void load.then(() => setBootSplashStatus(`地球を読み込み中 ${++loaded}/${firstImages.length}`));
    }
    void Promise.all(firstImages).then(async () => {
      if (disposed) return;
      await nextFrame();
      this.earthReady = true;
      hideBootSplash();
      if (upgrades.length === 0 || prefersReducedData()) return;
      await whenIdle();
      for (const upgrade of upgrades) {
        // After a context loss the globe stays at 4k.
        if (disposed || hasLostEarthContext()) return;
        await upgrade();
        await nextFrame();
      }
    });

    return {
      group,
      disposeFns,
      animatedMaterials,
      setCountryBordersVisible,
      setCloudsVisible,
      setDetailed,
    };
  }

  private createCountryBorders(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    loadTexture: TextureLoaderFn,
  ) {
    const geometry = baseGeometry.clone();
    // Unlit so the lines stay readable on the night side, like the graticule.
    const material = new THREE.MeshBasicMaterial({
      color: this.params.whiteBackground ? 0x2b3440 : 0xe6edf5,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    material.alphaMap = loadTexture(EARTH_ASSETS.countryBorders, (texture) => {
      material.alphaMap = texture;
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(1.0005);
    group.add(mesh);
    return mesh;
  }

  private createMonochromeSurface(
    geometry: THREE.SphereGeometry,
    group: THREE.Group,
    loadTexture: TextureLoaderFn,
    loadProgressiveTexture: ProgressiveTextureLoader,
    paperAtlas: boolean,
  ) {
    // Reuse the data mask without loading day imagery, clouds, or city lights.
    const oceanMask: THREE.IUniform<THREE.Texture> = { value: null! };
    oceanMask.value = loadProgressiveTexture(
      resolveProgressiveTexture(EARTH_ASSETS.oceanMask, this.earthTextureSize()),
      (texture) => {
        oceanMask.value = texture;
      },
      THREE.NoColorSpace,
      // Land until the mask arrives, so the globe is not drawn as ocean.
      NO_DATA,
    );
    const borderMask: THREE.IUniform<THREE.Texture> = { value: null! };
    borderMask.value = loadTexture(EARTH_ASSETS.countryBorders, (texture) => {
      borderMask.value = texture;
    });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        oceanMask,
        borderMask,
        showBorders: { value: true },
        borderColor: { value: new THREE.Color(paperAtlas ? "#88939c" : "#b6c4d6") },
        oceanColor: { value: new THREE.Color(paperAtlas ? "#f6f7f7" : "#03050a") },
        landColor: { value: new THREE.Color(paperAtlas ? "#c4cacd" : "#727984") },
        paperAtlas: { value: paperAtlas },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        brightEarth: { value: this.params.brightEarth },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vViewNormal = normalize(normalMatrix * normal);
          vViewPosition = -(modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D oceanMask;
        uniform sampler2D borderMask;
        uniform bool showBorders;
        uniform vec3 borderColor;
        uniform vec3 oceanColor;
        uniform vec3 landColor;
        uniform vec3 sunDirection;
        uniform bool brightEarth;
        uniform bool paperAtlas;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        void main() {
          // White denotes water; smooth the mask to suppress inland noise.
          float water = smoothstep(0.15, 0.85, texture2D(oceanMask, vUv).r);
          float daylight = max(dot(normalize(vWorldNormal), normalize(sunDirection)), 0.0);
          // Keep the continents legible on the night side, too.
          float shade = brightEarth ? 1.0 : 0.55 + 0.45 * daylight;
          float border = showBorders ? texture2D(borderMask, vUv).r * (1.0 - water) : 0.0;
          vec3 land = mix(landColor, borderColor, border * (paperAtlas ? 0.26 : 0.4));
          vec3 surface = mix(land * shade, oceanColor, water);
          if (paperAtlas) {
            // A quiet, camera-relative edge keeps the globe legible on both
            // backgrounds without hiding the map on the simulated night side.
            float facing = max(dot(normalize(vViewNormal), normalize(vViewPosition)), 0.0);
            float paperShade = brightEarth ? 1.0 : 0.91 + 0.09 * smoothstep(0.0, 0.6, facing);
            surface = mix(land, oceanColor, water) * paperShade;
          }
          gl_FragColor = vec4(surface, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.shaderEntry = {
      sunDirectionUniform: material.uniforms.sunDirection.value as THREE.Vector3,
    };
    group.add(mesh);
    return mesh;
  }

  private createLayeredEarthSurface(
    geometry: THREE.SphereGeometry,
    group: THREE.Group,
    assets: ReturnType<typeof resolveLayeredEarthAssets>,
    loadProgressiveTexture: ProgressiveTextureLoader,
  ) {
    const brightEarth = !!this.params.brightEarth;
    // Even out the two day maps, under the sun and under flat "bright earth" light.
    const { glint, night } = brightEarth ? { glint: 1, night: 1 } : assets.lighting;
    const albedo = brightEarth ? assets.lighting.bright : assets.lighting.albedo;
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color().setScalar(albedo),
      emissive: new THREE.Color("#394754"),
      emissiveIntensity: (brightEarth ? 0.04 : 0.07) * albedo,
      // Bright enough for a visible sun glint on the oceans (the specular map
      // masks it to water), soft enough to stay a highlight, not a hotspot.
      specular: new THREE.Color(brightEarth ? "#1e2833" : "#1e262e").multiplyScalar(brightEarth ? 1 : glint * 0.5),
      shininess: brightEarth ? 85 : 400,
      // Terrain only reads where light grazes it, so this mostly shows near
      // the terminator; under flat "bright earth" lighting it would be noise.
      bumpScale: brightEarth ? 0 : 2.2,
    });
    const dayMap = loadProgressiveTexture(assets.dayMap, (texture) => {
      material.map = texture;
      material.emissiveMap = texture;
    }, THREE.SRGBColorSpace, DEEP_OCEAN);
    material.map = dayMap;
    material.emissiveMap = dayMap;
    material.specularMap = loadProgressiveTexture(assets.oceanMask, (texture) => {
      material.specularMap = texture;
    }, THREE.NoColorSpace, ALL_WATER);
    if (!brightEarth) {
      material.bumpMap = loadProgressiveTexture({ initial: assets.reliefMap }, (texture) => {
        material.bumpMap = texture;
      }, THREE.NoColorSpace, NO_DATA);
    }

    const sunDirection = new THREE.Vector3(1, 0, 0);
    if (!brightEarth) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.sunDirection = { value: sunDirection };
        shader.uniforms.nightLift = { value: NIGHT_LIFT * night };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSunWorldNormal;")
          .replace(
            "#include <beginnormal_vertex>",
            "#include <beginnormal_vertex>\nvSunWorldNormal = normalize(mat3(modelMatrix) * objectNormal);",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform vec3 sunDirection;
            uniform float nightLift;
            varying vec3 vSunWorldNormal;
            // Filmic curve (Narkowicz's ACES fit) for the globe alone, so user
            // colours on satellites and lines are not tone-mapped.
            vec3 earthFilmic(vec3 x) {
              return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
            }`,
          )
          // three's Blinn-Phong uses a Schlick Fresnel that rises to white at
          // grazing angles whatever the specular colour, which drew a white
          // blob on the limb. Let the specular colour alone set the glint.
          .replace(
            "#include <lights_phong_pars_fragment>",
            `vec3 earthGlintBRDF(const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal,
                const in vec3 specularColor, const in float shininess) {
              vec3 halfDir = normalize(lightDir + viewDir);
              return specularColor * 0.25 * D_BlinnPhong(shininess, saturate(dot(normal, halfDir)));
            }
            ${THREE.ShaderChunk.lights_phong_pars_fragment.replace("BRDF_BlinnPhong(", "earthGlintBRDF(")}`,
          )
          .replace(
            "#include <lights_fragment_end>",
            `#include <lights_fragment_end>
            // Fade the glint at the limb, where Blinn-Phong smears it into a streak.
            reflectedLight.directSpecular *= smoothstep(0.05, 0.4, dot(normal, normalize(vViewPosition)));`,
          )
          .replace(
            "#include <opaque_fragment>",
            `float sunCos = dot(normalize(vSunWorldNormal), normalize(sunDirection));
            // Sunlight near the terminator crosses the most air: warm and dim it.
            float dusk = smoothstep(-0.06, 0.06, sunCos) * (1.0 - smoothstep(0.06, 0.32, sunCos));
            outgoingLight *= mix(vec3(1.0), vec3(1.0, 0.66, 0.42), dusk * 0.6);
            // Keep the night side readable: a flat share of the day map where
            // the sun is down (the city lights layer adds on top).
            outgoingLight += diffuseColor.rgb * nightLift * (1.0 - smoothstep(-0.15, 0.1, sunCos));
            // Daylight scattered by the air: a faint blue over the oceans
            // (specularStrength is the water mask), barely any over land so
            // the photo stays crisp, slightly thicker toward the limb.
            float limb = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
            outgoingLight += vec3(0.006, 0.017, 0.042) * sqrt(max(sunCos, 0.0))
              * mix(0.15, 1.0, specularStrength) * (1.0 + 0.7 * limb);
            outgoingLight = earthFilmic(outgoingLight * 1.1);
            #include <opaque_fragment>`,
          );
      };
    } else {
      // Flat light leaves the photo's near-black oceans black; give all water
      // the same faint blue the sunlit side gets from the air.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `outgoingLight += vec3(0.010, 0.028, 0.068) * specularStrength;
          #include <opaque_fragment>`,
        );
      };
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.shaderEntry = { sunDirectionUniform: sunDirection };
    group.add(mesh);
    return mesh;
  }

  private createEarthClouds(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    assets: ReturnType<typeof resolveLayeredEarthAssets>,
    loadTexture: TextureLoaderFn,
  ) {
    const geometry = baseGeometry.clone();
    const material = new THREE.MeshPhongMaterial({
      color: 0xfafcff,
      transparent: true,
      opacity: this.params.brightEarth ? 0.24 : 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      shininess: 8,
    });
    const cloudMap = loadTexture(assets.cloudsMap, (texture) => {
      material.map = texture;
      material.alphaMap = texture;
    }, THREE.SRGBColorSpace);
    material.map = cloudMap;
    material.alphaMap = cloudMap;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(1.008);
    group.add(mesh);
    return mesh;
  }

  private createNightLights(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    assets: ReturnType<typeof resolveLayeredEarthAssets>,
    loadProgressiveTexture: ProgressiveTextureLoader,
  ) {
    const geometry = baseGeometry.clone();
    const lightsMap: THREE.IUniform<THREE.Texture> = { value: null! };
    lightsMap.value = loadProgressiveTexture(assets.lightsMap, (texture) => {
      lightsMap.value = texture;
    }, THREE.SRGBColorSpace, NO_DATA);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        lightsMap,
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        intensity: { value: this.params.brightEarth ? 0.16 : 0.95 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;

        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D lightsMap;
        uniform vec3 sunDirection;
        uniform float intensity;
        varying vec2 vUv;
        varying vec3 vWorldNormal;

        void main() {
          vec3 mapColor = texture2D(lightsMap, vUv).rgb;
          float diffuse = dot(normalize(vWorldNormal), normalize(sunDirection));
          float nightMask = 1.0 - smoothstep(0.02, 0.42, diffuse);
          float luminance = dot(mapColor, vec3(0.299, 0.587, 0.114));
          float boosted = pow(luminance, 0.68);
          float alpha = boosted * nightMask * intensity;
          gl_FragColor = vec4(mapColor * nightMask * intensity * 1.08, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(1.001);
    mesh.userData.shaderEntry = {
      sunDirectionUniform: material.uniforms.sunDirection.value as THREE.Vector3,
    };
    group.add(mesh);
    return mesh;
  }

  private createAtmosphere(baseGeometry: THREE.SphereGeometry, group: THREE.Group, darkMonochrome = false) {
    const outer = this.createAtmosphereLayer(baseGeometry, group, {
      side: THREE.BackSide,
      scale: darkMonochrome ? 1.018 : 1.055,
      glowStrength: darkMonochrome ? 0.25 : this.params.brightEarth ? 0.14 : 0.22,
      sunFloor: darkMonochrome ? 0.8 : 0.22,
      fresnelPower: 2.6,
      color: darkMonochrome ? "#2d8bd4" : "#4f97ff",
    });
    const inner = this.createAtmosphereLayer(baseGeometry, group, {
      side: THREE.FrontSide,
      scale: darkMonochrome ? 1.003 : 1.016,
      glowStrength: darkMonochrome ? 0.3 : this.params.brightEarth ? 0.045 : 0.08,
      sunFloor: darkMonochrome ? 0.8 : 0.32,
      fresnelPower: darkMonochrome ? 4.0 : 1.35,
      color: darkMonochrome ? "#2d8bd4" : "#a8d4ff",
    });
    inner.userData.companion = outer;
    return inner;
  }

  private createAtmosphereLayer(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    options: {
      side: THREE.Side;
      scale: number;
      glowStrength: number;
      sunFloor: number;
      fresnelPower: number;
      color: string;
    },
  ) {
    const geometry = baseGeometry.clone();
    const darkMonochrome = this.params.earthTexture === DARK_MONOCHROME_EARTH_MODE;
    const material = new THREE.ShaderMaterial({
      defines: darkMonochrome ? { DARK_MONOCHROME: 1 } : {},
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        glowStrength: { value: options.glowStrength },
        atmosphereColor: { value: new THREE.Color(options.color) },
        sunFloor: { value: options.sunFloor },
        fresnelPower: { value: options.fresnelPower },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform vec3 atmosphereColor;
        uniform float glowStrength;
        uniform float sunFloor;
        uniform float fresnelPower;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;

        void main() {
          vec3 normalDir = normalize(vWorldNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(viewDir, normalDir), 0.0), fresnelPower);
          float sunAmount = sunFloor + (1.0 - sunFloor) * max(dot(normalDir, normalize(sunDirection)), 0.0);
          float alpha = fresnel * sunAmount * glowStrength;
          #ifndef DARK_MONOCHROME
            // The limb over the terminator glows orange, as at sunrise/sunset.
            float sunCos = dot(normalDir, normalize(sunDirection));
            float dusk = exp(-pow(sunCos / 0.22, 2.0));
            vec3 glowColor = mix(atmosphereColor, vec3(1.0, 0.56, 0.3), dusk * 0.7);
            alpha *= 1.0 + 0.6 * dusk;
          #endif
          #ifdef DARK_MONOCHROME
            // AdditiveBlending applies alpha; output the blue tint only once.
            gl_FragColor = vec4(atmosphereColor, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          #else
            gl_FragColor = vec4(glowColor * alpha, alpha);
          #endif
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: options.side,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(options.scale);
    mesh.userData.shaderEntry = {
      sunDirectionUniform: material.uniforms.sunDirection.value as THREE.Vector3,
    };
    group.add(mesh);
    return mesh;
  }
}
