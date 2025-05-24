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

const EARTH_RADIUS_KM = 6371;
// const SIDEREAL_DAY_SEC = 86164;

interface Params {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
  startTime: Date;
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
  onSelect?: (idx: number | null) => void;
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
  onSelect,
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
    const texture = new THREE.TextureLoader().load("/assets/8081_earthmap4k.jpg");
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
    const satGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const baseSatMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const groundGeo = new THREE.SphereGeometry(0.005, 8, 8);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xa9a9a9 });

    const stationGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const satRecs = satellites.map((spec) => toSatrec(spec));
    const satMeshes: THREE.Mesh<
      THREE.SphereGeometry,
      THREE.MeshBasicMaterial
    >[] = satRecs.map(() => new THREE.Mesh(satGeo, baseSatMat.clone()));
    const groundMeshes = satRecs.map(() => new THREE.Mesh(groundGeo, groundMat));
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
    satMeshes.forEach((m) => scene.add(m));
    groundMeshes.forEach((m) => scene.add(m));
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
    let orbitLine: THREE.Line | null = null;
    let currentSimDate = startTime;

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

    function handlePointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(satMeshes, false);
      if (hits.length > 0) {
        selectedIndex = satMeshes.indexOf(
          hits[0].object as THREE.Mesh<
            THREE.SphereGeometry,
            THREE.MeshBasicMaterial
          >,
        );
        if (onSelect) onSelect(selectedIndex);
        updateTrack();
      } else {
        selectedIndex = null;
        if (onSelect) onSelect(null);
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

      satRecs.forEach((rec, i) => {
        const pv = satellite.propagate(rec, simDate);
        if (pv?.position) {
          const { x, y, z } = pv.position;
          satMeshes[i].position.set(
            x / EARTH_RADIUS_KM,
            z / EARTH_RADIUS_KM,
            -y / EARTH_RADIUS_KM,
          );
          const mag = Math.sqrt(x * x + y * y + z * z);
          groundMeshes[i].position.set(x / mag, z / mag, -y / mag);

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
          (satMeshes[i].material as THREE.MeshBasicMaterial).color.setHex(
            anyVisible ? 0x00ff00 : 0xff0000,
          );
        }
      });


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
      if (mountNode.contains(renderer.domElement)) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, [mountRef, timeRef, speedRef, startTime, satellites, groundStations, onSelect]);
}
