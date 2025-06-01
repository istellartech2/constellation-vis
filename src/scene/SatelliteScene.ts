// High-level wrapper around the Three.js scene used by the visualizer.
// Moved from useSatelliteScene for better organization.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { toSatrec } from "../data/satellites";
import type { SatelliteSpec } from "../data/satellites";
import type { GroundStation } from "../data/groundStations";
import {
  sunVectorECI,
  createGraticule,
  createEclipticLine,
  EARTH_FLATTENING,
} from "../utils/sceneHelpers";

/** Equatorial and polar radii of Earth in kilometres. */
const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

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
  onSelect?: (idx: number | null) => void;
  onSelectStation?: (idx: number | null) => void;
  stationInfoRef?: React.RefObject<HTMLPreElement | null>;
}

export default class SatelliteScene {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly disposeFns: (() => void)[] = [];

  private readonly satRecs: satellite.SatRec[];
  private readonly satPosAttr: THREE.BufferAttribute;
  private readonly satColorAttr: THREE.BufferAttribute;
  private readonly groundPosAttr: THREE.BufferAttribute;
  private readonly stationMeshes: THREE.Mesh[];
  private readonly linkGeometries: THREE.BufferGeometry[][];
  private readonly linkLines: THREE.Line[][];
  private readonly earthMesh: THREE.Mesh;
  private readonly graticule: THREE.LineSegments;
  private readonly ecliptic: THREE.Line;
  private readonly sunDot: THREE.Mesh;
  private readonly sunlight: THREE.DirectionalLight;

  private selectedIndex: number | null = null;
  private selectedStationIndex: number | null = null;
  private orbitLine: THREE.Line | null = null;
  private shadowLine: THREE.Line | null = null;
  private shadowStartDate: Date | null = null;
  private currentSimDate: Date;
  private shadowMinutes = 0;
  private shadowCoords: { longitude: number; latitude: number }[] = [];

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambient);
    this.sunlight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.scene.add(this.sunlight);

    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    const texture = new THREE.TextureLoader().load(this.params.earthTexture);
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    this.earthMesh.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.earthMesh);

    this.graticule = createGraticule(20);
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

    const stationGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.satRecs = this.params.satellites.map((spec) => toSatrec(spec));

    const satPositions = new Float32Array(this.satRecs.length * 3);
    const satColors = new Float32Array(this.satRecs.length * 3);
    const satGeometry = new THREE.BufferGeometry();
    this.satPosAttr = new THREE.BufferAttribute(satPositions, 3);
    this.satColorAttr = new THREE.BufferAttribute(satColors, 3);
    satGeometry.setAttribute("position", this.satPosAttr);
    satGeometry.setAttribute("color", this.satColorAttr);
    const textureCircle = new THREE.TextureLoader().load("/assets/circle.png");
    const satMaterial = new THREE.PointsMaterial({
      size: this.params.satRadius * 2,
      map: textureCircle,
      transparent: true,
      sizeAttenuation: true,
      vertexColors: true,
    });
    const satPoints = new THREE.Points(satGeometry, satMaterial);

    const groundPositions = new Float32Array(this.satRecs.length * 3);
    const groundGeometry = new THREE.BufferGeometry();
    this.groundPosAttr = new THREE.BufferAttribute(groundPositions, 3);
    groundGeometry.setAttribute("position", this.groundPosAttr);
    const groundMaterial = new THREE.PointsMaterial({
      color: 0xa9a9a9,
      map: textureCircle,
      transparent: true,
      size: 0.01,
      sizeAttenuation: true,
    });
    const groundPoints = new THREE.Points(groundGeometry, groundMaterial);

    this.stationMeshes = this.params.groundStations.map(() => new THREE.Mesh(stationGeo, stationMat));
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.linkGeometries = this.params.groundStations.map(() =>
      this.satRecs.map(() => new THREE.BufferGeometry()),
    );
    this.linkLines = this.linkGeometries.map((arr) =>
      arr.map((g) => new THREE.Line(g, linkMaterial)),
    );

    this.scene.add(satPoints);
    this.scene.add(groundPoints);
    this.stationMeshes.forEach((m) => this.scene.add(m));
    this.linkLines.forEach((arr) => {
      arr.forEach((l) => {
        l.visible = false;
        this.scene.add(l);
      });
    });

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
        const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
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
      }
    }
    this.shadowMinutes = totalMinutes;
    const gmstNow = satellite.gstime(this.currentSimDate);
    const pts = this.shadowCoords.map((gd) => {
      const ecf = satellite.geodeticToEcf({ longitude: gd.longitude, latitude: gd.latitude, height: 0 });
      const eci = satellite.ecfToEci(ecf, gmstNow);
      return new THREE.Vector3(eci.x / EARTH_RADIUS_EQUATOR_KM, eci.z / EARTH_RADIUS_POLAR_KM, -eci.y / EARTH_RADIUS_EQUATOR_KM);
    });
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    this.shadowLine.geometry.dispose();
    this.shadowLine.geometry = geom;
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const nowReal = Date.now();
    const simDeltaMs = (nowReal - this.startReal) * this.params.speedRef.current;
    const simDate = new Date(this.startSim + simDeltaMs);
    this.currentSimDate = simDate;

    const rotAngle = satellite.gstime(simDate);
    this.earthMesh.rotation.y = rotAngle;
    this.graticule.rotation.y = rotAngle;

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

    this.stationMeshes.forEach((m, idx) => {
      const p = gsEcis[idx];
      m.position.set(
        p.x / EARTH_RADIUS_EQUATOR_KM,
        p.z / EARTH_RADIUS_POLAR_KM,
        -p.y / EARTH_RADIUS_EQUATOR_KM,
      );
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
        this.satPosAttr.setXYZ(
          i,
          x / EARTH_RADIUS_EQUATOR_KM,
          z / EARTH_RADIUS_POLAR_KM,
          -y / EARTH_RADIUS_EQUATOR_KM,
        );
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
          const visible = look.elevation > minElevationRads[gi];
          if (visible) {
            anyVisible = true;
            const p1 = new THREE.Vector3(
              gsEcis[gi].x / EARTH_RADIUS_EQUATOR_KM,
              gsEcis[gi].z / EARTH_RADIUS_POLAR_KM,
              -gsEcis[gi].y / EARTH_RADIUS_EQUATOR_KM,
            );
            const p2 = new THREE.Vector3(
              x / EARTH_RADIUS_EQUATOR_KM,
              z / EARTH_RADIUS_POLAR_KM,
              -y / EARTH_RADIUS_EQUATOR_KM,
            );
            this.linkGeometries[gi][i].setFromPoints([p1, p2]);
            this.linkLines[gi][i].visible = true;
          } else {
            this.linkLines[gi][i].visible = false;
          }
        });
        const c = new THREE.Color(anyVisible ? 0x00ff00 : 0xff0000);
        this.satColorAttr.setXYZ(i, c.r, c.g, c.b);
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

  dispose() {
    this.disposeFns.forEach((fn) => fn());
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
    this.renderer.dispose();
    this.satPosAttr.array = new Float32Array();
    this.satColorAttr.array = new Float32Array();
    this.groundPosAttr.array = new Float32Array();
    if (this.params.mountRef.current && this.params.mountRef.current.contains(this.renderer.domElement)) {
      this.params.mountRef.current.removeChild(this.renderer.domElement);
    }
  }
}

