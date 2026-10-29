import { SimulationClock } from "./simulationClock";
// High-level wrapper around the Three.js scene used by the visualizer.
// Moved from useSatelliteScene for better organization.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { toSatrec } from "./satellites";
import type { SatelliteSpec } from "./satellites";
import {
  catalogFromSpecs,
  catalogSatrecAt,
  concatCatalogs,
  isFilingRow,
  type SatelliteCatalog,
} from "./satelliteCatalog";
import {
  MASS_FOCUS_LIMIT,
  MassSatelliteLayer,
  isMassMode,
  stationSeesPoint,
  type MassStation,
} from "./massSatelliteLayer";
import type { GroundStation } from "./groundStations";
import {
  sunVectorECI,
  createGraticule,
  createEclipticLine,
  createGeoOrbitLine,
  EARTH_FLATTENING,
} from "./astronomy";
import { KMLRenderer } from "./kmlRenderer";
import { loadKMLFromURL } from "./kml";
import { computeFovConeQuaternion, computeTiltedConeHeight } from "./orbitalCoordinates";
import {
  DARK_MONOCHROME_EARTH_MODE,
  EARTH_ASSETS,
  PAPER_ATLAS_EARTH_MODE,
  isLayeredEarthMode,
  resolveLayeredEarthAssets,
  resolveProgressiveTexture,
  type EarthTextureMode,
  type ProgressiveTexture,
} from "./earthTextures";
import type { CameraSnapshot } from "./viewState";
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
const FOV_CONE_SEGMENTS = 32;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const POINTER_DRAG_THRESHOLD_PX = 5;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 3);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const FOLLOW_MIN_DISTANCE = 0.12;
const FOLLOW_MAX_DISTANCE = 1.8;
const THIRDPERSON_DEFAULT_PITCH = THREE.MathUtils.degToRad(22);
const THIRDPERSON_MIN_PITCH = THREE.MathUtils.degToRad(-70);
const THIRDPERSON_MAX_PITCH = THREE.MathUtils.degToRad(82);
const FOLLOW_LERP_ALPHA = 0.14;

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
  const hits: { i: number; d: number }[] = [];
  points.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= radiusPx) hits.push({ i, d });
  });
  return hits.sort((a, b) => a.d - b.d).map((h) => h.i);
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

type ProgressiveTextureLoader = (
  source: ProgressiveTexture,
  apply: (texture: THREE.Texture) => void,
  colorSpace?: THREE.ColorSpace,
) => THREE.Texture;

export type SatelliteCameraMode = "free" | "earthCenter" | "thirdPerson";

export interface SatelliteSceneParams {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  /**
   * Large columnar catalog (TLE/OMM files, filings placed as a catalog)
   * drawn after `satellites`; its rows take indexes from
   * `satellites.length` on. Once the total exceeds `MASS_MODE_THRESHOLD`
   * every satellite is drawn by the GPU {@link MassSatelliteLayer}.
   */
  catalog?: SatelliteCatalog | null;
  groundStations: GroundStation[];
  satRadius: number;
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
  groundConeMinElevationDeg: number;
  /** Ground cone range expressed in Earth radii */
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
  /** Rotate the camera with the Earth to approximate an ECEF view */
  ecef: boolean;
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
}

export default class SatelliteScene {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly cameraHolder: THREE.Group;
  private readonly disposeFns: (() => void)[] = [];

  /** SGP4 records for every satellite in CPU mode; empty in mass mode. */
  private readonly satRecs: satellite.SatRec[];
  /** Satellites drawn: editor `satellites` followed by `catalog` rows. */
  private readonly satCount: number;
  /** GPU layer drawing every satellite when `satCount` exceeds the mass-mode threshold. */
  private readonly massLayer: MassSatelliteLayer | null;
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
  private readonly earthGroup: THREE.Group;
  private readonly earthResourceDisposers: (() => void)[];
  private readonly earthAnimationBindings: EarthAnimationBinding[];
  private readonly setCountryBordersVisible: (visible: boolean) => void;
  private readonly setCloudsVisible: (visible: boolean) => void;
  private readonly graticule: THREE.LineSegments;
  private readonly ecliptic: THREE.Line;
  private readonly geoOrbit: THREE.Line;
  private readonly sunDot: THREE.Mesh;
  private readonly sunlight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly kmlRenderer: KMLRenderer;

  private selectedIndex: number | null = null;
  private selectedStationIndex: number | null = null;
  private orbitLine: THREE.Line | null = null;
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

  private params: SatelliteSceneParams;

  constructor(params: SatelliteSceneParams) {
    this.params = params;
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
      window.innerWidth / window.innerHeight,
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
    // Limit zoom range: ~1.05 = just above Earth surface (avoid clipping into the
    // globe), 30 = far enough to see GEO satellites (~6.6 R) without the Earth
    // shrinking to a dot.
    this.controls.minDistance = 1.05;
    this.controls.maxDistance = 30;
    this.resetFreeCamera();

    // Notify React when the user finishes manipulating the camera so the view
    // can be persisted. 'end' fires once per drag/zoom gesture, avoiding the
    // per-frame churn of saving on every change.
    const handleControlsEnd = () =>
      this.params.onCameraChange?.(this.getCameraSnapshot());
    this.controls.addEventListener("end", handleControlsEnd);
    this.disposeFns.push(() =>
      this.controls.removeEventListener("end", handleControlsEnd),
    );

    const useLayeredEarth = isLayeredEarthMode(params.earthTexture);
    this.ambientLight = new THREE.AmbientLight(
      0xffffff,
      params.brightEarth ? 1.5 : useLayeredEarth ? 0.28 : 0.2,
    );
    this.scene.add(this.ambientLight);
    this.sunlight = new THREE.DirectionalLight(
      0xffffff,
      params.brightEarth ? 0 : useLayeredEarth ? 1.62 : 1.5,
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
    this.earthGroup.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.earthGroup);

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

    const catalog = this.params.catalog ?? null;
    this.satCount = this.params.satellites.length + (catalog?.count ?? 0);
    const massMode = isMassMode(this.satCount);
    // CPU mode keeps exact SGP4 for every satellite (catalog rows included);
    // mass mode hands all of them to the GPU J2 layer instead.
    this.satRecs = massMode ? [] : [
      ...this.params.satellites.map((spec) => toSatrec(spec)),
      ...Array.from({ length: catalog?.count ?? 0 }, (_, i) => catalogSatrecAt(catalog!, i)),
    ];
    this.massLayer = massMode
      ? new MassSatelliteLayer(
        concatCatalogs([catalogFromSpecs(this.params.satellites), ...(catalog ? [catalog] : [])]),
        this.currentSimDate.getTime(),
        this.params.satRadius,
        { visible: this.satelliteVisibleColor, hidden: this.satelliteHiddenColor, selected: this.satelliteSelectedColor },
      )
      : null;
    const filingMarkers = new Float32Array(this.satRecs.length);
    if (!massMode) {
      this.params.satellites.forEach((s, i) => { filingMarkers[i] = s.meta?.dataStatus === "filing" ? 1 : 0; });
      const offset = this.params.satellites.length;
      for (let i = 0; i < (catalog?.count ?? 0); i++) filingMarkers[offset + i] = isFilingRow(catalog!, i) ? 1 : 0;
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
      shader.vertexShader = "attribute float filingMarker; varying float vFilingMarker;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("gl_PointSize = size;", "vFilingMarker = filingMarker; gl_PointSize = size * (filingMarker > 0.5 ? 1.35 : 1.0);");
      shader.fragmentShader = "varying float vFilingMarker;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", `
        if (vFilingMarker > 0.5) {
          float d = length(gl_PointCoord - 0.5);
          float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.24, 0.32, d);
          if (ring < 0.01) discard;
          diffuseColor.a *= ring;
        } else {
          #include <map_particle_fragment>
        }
      `);
    };
    this.satMaterial.customProgramCacheKey = () => "filing-hollow-ring-v1";
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
    const groundPoints = new THREE.Points(this.groundGeometry, this.groundMaterial);

    this.stationConeGeometries = [];
    this.stationConeMaterials = [];
    this.stationConeMeshes = [];
    const heightNorm = Math.max(this.params.groundConeLength, 0.01);
    this.stationMeshes = this.params.groundStations.map(() => {
      const mesh = new THREE.Mesh(this.stationGeo, this.stationMat);
      const minEl = THREE.MathUtils.clamp(this.params.groundConeMinElevationDeg, 0, 89.9);
      const halfAngle = THREE.MathUtils.degToRad(90 - minEl);
      const baseRadius = heightNorm * Math.tan(halfAngle);
      const coneGeo = new THREE.ConeGeometry(
        baseRadius,
        1,
        STATION_CONE_SEGMENTS,
        1,
        true,
      );
      coneGeo.translate(0, -0.5, 0);
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
      opacity: 0.16,
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

    this.scene.add(satPoints);
    this.scene.add(groundPoints);
    if (this.massLayer) {
      this.scene.add(this.massLayer.points);
      this.scene.add(this.massLayer.groundPoints);
    }
    this.stationMeshes.forEach((m) => this.scene.add(m));
    this.scene.add(this.linkSegments);

    // Initialize KML renderer
    this.kmlRenderer = new KMLRenderer(this.scene);

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

    const handlePointerUp = (event: PointerEvent) => {
      if (!this.pointerDownActive || this.pointerDownId !== event.pointerId) return;
      const wasDrag = this.didDragDuringPointer;
      this.resetPointerInteraction();
      if (wasDrag) return;

      getPointerNdc(event);
      raycaster.params.Points!.threshold = this.params.satRadius * 2;
      raycaster.setFromCamera(pointer, this.camera);
      const stationHits = raycaster.intersectObjects(this.stationMeshes, false);
      if (stationHits.length > 0) {
        const hitObj = stationHits[0].object as THREE.Object3D;
        const idx = this.stationMeshes.findIndex((m) => m === hitObj);
        this.selectStation(idx);
        return;
      }
      // Screen-space picking: a fixed pixel radius regardless of zoom level,
      // skipping satellites hidden behind the Earth (unit sphere at origin).
      const rect = this.renderer.domElement.getBoundingClientRect();
      const radius = event.pointerType === "touch" ? PICK_RADIUS_TOUCH_PX : PICK_RADIUS_MOUSE_PX;
      if (this.massLayer) {
        this.camera.updateMatrixWorld();
        const hits = this.massLayer.pick(this.camera, rect, event.clientX, event.clientY, radius, this.currentSimDate.getTime());
        const next = pickSatelliteHitIndex(hits, this.selectedIndex);
        if (next !== null) this.selectSatellite(next);
        else this.clearSelections();
        return;
      }
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
      const hitIndexes = screenSpaceHits(screenPts, event.clientX, event.clientY, radius);
      const nextIndex = pickSatelliteHitIndex(hitIndexes, this.selectedIndex);
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
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.applyViewOffset();
      this.kmlRenderer.setResolution(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    this.disposeFns.push(() => window.removeEventListener("resize", handleResize));

    this.animate();
  }

  setCameraMode(mode: SatelliteCameraMode) {
    if (mode === this.cameraMode) return;
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

  /** Capture the current camera framing for persistence. */
  getSimulationTime(): Date {
    return new Date(this.currentSimDate.getTime());
  }

  getCameraSnapshot(): CameraSnapshot {
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
   * are NOT handled here — see {@link useSatelliteScene}.
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
    }

    // Ground-station cone geometry depends on the min-elevation and range.
    if (
      next.groundConeMinElevationDeg !== prev.groundConeMinElevationDeg ||
      next.groundConeLength !== prev.groundConeLength
    ) {
      const heightNorm = Math.max(next.groundConeLength, 0.01);
      const minEl = THREE.MathUtils.clamp(next.groundConeMinElevationDeg, 0, 89.9);
      const halfAngle = THREE.MathUtils.degToRad(90 - minEl);
      const baseRadius = heightNorm * Math.tan(halfAngle);
      this.stationConeMeshes.forEach((mesh, idx) => {
        const geo = new THREE.ConeGeometry(baseRadius, 1, STATION_CONE_SEGMENTS, 1, true);
        geo.translate(0, -0.5, 0);
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
   * ECI state (km, km/s) of satellite `i` at `date` from whichever propagator
   * draws it — SGP4 in CPU mode, the GPU layer's J2 twin in mass mode — so
   * orbit lines, tracks and the follow camera stay on the drawn point.
   */
  private propagateIndex(i: number, date: Date): { position: Vec3; velocity: Vec3 | null } | null {
    if (this.massLayer) return this.massLayer.stateAt(i, date.getTime());
    const pv = satellite.propagate(this.satRecs[i], date);
    if (!pv?.position) return null;
    return { position: pv.position, velocity: pv.velocity ?? null };
  }

  private orbitPeriodMinutes(i: number): number {
    return this.massLayer ? this.massLayer.periodMinutes(i) : (2 * Math.PI) / this.satRecs[i].no;
  }

  private selectSatellite(idx: number) {
    this.selectedIndex = idx;
    this.massLayer?.setSelected(idx);
    this.params.onSelect?.(idx);
    this.updateTrack();
    this.resetGroundTrack();
  }

  private clearSatelliteSelection() {
    this.selectedIndex = null;
    this.massLayer?.setSelected(null);
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
    for (let m = 0; m <= trackMinutes; m += 1) {
      const d = new Date(this.currentSimDate.getTime() + m * 60000);
      const pv = this.propagateIndex(satIndex, d);
      if (pv) {
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
      this.islPathPosAttr.setXYZ(v0, fromPos.x, fromPos.y, fromPos.z);
      this.islPathPosAttr.setXYZ(v1, toPos.x, toPos.y, toPos.z);
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
  private viewInset = { left: 0, bottom: 0 };

  /**
   * Shift the rendered image so the globe stays centred in the area not
   * covered by the side panel (desktop, left) or bottom sheet (phones).
   * The panel publishes the covered size on <html data-view-inset-left /
   * data-sheet-inset>; eased here for a smooth slide.
   */
  private updateViewInset() {
    const ds = document.documentElement.dataset;
    const target = {
      left: Number(ds.viewInsetLeft ?? 0) || 0,
      bottom: Number(ds.sheetInset ?? 0) || 0,
    };
    const cur = this.viewInset;
    if (Math.abs(target.left - cur.left) < 0.5 && Math.abs(target.bottom - cur.bottom) < 0.5) return;
    const ease = (from: number, to: number) => {
      const next = from + (to - from) * 0.2;
      return Math.abs(to - next) < 0.5 ? to : next;
    };
    cur.left = ease(cur.left, target.left);
    cur.bottom = ease(cur.bottom, target.bottom);
    this.applyViewOffset();
  }

  private applyViewOffset() {
    const { left, bottom } = this.viewInset;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (left === 0 && bottom === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -left / 2, bottom / 2, w, h);
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
    this.cameraHolder.rotation.y =
      this.params.ecef && this.cameraMode === "free" ? rotAngle : 0;

    const { x: sx, y: sy, z: sz } = sunVectorECI(simDate);
    this.sunlight.position.set(sx * 10, sz * 10, -sy * 10);
    this.sunDot.position.set(sx, sz, -sy);
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
    const satPosition = this.tempVectorB;

    for (let i = 0; i < this.satRecs.length; i++) {
      const rec = this.satRecs[i];
      const pv = satellite.propagate(rec, simDate);
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
          this.pushFovCone(pv.position, pv.velocity ?? null, satPosition, sinHalfAngle, cosHalfAngle);
        }
      } else {
        // Propagation failed: explicitly mark satellite as hidden (no link, no cone).
        // (The ISL routing worker re-propagates independently and applies the
        // same failed-propagation exclusion on its own copy of the satrecs.)
        this.satColorAttr.setXYZ(i, this.satelliteHiddenColor.r, this.satelliteHiddenColor.g, this.satelliteHiddenColor.b);
      }
    }

    if (this.massLayer) {
      const selected = this.updateMassLayer(simDate, gmst, gsEcis, gsScene, sinHalfAngle, cosHalfAngle);
      hasSelectedSat = selected.hasSelectedSat;
      hasSelectedVelocity = selected.hasSelectedVelocity;
    }

    this.linkGeometry.setDrawRange(0, this.linkCount * 2);
    (this.linkGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    this.fovCones.count = this.fovConeCount;
    this.fovCones.instanceMatrix.needsUpdate = true;

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
    if (this.cameraMode === "free") {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  };

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
    a[o] = from.x; a[o + 1] = from.y; a[o + 2] = from.z;
    a[o + 3] = to.x; a[o + 4] = to.y; a[o + 5] = to.z;
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

  /** Append one FOV cone instance; skipped when the cone does not reach the Earth. */
  private pushFovCone(
    positionEci: Vec3,
    velocityEci: Vec3 | null,
    satPosition: THREE.Vector3,
    sinHalfAngle: number,
    cosHalfAngle: number,
  ) {
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
    this.coneMatrix.compose(satPosition, this.coneQuaternion, this.coneScale);
    this.fovCones.setMatrixAt(this.fovConeCount++, this.coneMatrix);
  }

  private readonly drawingBufferSize = new THREE.Vector2();

  /**
   * Mass mode per-frame work: GPU uniforms, plus CPU propagation of only the
   * selected satellite and the capped focus subset (links, FOV cones).
   */
  private updateMassLayer(
    simDate: Date,
    gmst: number,
    gsEcis: Vec3[],
    gsScene: THREE.Vector3[],
    sinHalfAngle: number,
    cosHalfAngle: number,
  ) {
    const layer = this.massLayer!;
    const simMs = simDate.getTime();
    const cosG = Math.cos(gmst);
    const sinG = Math.sin(gmst);
    const stations: MassStation[] = this.params.groundStations.map((gs, gi) => {
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
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    layer.update(simMs, stations, this.drawingBufferSize.y / 2);

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
      if (conesOn && i !== lastSat) this.pushFovCone(st.position, st.velocity, satPosition, sinHalfAngle, cosHalfAngle);
      lastSat = i;
    }

    if (this.selectedIndex === null) return { hasSelectedSat: false, hasSelectedVelocity: false };
    const st = layer.stateAt(this.selectedIndex, simMs);
    satPosition.set(
      st.position.x / EARTH_RADIUS_EQUATOR_KM,
      st.position.z / EARTH_RADIUS_POLAR_KM,
      -st.position.y / EARTH_RADIUS_EQUATOR_KM,
    );
    this.cacheSelectedState(satPosition, st.velocity);
    if (conesOn) this.pushFovCone(st.position, st.velocity, satPosition, sinHalfAngle, cosHalfAngle);
    return { hasSelectedSat: true, hasSelectedVelocity: true };
  }

  private updateCameraFollow(
    hasSelectedSat: boolean,
    hasSelectedVelocity: boolean,
  ) {
    const isFreeCamera = this.cameraMode === "free" || !hasSelectedSat;
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
    this.massLayer?.dispose();
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
    this.linkMaterial.dispose();
    this.islPathMaterial.dispose();
    this.islEndpointMatA.dispose();
    this.islEndpointMatB.dispose();
    
    // Dispose earth mesh
    this.earthResourceDisposers.forEach((dispose) => dispose());
    
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
    this.clearGroundTrack();
    
    // Dispose KML renderer
    this.kmlRenderer.dispose();
    
    this.controls.dispose();
    this.renderer.dispose();
    
    if (this.params.mountRef.current && this.params.mountRef.current.contains(this.renderer.domElement)) {
      this.params.mountRef.current.removeChild(this.renderer.domElement);
    }
  }

  private createEarth() {
    const group = new THREE.Group();
    const geometry = new THREE.SphereGeometry(1, 128, 128);
    const textureLoader = new THREE.TextureLoader();
    const disposeFns: (() => void)[] = [];
    const animatedMaterials: EarthAnimationBinding[] = [];

    let disposed = false;
    disposeFns.push(() => {
      disposed = true;
    });

    const loadTexture = (
      path: string,
      colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
    ) => {
      const texture = textureLoader.load(path);
      texture.colorSpace = colorSpace;
      texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      disposeFns.push(() => texture.dispose());
      return texture;
    };

    // Show the small texture right away, then swap in the large one once it
    // has downloaded. `apply` must point every material slot at the new one.
    const loadProgressiveTexture = (
      source: ProgressiveTexture,
      apply: (texture: THREE.Texture) => void,
      colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
    ) => {
      const initial = loadTexture(source.initial, colorSpace);
      if (source.upgrade) {
        textureLoader.load(source.upgrade, (upgraded) => {
          if (disposed) {
            upgraded.dispose();
            return;
          }
          upgraded.colorSpace = colorSpace;
          upgraded.anisotropy = initial.anisotropy;
          disposeFns.push(() => upgraded.dispose());
          apply(upgraded);
          initial.dispose();
        });
      }
      return initial;
    };

    const darkMonochrome = this.params.earthTexture === DARK_MONOCHROME_EARTH_MODE;
    const paperAtlas = this.params.earthTexture === PAPER_ATLAS_EARTH_MODE;
    const layeredEarthMode = isLayeredEarthMode(this.params.earthTexture)
      ? this.params.earthTexture
      : null;
    const layeredAssets = layeredEarthMode
      ? resolveLayeredEarthAssets(layeredEarthMode, this.renderer.capabilities.maxTextureSize)
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

    if (darkMonochrome || paperAtlas) {
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

    disposeFns.unshift(() => {
      surfaceMesh.geometry.dispose();
      (surfaceMesh.material as THREE.Material).dispose();
    });

    return {
      group,
      disposeFns,
      animatedMaterials,
      setCountryBordersVisible,
      setCloudsVisible,
    };
  }

  private createCountryBorders(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
  ) {
    const geometry = baseGeometry.clone();
    // Unlit so the lines stay readable on the night side, like the graticule.
    const material = new THREE.MeshBasicMaterial({
      color: this.params.whiteBackground ? 0x2b3440 : 0xe6edf5,
      alphaMap: loadTexture(EARTH_ASSETS.countryBorders),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(1.0005);
    group.add(mesh);
    return mesh;
  }

  private createMonochromeSurface(
    geometry: THREE.SphereGeometry,
    group: THREE.Group,
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
    loadProgressiveTexture: ProgressiveTextureLoader,
    paperAtlas: boolean,
  ) {
    // Reuse the data mask without loading day imagery, clouds, or city lights.
    const oceanMask: THREE.IUniform<THREE.Texture> = { value: null! };
    oceanMask.value = loadProgressiveTexture(
      resolveProgressiveTexture(EARTH_ASSETS.oceanMask, this.renderer.capabilities.maxTextureSize),
      (texture) => {
        oceanMask.value = texture;
      },
    );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        oceanMask,
        borderMask: { value: loadTexture(EARTH_ASSETS.countryBorders) },
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
    const material = new THREE.MeshPhongMaterial({
      emissive: new THREE.Color("#394754"),
      emissiveIntensity: this.params.brightEarth ? 0.04 : 0.1,
      specular: new THREE.Color("#1e2833"),
      shininess: 85,
    });
    const dayMap = loadProgressiveTexture(assets.dayMap, (texture) => {
      material.map = texture;
      material.emissiveMap = texture;
    }, THREE.SRGBColorSpace);
    material.map = dayMap;
    material.emissiveMap = dayMap;
    material.specularMap = loadProgressiveTexture(assets.oceanMask, (texture) => {
      material.specularMap = texture;
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  }

  private createEarthClouds(
    baseGeometry: THREE.SphereGeometry,
    group: THREE.Group,
    assets: ReturnType<typeof resolveLayeredEarthAssets>,
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
  ) {
    const geometry = baseGeometry.clone();
    const cloudMap = loadTexture(assets.cloudsMap, THREE.SRGBColorSpace);
    const material = new THREE.MeshPhongMaterial({
      color: 0xfafcff,
      map: cloudMap,
      alphaMap: cloudMap,
      transparent: true,
      opacity: this.params.brightEarth ? 0.24 : 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      shininess: 8,
    });
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
    }, THREE.SRGBColorSpace);
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
          #ifdef DARK_MONOCHROME
            // AdditiveBlending applies alpha; output the blue tint only once.
            gl_FragColor = vec4(atmosphereColor, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          #else
            gl_FragColor = vec4(atmosphereColor * alpha, alpha);
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
