// High-level wrapper around the Three.js scene used by the visualizer.
// Moved from useSatelliteScene for better organization.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { toSatrec } from "./satellites";
import type { SatelliteSpec } from "./satellites";
import type { GroundStation } from "./groundStations";
import {
  sunVectorECI,
  createGraticule,
  createEclipticLine,
  EARTH_FLATTENING,
} from "./astronomy";
import { KMLRenderer } from "./kmlRenderer";
import { loadKMLFromURL } from "./kml";
import { computeFovConeQuaternion, computeTiltedConeHeight } from "./orbitalCoordinates";
import {
  isLayeredEarthMode,
  resolveLayeredEarthAssets,
  type EarthTextureMode,
} from "./earthTextures";

/** Equatorial and polar radii of Earth in kilometres. */
const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

/** Maximum number of shadow trail points to keep in memory */
const MAX_SHADOW_COORDS = 144000; // 100 days at 1 minute intervals

const STATION_CONE_SEGMENTS = 32;
const FOV_CONE_SEGMENTS = 32;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const POINTER_DRAG_THRESHOLD_PX = 5;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 3);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const EARTH_CENTER_MIN_DISTANCE = 0.12;
const EARTH_CENTER_MAX_DISTANCE = 1.8;
const THIRDPERSON_MIN_DISTANCE = 0.12;
const THIRDPERSON_MAX_DISTANCE = 1.8;
const THIRDPERSON_DEFAULT_PITCH = THREE.MathUtils.degToRad(22);
const THIRDPERSON_MIN_PITCH = THREE.MathUtils.degToRad(-70);
const THIRDPERSON_MAX_PITCH = THREE.MathUtils.degToRad(82);
const FOLLOW_LERP_ALPHA = 0.14;

type EarthAnimationBinding = {
  sunDirectionUniform?: THREE.Vector3;
};

export type SatelliteCameraMode = "free" | "earthCenter" | "thirdPerson";

export interface SatelliteSceneParams {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
  satRadius: number;
  earthTexture: EarthTextureMode;
  showGraticule: boolean;
  showEcliptic: boolean;
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
  onSelect?: (idx: number | null) => void;
  onSelectStation?: (idx: number | null) => void;
  onSimTimeChange?: (date: Date) => void;
  stationInfoRef?: React.RefObject<HTMLPreElement | null>;
}

export default class SatelliteScene {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly cameraHolder: THREE.Group;
  private readonly disposeFns: (() => void)[] = [];

  private readonly satRecs: satellite.SatRec[];
  private readonly satPosAttr: THREE.BufferAttribute;
  private readonly satColorAttr: THREE.BufferAttribute;
  private readonly groundPosAttr: THREE.BufferAttribute;
  private readonly stationMeshes: THREE.Mesh[];
  private readonly stationConeGeometries: THREE.ConeGeometry[];
  private readonly stationConeMaterials: THREE.MeshBasicMaterial[];
  private readonly stationConeMeshes: THREE.Mesh[];
  private readonly groundConeColor: THREE.Color;
  private readonly linkGeometries: THREE.BufferGeometry[][];
  private readonly linkLines: THREE.Line[][];
  private readonly earthGroup: THREE.Group;
  private readonly earthResourceDisposers: (() => void)[];
  private readonly earthAnimationBindings: EarthAnimationBinding[];
  private readonly graticule: THREE.LineSegments;
  private readonly ecliptic: THREE.Line;
  private readonly sunDot: THREE.Mesh;
  private readonly sunlight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly kmlRenderer: KMLRenderer;

  private selectedIndex: number | null = null;
  private selectedStationIndex: number | null = null;
  private orbitLine: THREE.Line | null = null;
  private shadowLine: THREE.Line | null = null;
  private shadowStartDate: Date | null = null;
  private currentSimDate: Date;
  private shadowMinutes = 0;
  private shadowCoords: { longitude: number; latitude: number }[] = [];
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
  private fovConeMeshes: THREE.Mesh[];
  private readonly fovConeColor: THREE.Color;
  private readonly satelliteVisibleColor: THREE.Color;
  private readonly satelliteHiddenColor: THREE.Color;
  private readonly satelliteSelectedColor: THREE.Color;
  private readonly fovConeMinHeight: number;
  private linkMaterial: THREE.LineBasicMaterial;

  private readonly startReal: number;
  private readonly startSim: number;
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
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.resetFreeCamera();

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
    this.earthGroup.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.earthGroup);

    this.graticule = createGraticule(20, 0.001);
    this.graticule.visible = this.params.showGraticule;
    this.scene.add(this.graticule);

    this.ecliptic = createEclipticLine(1);
    this.ecliptic.visible = this.params.showEcliptic;
    this.scene.add(this.ecliptic);

    const sunDotGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const sunDotMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.sunDot = new THREE.Mesh(sunDotGeo, sunDotMat);
    this.sunDot.visible = this.params.showSunDirection;
    this.scene.add(this.sunDot);

    this.stationGeo = new THREE.SphereGeometry(0.01, 8, 8);
    this.stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.satRecs = this.params.satellites.map((spec) => toSatrec(spec));

    const satPositions = new Float32Array(this.satRecs.length * 3);
    const satColors = new Float32Array(this.satRecs.length * 3);
    this.satGeometry = new THREE.BufferGeometry();
    this.satPosAttr = new THREE.BufferAttribute(satPositions, 3);
    this.satColorAttr = new THREE.BufferAttribute(satColors, 3);
    this.satGeometry.setAttribute("position", this.satPosAttr);
    this.satGeometry.setAttribute("color", this.satColorAttr);
    const textureCircle = new THREE.TextureLoader().load("./assets/circle.png");
    this.satMaterial = new THREE.PointsMaterial({
      size: this.params.satRadius * 2,
      map: textureCircle,
      transparent: true,
      sizeAttenuation: true,
      vertexColors: true,
    });
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
    this.linkMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.linkGeometries = this.params.groundStations.map(() =>
      this.satRecs.map(() => new THREE.BufferGeometry()),
    );
    this.linkLines = this.linkGeometries.map((arr) =>
      arr.map((g) => new THREE.Line(g, this.linkMaterial)),
    );

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
    this.fovConeMeshes = this.satRecs.map(() => {
      const mesh = new THREE.Mesh(this.fovConeGeometry, this.fovConeMaterial);
      mesh.visible = this.params.showSatelliteFovCones;
      this.scene.add(mesh);
      return mesh;
    });

    this.scene.add(satPoints);
    this.scene.add(groundPoints);
    this.stationMeshes.forEach((m) => this.scene.add(m));
    this.linkLines.forEach((arr) => {
      arr.forEach((l) => {
        l.visible = false;
        this.scene.add(l);
      });
    });

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
      const hits = raycaster.intersectObject(satPoints, false);
      if (hits.length > 0 && hits[0].index !== undefined) {
        this.selectSatellite(hits[0].index);
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
          ? [this.earthCenterDistance, EARTH_CENTER_MIN_DISTANCE, EARTH_CENTER_MAX_DISTANCE]
          : [this.thirdPersonDistance, THIRDPERSON_MIN_DISTANCE, THIRDPERSON_MAX_DISTANCE];
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

    this.startReal = Date.now();
    this.startSim = this.params.startTime.getTime();

    const handleResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
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
      return;
    }

    const snapshot = this.getSelectedSatelliteSnapshot();
    if (mode === "earthCenter" && snapshot) {
      this.earthCenterDistance = this.getDefaultEarthCenterDistance(snapshot.position);
    }
    if (mode === "thirdPerson" && snapshot) {
      this.thirdPersonDistance = this.getDefaultThirdPersonDistance(snapshot.position);
      this.thirdPersonPitch = THIRDPERSON_DEFAULT_PITCH;
      if (snapshot.velocity && snapshot.velocity.lengthSq() > 1e-8) {
        this.followBasis.copy(snapshot.velocity).normalize();
      }
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
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.camera.up.copy(UP_AXIS);
    this.camera.lookAt(DEFAULT_CAMERA_TARGET);
    this.controls.update();
  }

  private getSelectedSatelliteSnapshot() {
    if (this.selectedIndex === null) return null;
    const rec = this.satRecs[this.selectedIndex];
    const pv = satellite.propagate(rec, this.currentSimDate);
    if (!pv?.position) return null;

    const position = new THREE.Vector3(
      pv.position.x / EARTH_RADIUS_EQUATOR_KM,
      pv.position.z / EARTH_RADIUS_POLAR_KM,
      -pv.position.y / EARTH_RADIUS_EQUATOR_KM,
    );
    const velocity = pv.velocity
      ? new THREE.Vector3(
          pv.velocity.x,
          pv.velocity.z,
          -pv.velocity.y,
        ).multiplyScalar(1 / EARTH_RADIUS_EQUATOR_KM)
      : null;

    return { position, velocity };
  }

  private getDefaultEarthCenterDistance(selectedSatPosition: THREE.Vector3) {
    const altitude = Math.max(selectedSatPosition.length() - 1, 0);
    return THREE.MathUtils.clamp(
      0.32 + altitude * 0.9,
      EARTH_CENTER_MIN_DISTANCE,
      EARTH_CENTER_MAX_DISTANCE,
    );
  }

  private getDefaultThirdPersonDistance(selectedSatPosition: THREE.Vector3) {
    const altitude = Math.max(selectedSatPosition.length() - 1, 0);
    return THREE.MathUtils.clamp(
      0.24 + altitude * 1.35,
      THIRDPERSON_MIN_DISTANCE,
      THIRDPERSON_MAX_DISTANCE,
    );
  }

  private selectStation(idx: number | null) {
    this.selectedStationIndex = idx;
    this.params.onSelectStation?.(idx);
  }

  private resetShadowTrack() {
    this.shadowStartDate = this.currentSimDate;
    this.shadowMinutes = 0;
    this.shadowCoords = [];
    if (this.shadowLine) {
      this.shadowLine.geometry.dispose();
      this.scene.remove(this.shadowLine);
    }
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffff });
    this.shadowLine = new THREE.Line(new THREE.BufferGeometry(), mat);
    this.scene.add(this.shadowLine);
    this.updateShadow();
  }

  private clearShadowTrack() {
    this.shadowStartDate = null;
    this.shadowMinutes = 0;
    this.shadowCoords = [];
    if (this.shadowLine) {
      this.shadowLine.geometry.dispose();
      this.scene.remove(this.shadowLine);
      this.shadowLine = null;
    }
  }

  private selectSatellite(idx: number) {
    this.selectedIndex = idx;
    this.params.onSelect?.(idx);
    this.updateTrack();
    this.resetShadowTrack();
  }

  private clearSatelliteSelection() {
    this.selectedIndex = null;
    this.params.onSelect?.(null);
    this.updateTrack();
    this.clearShadowTrack();
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
    const rec = this.satRecs[this.selectedIndex];
    const points: THREE.Vector3[] = [];
    const periodMinutes = (2 * Math.PI) / rec.no;
    const trackMinutes = Math.round(periodMinutes * 2);
    for (let m = 0; m <= trackMinutes; m += 1) {
      const d = new Date(this.currentSimDate.getTime() + m * 60000);
      const pv = satellite.propagate(rec, d);
      if (pv?.position) {
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
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.orbitLine = new THREE.Line(geom, mat);
    this.scene.add(this.orbitLine);
  }

  private updateShadow() {
    if (!this.shadowLine || this.selectedIndex === null || !this.shadowStartDate) return;
    const rec = this.satRecs[this.selectedIndex];
    const totalMinutes = Math.ceil((this.currentSimDate.getTime() - this.shadowStartDate.getTime()) / 60000);
    for (let m = this.shadowMinutes; m <= totalMinutes; m += 1) {
      const d = new Date(this.shadowStartDate.getTime() + m * 60000);
      const pv = satellite.propagate(rec, d);
      if (pv?.position) {
        const gmst = satellite.gstime(d);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        this.shadowCoords.push({ longitude: geo.longitude, latitude: geo.latitude });
        
        // Limit the array size to prevent unbounded growth
        if (this.shadowCoords.length > MAX_SHADOW_COORDS) {
          this.shadowCoords.shift(); // Remove oldest point
        }
      }
    }
    this.shadowMinutes = totalMinutes;
    const gmstNow = satellite.gstime(this.currentSimDate);
    const pts = this.shadowCoords.map((gd) => {
      const ecf = satellite.geodeticToEcf({
        longitude: gd.longitude,
        latitude: gd.latitude,
        height: EARTH_RADIUS_EQUATOR_KM * 0.001,
      });
      const eci = satellite.ecfToEci(ecf, gmstNow);
      return new THREE.Vector3(eci.x / EARTH_RADIUS_EQUATOR_KM, eci.z / EARTH_RADIUS_POLAR_KM, -eci.y / EARTH_RADIUS_EQUATOR_KM);
    });
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    this.shadowLine.geometry.dispose();
    this.shadowLine.geometry = geom;
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const nowReal = Date.now();
    const simDeltaMs = (nowReal - this.startReal) * this.params.speedRef.current;
    const simDate = new Date(this.startSim + simDeltaMs);
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
    const tmpQuat = new THREE.Quaternion();
    const tmpDir = new THREE.Vector3();
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

    for (let i = 0; i < this.satRecs.length; i++) {
      const rec = this.satRecs[i];
      const pv = satellite.propagate(rec, simDate);
      if (pv?.position) {
        const { x, y, z } = pv.position;
        const satPosition = new THREE.Vector3(
          x / EARTH_RADIUS_EQUATOR_KM,
          z / EARTH_RADIUS_POLAR_KM,
          -y / EARTH_RADIUS_EQUATOR_KM,
        );
        this.satPosAttr.setXYZ(i, satPosition.x, satPosition.y, satPosition.z);
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
        this.params.groundStations.forEach((_, gi) => {
          const look = satellite.ecfToLookAngles(observerGds[gi], satEcf);
          // Visibility is determined solely by elevation angle to support satellites at any altitude
          const visible = look.elevation > minElevationRads[gi];
          if (visible) {
            anyVisible = true;
            const p1 = new THREE.Vector3(
              gsEcis[gi].x / EARTH_RADIUS_EQUATOR_KM,
              gsEcis[gi].z / EARTH_RADIUS_POLAR_KM,
              -gsEcis[gi].y / EARTH_RADIUS_EQUATOR_KM,
            );
            this.linkGeometries[gi][i].setFromPoints([p1, satPosition.clone()]);
            this.linkLines[gi][i].visible = true;
          } else {
            this.linkLines[gi][i].visible = false;
          }
        });
        if (this.selectedIndex === i) {
          this.cachedSelectedPosition.copy(satPosition);
          hasSelectedSat = true;
          if (pv.velocity) {
            this.cachedSelectedVelocity.set(
              pv.velocity.x,
              pv.velocity.z,
              -pv.velocity.y,
            ).multiplyScalar(1 / EARTH_RADIUS_EQUATOR_KM);
            hasSelectedVelocity = true;
            if (this.cachedSelectedVelocity.lengthSq() > 1e-8) {
              this.followBasis.copy(this.cachedSelectedVelocity).normalize();
            }
          }
          this.satColorAttr.setXYZ(i, this.satelliteSelectedColor.r, this.satelliteSelectedColor.g, this.satelliteSelectedColor.b);
        } else if (anyVisible) {
          this.satColorAttr.setXYZ(i, this.satelliteVisibleColor.r, this.satelliteVisibleColor.g, this.satelliteVisibleColor.b);
        } else {
          this.satColorAttr.setXYZ(i, this.satelliteHiddenColor.r, this.satelliteHiddenColor.g, this.satelliteHiddenColor.b);
        }

        const cone = this.fovConeMeshes[i];
        if (cone) {
          if (this.params.showSatelliteFovCones) {
            const hasTilt = this.params.fovConeAlongTrackDeg !== 0 || this.params.fovConeCrossTrackDeg !== 0;
            let coneHeightKm: number | null = null;

            if (hasTilt && pv.velocity) {
              // Use ray-sphere intersection for tilted cones
              coneHeightKm = computeTiltedConeHeight(
                pv.position,
                pv.velocity,
                this.params.fovConeAlongTrackDeg,
                this.params.fovConeCrossTrackDeg,
                this.params.fovConeHalfAngleDeg,
                EARTH_RADIUS_EQUATOR_KM,
              );
            } else {
              // Use nadir-based calculation for non-tilted cones
              const rSat = Math.sqrt(x * x + y * y + z * z);
              const sinTerm = rSat * sinHalfAngle;
              const underRoot = (EARTH_RADIUS_EQUATOR_KM * EARTH_RADIUS_EQUATOR_KM) - (sinTerm * sinTerm);
              if (underRoot > 0 && sinHalfAngle > 0) {
                const sqrtTerm = Math.sqrt(underRoot);
                const slantLengthKm = rSat * cosHalfAngle - sqrtTerm;
                if (slantLengthKm > 0) {
                  coneHeightKm = slantLengthKm * cosHalfAngle;
                }
              }
            }

            if (coneHeightKm !== null && coneHeightKm > 0) {
              const normalizedHeight = coneHeightKm / EARTH_RADIUS_EQUATOR_KM;
              const clampedHeight = Math.max(normalizedHeight, this.fovConeMinHeight);
              cone.visible = true;
              cone.position.copy(satPosition);
              cone.scale.setScalar(clampedHeight);
              // Use LVLH coordinate system if velocity is available
              if (pv.velocity) {
                const fovQuat = computeFovConeQuaternion(
                  pv.position,
                  pv.velocity,
                  this.params.fovConeAlongTrackDeg,
                  this.params.fovConeCrossTrackDeg,
                );
                if (fovQuat) {
                  cone.quaternion.copy(fovQuat);
                } else {
                  // Fallback to pure nadir if LVLH computation fails
                  tmpDir.copy(satPosition).normalize().negate();
                  if (tmpDir.lengthSq() > 0) {
                    tmpQuat.setFromUnitVectors(DOWN_AXIS, tmpDir);
                    cone.quaternion.copy(tmpQuat);
                  }
                }
              } else {
                // Fallback when velocity is not available
                tmpDir.copy(satPosition).normalize().negate();
                if (tmpDir.lengthSq() > 0) {
                  tmpQuat.setFromUnitVectors(DOWN_AXIS, tmpDir);
                  cone.quaternion.copy(tmpQuat);
                }
              }
            } else {
              cone.visible = false;
            }
          } else {
            cone.visible = false;
          }
        }
      } else {
        // Propagation failed: explicitly mark satellite as hidden and hide link lines
        this.satColorAttr.setXYZ(i, this.satelliteHiddenColor.r, this.satelliteHiddenColor.g, this.satelliteHiddenColor.b);
        this.params.groundStations.forEach((_, gi) => {
          this.linkLines[gi][i].visible = false;
        });
        const cone = this.fovConeMeshes[i];
        if (cone) {
          cone.visible = false;
        }
      }
    }

    this.satPosAttr.needsUpdate = true;
    this.satColorAttr.needsUpdate = true;
    this.groundPosAttr.needsUpdate = true;

    this.updateShadow();

    if (this.params.timeRef.current) this.params.timeRef.current.textContent = this.formatTime(simDate);

    this.updateCameraFollow(hasSelectedSat, hasSelectedVelocity);
    if (this.cameraMode === "free") {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  };

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
  async loadKML(url: string): Promise<void> {
    try {
      const kmlDoc = await loadKMLFromURL(url);
      this.kmlRenderer.renderKMLDocument(kmlDoc);
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
    this.linkGeometries.forEach(arr => arr.forEach(g => g.dispose()));
    
    // Dispose all materials
    this.satMaterial.dispose();
    if (this.satMaterial.map) this.satMaterial.map.dispose();
    this.groundMaterial.dispose();
    if (this.groundMaterial.map) this.groundMaterial.map.dispose();
    this.stationMat.dispose();
    this.stationConeMaterials.forEach((m) => m.dispose());
    this.fovConeMaterial.dispose();
    this.linkMaterial.dispose();
    
    // Dispose earth mesh
    this.earthResourceDisposers.forEach((dispose) => dispose());
    
    // Dispose graticule, ecliptic, and sun dot
    this.graticule.geometry.dispose();
    this.ecliptic.geometry.dispose();
    this.sunDot.geometry.dispose();
    if (this.sunDot.material instanceof THREE.Material) {
      this.sunDot.material.dispose();
    }
    
    if (this.orbitLine) {
      this.orbitLine.geometry.dispose();
    }
    if (this.shadowLine) {
      this.shadowLine.geometry.dispose();
      this.scene.remove(this.shadowLine);
      this.shadowLine = null;
    }
    
    this.shadowMinutes = 0;
    this.shadowCoords = [];
    
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

    const layeredEarthMode = isLayeredEarthMode(this.params.earthTexture)
      ? this.params.earthTexture
      : null;
    const layeredAssets = layeredEarthMode
      ? resolveLayeredEarthAssets(layeredEarthMode, this.renderer.capabilities.maxTextureSize)
      : null;

    const surfaceMesh = layeredAssets
      ? this.createLayeredEarthSurface(geometry, group, layeredAssets, loadTexture)
      : this.createBasicEarthSurface(geometry, group, loadTexture);

    if (layeredAssets) {
      const cloudMesh = this.createEarthClouds(geometry, group, layeredAssets, loadTexture);
      if (cloudMesh) {
        disposeFns.push(() => {
          cloudMesh!.geometry.dispose();
          (cloudMesh!.material as THREE.Material).dispose();
        });
      }
      const nightLights = this.createNightLights(geometry, group, layeredAssets, loadTexture);
      disposeFns.push(() => {
        nightLights.geometry.dispose();
        (nightLights.material as THREE.Material).dispose();
      });
      animatedMaterials.push(nightLights.userData.shaderEntry);

      const atmosphere = this.createAtmosphere(geometry, group);
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
    };
  }

  private createBasicEarthSurface(
    geometry: THREE.SphereGeometry,
    group: THREE.Group,
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
  ) {
    const texture = loadTexture(this.params.earthTexture, THREE.SRGBColorSpace);
    const material = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  }

  private createLayeredEarthSurface(
    geometry: THREE.SphereGeometry,
    group: THREE.Group,
    assets: ReturnType<typeof resolveLayeredEarthAssets>,
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
  ) {
    const dayMap = loadTexture(assets.dayMap, THREE.SRGBColorSpace);
    const normalMap = loadTexture(assets.normalMap);
    const oceanMask = loadTexture(assets.oceanMask);
    const material = new THREE.MeshPhongMaterial({
      map: dayMap,
      emissive: new THREE.Color("#394754"),
      emissiveMap: dayMap,
      emissiveIntensity: this.params.brightEarth ? 0.04 : 0.1,
      normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      specularMap: oceanMask,
      specular: new THREE.Color("#1e2833"),
      shininess: 85,
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
    loadTexture: (path: string, colorSpace?: THREE.ColorSpace) => THREE.Texture,
  ) {
    const geometry = baseGeometry.clone();
    const lightsMap = loadTexture(assets.lightsMap, THREE.SRGBColorSpace);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        lightsMap: { value: lightsMap },
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

  private createAtmosphere(baseGeometry: THREE.SphereGeometry, group: THREE.Group) {
    const outer = this.createAtmosphereLayer(baseGeometry, group, {
      side: THREE.BackSide,
      scale: 1.055,
      glowStrength: this.params.brightEarth ? 0.14 : 0.22,
      sunFloor: 0.22,
      fresnelPower: 2.6,
      color: "#4f97ff",
    });
    const inner = this.createAtmosphereLayer(baseGeometry, group, {
      side: THREE.FrontSide,
      scale: 1.016,
      glowStrength: this.params.brightEarth ? 0.045 : 0.08,
      sunFloor: 0.32,
      fresnelPower: 1.35,
      color: "#a8d4ff",
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
    const material = new THREE.ShaderMaterial({
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
          gl_FragColor = vec4(atmosphereColor * alpha, alpha);
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
