import { useEffect } from "react";
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
} from "../utils/sceneHelpers";

/** Radius of Earth in kilometres, used to normalise coordinates. */
const EARTH_RADIUS_KM = 6371;
// const SIDEREAL_DAY_SEC = 86164;

interface Params {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
  satRadius: number;
  onSelect?: (idx: number | null) => void;
  onSelectStation?: (idx: number | null) => void;
  stationInfoRef?: React.RefObject<HTMLPreElement | null>;
}

/**
 * Create and update the Three.js scene used to render the Earth, satellites and
 * ground stations. The scene is attached to the element pointed by
 * `mountRef` and cleaned up automatically when the component unmounts.
 */
export function useSatelliteScene({
  mountRef,
  timeRef,
  speedRef,
  startTime,
  satellites,
  groundStations,
  satRadius,
  onSelect,
  onSelectStation,
  stationInfoRef,
}: Params) {
  useEffect(() => {
    // DOM node where the renderer will be attached
    if (!mountRef.current) return;
    const mountNode = mountRef.current;

    // Basic Three.js scene setup ------------------------------------------------

    // Scene, camera and renderer ------------------------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(renderer.domElement);

    // Camera controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;

    // Lighting setup
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xffffff, 1.5);
    scene.add(sunlight);

    // Earth model --------------------------------------------------------------
    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    const texture = new THREE.TextureLoader().load("/assets/8081_earthmap4k.webp");
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earthMesh);

    // Reference lines
    const graticule = createGraticule(20);
    scene.add(graticule);

    const ecliptic = createEclipticLine(1);
    scene.add(ecliptic);

    // Small marker for the sun position
    const sunDotGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const sunDotMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const sunDot = new THREE.Mesh(sunDotGeo, sunDotMat);
    scene.add(sunDot);

    // Geometries for satellites, their subpoints and ground stations
    const stationGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const satRecs = satellites.map((spec) => toSatrec(spec));

    // --- Satellites rendered as a single Points object ----------------------
    const satPositions = new Float32Array(satRecs.length * 3);
    const satColors = new Float32Array(satRecs.length * 3);
    const satGeometry = new THREE.BufferGeometry();
    const satPosAttr = new THREE.BufferAttribute(satPositions, 3);
    const satColorAttr = new THREE.BufferAttribute(satColors, 3);
    satGeometry.setAttribute('position', satPosAttr);
    satGeometry.setAttribute('color', satColorAttr);
    const texture_circle = new THREE.TextureLoader().load('/assets/circle.png');
    const satMaterial = new THREE.PointsMaterial({
      size: satRadius * 2,
      map: texture_circle,
      transparent: true,
      sizeAttenuation: true,
      vertexColors: true,
    });
    const satPoints = new THREE.Points(satGeometry, satMaterial);

    // --- Ground subpoints rendered as a single Points object ----------------
    const groundPositions = new Float32Array(satRecs.length * 3);
    const groundGeometry = new THREE.BufferGeometry();
    const groundPosAttr = new THREE.BufferAttribute(groundPositions, 3);
    groundGeometry.setAttribute('position', groundPosAttr);
    const groundMaterial = new THREE.PointsMaterial({
      color: 0xa9a9a9,
      map: texture_circle,
      transparent: true,
      size: 0.01,
      sizeAttenuation: true,
    });
    const groundPoints = new THREE.Points(groundGeometry, groundMaterial);

    const stationMeshes = groundStations.map(() => new THREE.Mesh(stationGeo, stationMat));
    // Lines connecting visible satellites to ground stations
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const linkGeometries = groundStations.map(() =>
      satRecs.map(() => new THREE.BufferGeometry()),
    );
    const linkLines = linkGeometries.map((arr) =>
      arr.map((g) => new THREE.Line(g, linkMaterial)),
    );

    // Add all objects to the scene
    scene.add(satPoints);
    scene.add(groundPoints);
    stationMeshes.forEach((m) => scene.add(m));
    linkLines.forEach((arr) => {
      arr.forEach((l) => {
        l.visible = false;
        scene.add(l);
      });
    });

    // Selection handling ------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let selectedIndex: number | null = null;
    let selectedStationIndex: number | null = null;
    let orbitLine: THREE.Line | null = null;
    let currentSimDate = startTime;

    // When a satellite is selected, draw lines showing two full orbits
    // starting from the current simulation time.
    function updateTrack() {
      if (orbitLine) {
        orbitLine.geometry.dispose();
        scene.remove(orbitLine);
        orbitLine = null;
      }
      if (selectedIndex === null) return;
      const rec = satRecs[selectedIndex];
      const points: THREE.Vector3[] = [];
      const periodMinutes = (2 * Math.PI) / rec.no; // minutes per orbit
      const trackMinutes = Math.round(periodMinutes * 2); // two orbits
      for (let m = 0; m <= trackMinutes; m += 1) {
        const d = new Date(currentSimDate.getTime() + m * 60000);
        const pv = satellite.propagate(rec, d);
        if (pv?.position) {
          const { x, y, z } = pv.position;
          points.push(
            new THREE.Vector3(
              x / EARTH_RADIUS_KM,
              z / EARTH_RADIUS_KM,
              -y / EARTH_RADIUS_KM,
            ),
          );
        }
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
      orbitLine = new THREE.Line(geom, mat);
      scene.add(orbitLine);
    }

    // Check if a ground station or satellite was clicked/tapped and update selection state.
    function handlePointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.params.Points!.threshold = satRadius * 2;
      raycaster.setFromCamera(pointer, camera);
      const stationHits = raycaster.intersectObjects(stationMeshes, false);
      if (stationHits.length > 0) {
        const hitObj = stationHits[0].object as THREE.Object3D;
        const idx = stationMeshes.findIndex((m) => m === hitObj);
        selectedStationIndex = idx;
        if (onSelectStation) onSelectStation(idx);
        return;
      }
      const hits = raycaster.intersectObject(satPoints, false);
      if (hits.length > 0 && hits[0].index !== undefined) {
        selectedIndex = hits[0].index;
        if (onSelect) onSelect(selectedIndex);
        updateTrack();
      } else {
        selectedIndex = null;
        if (onSelect) onSelect(null);
        selectedStationIndex = null;
        if (onSelectStation) onSelectStation(null);
        updateTrack();
      }
    }
    renderer.domElement.addEventListener('pointerdown', handlePointer);

    // Simulation time helpers
    const startReal = Date.now();
    const startSim = startTime.getTime();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fmtLine = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const fmt = (d: Date) => {
      const utc = fmtLine(d);
      const jstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000);
      const jst = fmtLine(jstDate);
      return `${utc} UTC\n${jst} JST`;
    };

    // Precompute observer coordinates in radians
    const observerGds = groundStations.map((gs) => ({
      longitude: satellite.degreesToRadians(gs.longitudeDeg),
      latitude: satellite.degreesToRadians(gs.latitudeDeg),
      height: gs.heightKm,
    }));
    const minElevationRads = groundStations.map((gs) =>
      THREE.MathUtils.degToRad(gs.minElevationDeg),
    );

    // Main animation loop ----------------------------------------------------
    // Advances simulation time based on `speedRef` and updates all
    // scene objects accordingly before rendering.
    function animate() {
      requestAnimationFrame(animate);
      const nowReal = Date.now();
      const simDeltaMs = (nowReal - startReal) * speedRef.current;
      const simDate = new Date(startSim + simDeltaMs);
      currentSimDate = simDate;

      // Rotate Earth using sidereal time
      const rotAngle = satellite.gstime(simDate)
      earthMesh.rotation.y = rotAngle;
      graticule.rotation.y = rotAngle;

      // Position the sun and a small marker
      const { x: sx, y: sy, z: sz } = sunVectorECI(simDate);
      sunlight.position.set(sx * 10, sz * 10, -sy * 10);
      sunDot.position.set(sx, sz, -sy);

      const gmst = rotAngle;
      const gsEcis = observerGds.map((gd) => {
        const ecf = satellite.geodeticToEcf(gd);
        return satellite.ecfToEci(ecf, gmst);
      });
      // Update ground station positions
      stationMeshes.forEach((m, idx) => {
        const p = gsEcis[idx];
        m.position.set(p.x / EARTH_RADIUS_KM, p.z / EARTH_RADIUS_KM, -p.y / EARTH_RADIUS_KM);
      });

      if (stationInfoRef && stationInfoRef.current && selectedStationIndex !== null) {
        const m = stationMeshes[selectedStationIndex];
        const v = m.position.clone().project(camera);
        const x = ((v.x + 1) / 2) * renderer.domElement.clientWidth;
        const y = ((-v.y + 1) / 2) * renderer.domElement.clientHeight;
        stationInfoRef.current.style.left = `${x}px`;
        stationInfoRef.current.style.top = `${y}px`;
      }

      for (let i = 0; i < satRecs.length; i++) {
        const rec = satRecs[i];
        const pv = satellite.propagate(rec, simDate);
        if (pv?.position) {
          const { x, y, z } = pv.position;
          satPosAttr.setXYZ(i, x / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, -y / EARTH_RADIUS_KM);
          const mag = Math.sqrt(x * x + y * y + z * z);
          groundPosAttr.setXYZ(i, x / mag, z / mag, -y / mag);

          const satEcf = satellite.eciToEcf(pv.position, gmst);
          let anyVisible = false;
          groundStations.forEach((_, gi) => {
            const look = satellite.ecfToLookAngles(observerGds[gi], satEcf);
            const visible = look.elevation > minElevationRads[gi];
            if (visible) {
              anyVisible = true;
              const p1 = new THREE.Vector3(
                gsEcis[gi].x / EARTH_RADIUS_KM,
                gsEcis[gi].z / EARTH_RADIUS_KM,
                -gsEcis[gi].y / EARTH_RADIUS_KM,
              );
              const p2 = new THREE.Vector3(
                x / EARTH_RADIUS_KM,
                z / EARTH_RADIUS_KM,
                -y / EARTH_RADIUS_KM,
              );
              linkGeometries[gi][i].setFromPoints([p1, p2]);
              linkLines[gi][i].visible = true;
            } else {
              linkLines[gi][i].visible = false;
            }
          });
          const c = new THREE.Color(anyVisible ? 0x00ff00 : 0xff0000);
          satColorAttr.setXYZ(i, c.r, c.g, c.b);
        }
      }

      satPosAttr.needsUpdate = true;
      satColorAttr.needsUpdate = true;
      groundPosAttr.needsUpdate = true;


      // Display current simulation time
      if (timeRef.current) timeRef.current.textContent = fmt(simDate);

      controls.update();
      renderer.render(scene, camera);
    }

    // Kick off the animation loop
    animate();

    // Keep renderer size in sync with the window
    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointer);
      if (orbitLine) {
        orbitLine.geometry.dispose();
      }
      renderer.dispose();
      satGeometry.dispose();
      groundGeometry.dispose();
      if (mountNode.contains(renderer.domElement)) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, [
    mountRef,
    timeRef,
    speedRef,
    startTime,
    satellites,
    groundStations,
    satRadius,
    onSelect,
    onSelectStation,
    stationInfoRef,
  ]);
}
