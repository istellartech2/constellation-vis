import { useRef, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";

const EARTH_RADIUS_KM = 6371; // physical radius
const SIM_SPEED = 50; // 10× real time
const SIDEREAL_DAY_SEC = 86164; // Earth's rotation period

// ISS TLE (20 May 2025)
const ISS_TLE = [
  "1 25544U 98067A   25140.43166667  .00016717  00000+0  10270-3 0  9997",
  "2 25544  51.6444  22.7332 0003643  46.9050   7.5185 15.49594111445576",
];

function App() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 3); // ~3 Earth radii away

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // Controls (rotate Earth by rotating camera around it)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.4); // 全体を明るく
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4); // 太陽光イメージ
    dirLight.position.set(5, 3, 5);
    dirLight.castShadow = false;
    scene.add(dirLight);


    // Earth
    const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
    const texture = new THREE.TextureLoader().load("/assets/earth_daymap.jpg");
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earthMesh);

    // Satellite (red dot)
    const satGeometry = new THREE.SphereGeometry(0.02, 16, 16);
    const satMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const satMesh = new THREE.Mesh(satGeometry, satMaterial);
    scene.add(satMesh);

    // Satellite record
    const satrec = satellite.twoline2satrec(ISS_TLE[0], ISS_TLE[1]);

    // Timing
    const startReal = Date.now();

    function animate() {
      requestAnimationFrame(animate);

      const nowReal = Date.now();
      const simDeltaMs = (nowReal - startReal) * SIM_SPEED;
      const simDate = new Date(startReal + simDeltaMs);

      // Earth rotation (sidereal)
      const rotAngle =
        ((2 * Math.PI) / SIDEREAL_DAY_SEC) * (simDeltaMs / 1000); // rad since start
      earthMesh.rotation.y = rotAngle;

      // Satellite position (ECI → Three.js)
      const pv = satellite.propagate(satrec, simDate);
      if (pv.position) {
        // ECI axes: X(vernal equinox), Y(90° east), Z(north)
        // Map to Three: Y ↔ Z to make Y=north (up)
        const posEci = pv.position; // km
        satMesh.position.set(
          posEci.x / EARTH_RADIUS_KM,
          posEci.z / EARTH_RADIUS_KM, // north → y
          -posEci.y / EARTH_RADIUS_KM // west → +z
        );
      }

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
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} />;
}

export default App;