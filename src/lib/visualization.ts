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

/** Equatorial and polar radii of Earth in kilometres. */
const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

/** Maximum number of shadow trail points to keep in memory */
const MAX_SHADOW_COORDS = 144000; // 100 days at 1 minute intervals

const STATION_CONE_SEGMENTS = 32;
const FOV_CONE_SEGMENTS = 32;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

export interface SatelliteSceneParams {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
  satRadius: number;
  earthTexture: string;
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
  /** Rotate the camera with the Earth to approximate an ECEF view */
  ecef: boolean;
  /** Show bright earth (uniform lighting) */
  brightEarth: boolean;
  onSelect?: (idx: number | null) => void;
  onSelectStation?: (idx: number | null) => void;
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
  private readonly earthMesh: THREE.Mesh;
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

  private params: SatelliteSceneParams;

  constructor(params: SatelliteSceneParams) {
    this.params = params;
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

    this.ambientLight = new THREE.AmbientLight(0xffffff, params.brightEarth ? 1.5 : 0.2);
    this.scene.add(this.ambientLight);
    this.sunlight = new THREE.DirectionalLight(0xffffff, params.brightEarth ? 0 : 1.5);
    this.scene.add(this.sunlight);

    this.groundConeColor = new THREE.Color(this.params.groundConeColor);
    this.fovConeColor = new THREE.Color(this.params.fovConeColor);
    this.satelliteVisibleColor = new THREE.Color(this.params.satelliteVisibleColor);
    this.satelliteHiddenColor = new THREE.Color(this.params.satelliteHiddenColor);
    this.satelliteSelectedColor = new THREE.Color(this.params.satelliteSelectedColor);
    const minHeight = Math.max(this.params.fovConeMinHeight, 0.001);
    this.fovConeMinHeight = minHeight;

    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    const texture = new THREE.TextureLoader().load(this.params.earthTexture);
    texture.colorSpace = THREE.SRGBColorSpace;
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    this.earthMesh.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.earthMesh);

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
    const handlePointer = (event: PointerEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.params.Points!.threshold = this.params.satRadius * 2;
      raycaster.setFromCamera(pointer, this.camera);
      const stationHits = raycaster.intersectObjects(this.stationMeshes, false);
      if (stationHits.length > 0) {
        const hitObj = stationHits[0].object as THREE.Object3D;
        const idx = this.stationMeshes.findIndex((m) => m === hitObj);
        this.selectedStationIndex = idx;
        if (this.params.onSelectStation) this.params.onSelectStation(idx);
        return;
      }
      const hits = raycaster.intersectObject(satPoints, false);
      if (hits.length > 0 && hits[0].index !== undefined) {
        this.selectedIndex = hits[0].index;
        if (this.params.onSelect) this.params.onSelect(this.selectedIndex);
        this.updateTrack();
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
      } else {
        this.selectedIndex = null;
        if (this.params.onSelect) this.params.onSelect(null);
        this.selectedStationIndex = null;
        if (this.params.onSelectStation) this.params.onSelectStation(null);
        this.updateTrack();
        this.shadowStartDate = null;
        this.shadowMinutes = 0;
        this.shadowCoords = [];
        if (this.shadowLine) {
          this.shadowLine.geometry.dispose();
          this.scene.remove(this.shadowLine);
          this.shadowLine = null;
        }
      }
    };
    this.renderer.domElement.addEventListener("pointerdown", handlePointer);
    this.disposeFns.push(() => {
      this.renderer.domElement.removeEventListener("pointerdown", handlePointer);
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

    const rotAngle = satellite.gstime(simDate);
    this.earthMesh.rotation.y = rotAngle;
    this.graticule.rotation.y = rotAngle;
    this.kmlRenderer.updateRotation(rotAngle);
    this.cameraHolder.rotation.y = this.params.ecef ? rotAngle : 0;

    const { x: sx, y: sy, z: sz } = sunVectorECI(simDate);
    this.sunlight.position.set(sx * 10, sz * 10, -sy * 10);
    this.sunDot.position.set(sx, sz, -sy);

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

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

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
    this.earthMesh.geometry.dispose();
    if (this.earthMesh.material instanceof THREE.Material) {
      this.earthMesh.material.dispose();
      const mat = this.earthMesh.material as THREE.MeshPhongMaterial;
      if (mat.map) {
        mat.map.dispose();
      }
    }
    
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
}
