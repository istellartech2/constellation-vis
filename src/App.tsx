import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { SATELLITES, toSatrec } from "./satellites";

const EARTH_RADIUS_KM = 6371; // physical radius
const INITIAL_SPEED = 60; // initial 60× real time
const SIDEREAL_DAY_SEC = 86164; // Earth's rotation period
const DEG2RAD = Math.PI / 180;

// Utility – solar position in ECI (approximate, <0.01 rad)
function sunVectorECI(date: Date): { x: number; y: number; z: number } {
  const jd = satellite.jday(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds() + date.getUTCMilliseconds() / 1000
  );

  const T = (jd - 2451545.0) / 36525.0;
  const L = ((280.460 + 36000.770 * T) % 360) * DEG2RAD; // mean longitude
  const g = ((357.528 + 35999.050 * T) % 360) * DEG2RAD; // mean anomaly
  const lambda = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG2RAD;
  const epsilon = (23.4393 - 0.0130 * T) * DEG2RAD; // obliquity

  // Ecliptic to equatorial
  const xs = Math.cos(lambda);
  const ys = Math.cos(epsilon) * Math.sin(lambda);
  const zs = Math.sin(epsilon) * Math.sin(lambda);
  return { x: xs, y: ys, z: zs };
}

// Create graticule lines every 20°
function createGraticule(stepDeg = 20): THREE.LineSegments {
  const vertices: number[] = [];
  const material = new THREE.LineBasicMaterial({ color: 0xdcdcdc, linewidth: 0.1 });

  // Meridians
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    for (let lat = -90; lat < 90; lat += 2) {
      const lat1 = lat * DEG2RAD;
      const lat2 = (lat + 2) * DEG2RAD;
      const lonRad = lon * DEG2RAD;
      vertices.push(
        Math.cos(lat1) * Math.cos(lonRad),
        Math.sin(lat1),
        -Math.cos(lat1) * Math.sin(lonRad),
        Math.cos(lat2) * Math.cos(lonRad),
        Math.sin(lat2),
        -Math.cos(lat2) * Math.sin(lonRad)
      );
    }
  }
  // Parallels
  for (let lat = -80; lat <= 80; lat += stepDeg) {
    const latRad = lat * DEG2RAD;
    for (let lon = -180; lon < 180; lon += 2) {
      const lon1 = lon * DEG2RAD;
      const lon2 = (lon + 2) * DEG2RAD;
      vertices.push(
        Math.cos(latRad) * Math.cos(lon1),
        Math.sin(latRad),
        -Math.cos(latRad) * Math.sin(lon1),
        Math.cos(latRad) * Math.cos(lon2),
        Math.sin(latRad),
        -Math.cos(latRad) * Math.sin(lon2)
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, material);
}

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  // speed exponent slider (0–2 → 1×–100×)
  const [speedExp, setSpeedExp] = useState(Math.log10(INITIAL_SPEED));
  const speedRef = useRef(INITIAL_SPEED);
  useEffect(() => {
    speedRef.current = Math.pow(10, speedExp);
  }, [speedExp]);

  useEffect(() => {
    if (!mountRef.current) return;

    // Capture mountRef.current at the time this effect runs
    const mountNode = mountRef.current;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 3); // ~3 Earth radii away

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.2); // 全体を明るく
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xffffff, 1.5); // 太陽光イメージ
    scene.add(sunlight);

    // Earth
    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    const texture = new THREE.TextureLoader().load("/assets/earth_daymap.jpg");
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earthMesh);

    // Graticule
    const graticule = createGraticule(20);
    scene.add(graticule);

    // satellites
    const satGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const satMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const groundGeo = new THREE.SphereGeometry(0.005, 8, 8);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xa9a9a9 });

    const satRecs = SATELLITES.map((spec) => toSatrec(spec));
    const satMeshes = satRecs.map(() => new THREE.Mesh(satGeo, satMat));
    const groundMeshes = satRecs.map(() => new THREE.Mesh(groundGeo, groundMat));
    satMeshes.forEach((m) => scene.add(m));
    groundMeshes.forEach((m) => scene.add(m));

    // timing
    const startReal = Date.now();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日${pad(d.getHours())}時${pad(d.getMinutes())}分`;

    function animate() {
      requestAnimationFrame(animate);
      const nowReal = Date.now();
      const simDeltaMs = (nowReal - startReal) * speedRef.current;
      const simDate = new Date(startReal + simDeltaMs);

      // Earth rotation (sidereal)
      const rotAngle = ((2 * Math.PI) / SIDEREAL_DAY_SEC) * (simDeltaMs / 1000);
      earthMesh.rotation.y = rotAngle;
      graticule.rotation.y = rotAngle; // keep grid locked to surface      

      // sunlight
      const sun = sunVectorECI(simDate);
      sunlight.position.set(sun.x * 10, sun.z * 10, -sun.y * 10);

      // satellites & ground points
      satRecs.forEach((rec, i) => {
        const pv = satellite.propagate(rec, simDate);
        if (pv?.position) {
          const { x, y, z } = pv.position; // km ECI
          satMeshes[i].position.set(x / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, -y / EARTH_RADIUS_KM);
          const mag = Math.sqrt(x * x + y * y + z * z);
          groundMeshes[i].position.set(x / mag, z / mag, -y / mag); // unit sphere
        }
      });

      // update HUD time
      if (timeRef.current) timeRef.current.textContent = fmt(simDate);
      
      controls.update();
      renderer.render(scene, camera);
    }

    animate();

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      // Use the captured mountNode instead of mountRef.current
      if (mountNode.contains(renderer.domElement)) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <div ref={timeRef} style={{ position: "absolute", right: 8, bottom: 6, color: "#fff", fontFamily: "'Noto Sans Mono', monospace", fontVariantNumeric: "tabular-nums", fontSize: "0.9rem", pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 8, top: 8, color: "#fff", fontFamily: "sans-serif", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <input type="range" min={1} max={2.5} step={0.01} value={speedExp} onChange={(e) => setSpeedExp(parseFloat(e.target.value))} style={{ width: 150 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.pow(10, speedExp).toFixed(1)}×</span>
      </div>
    </div>
  );
}

export default App;