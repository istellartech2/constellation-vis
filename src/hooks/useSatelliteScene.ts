import { useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as satellite from "satellite.js";
import { SATELLITES, toSatrec } from "../satellites";
import { sunVectorECI, createGraticule } from "../utils/sceneHelpers";

const EARTH_RADIUS_KM = 6371;
const SIDEREAL_DAY_SEC = 86164;

interface Params {
  mountRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<HTMLDivElement | null>;
  speedRef: React.MutableRefObject<number>;
}

export function useSatelliteScene({ mountRef, timeRef, speedRef }: Params) {
  useEffect(() => {
    if (!mountRef.current) return;
    const mountNode = mountRef.current;

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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xffffff, 1.5);
    scene.add(sunlight);

    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    const texture = new THREE.TextureLoader().load("/assets/earth_daymap.jpg");
    const earthMaterial = new THREE.MeshPhongMaterial({ map: texture, shininess: 1 });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earthMesh);

    const graticule = createGraticule(20);
    scene.add(graticule);

    const satGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const satMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const groundGeo = new THREE.SphereGeometry(0.005, 8, 8);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xa9a9a9 });

    const satRecs = SATELLITES.map((spec) => toSatrec(spec));
    const satMeshes = satRecs.map(() => new THREE.Mesh(satGeo, satMat));
    const groundMeshes = satRecs.map(() => new THREE.Mesh(groundGeo, groundMat));
    satMeshes.forEach((m) => scene.add(m));
    groundMeshes.forEach((m) => scene.add(m));

    const startReal = Date.now();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日${pad(d.getHours())}時${pad(d.getMinutes())}分`;

    function animate() {
      requestAnimationFrame(animate);
      const nowReal = Date.now();
      const simDeltaMs = (nowReal - startReal) * speedRef.current;
      const simDate = new Date(startReal + simDeltaMs);

      const rotAngle = ((2 * Math.PI) / SIDEREAL_DAY_SEC) * (simDeltaMs / 1000);
      earthMesh.rotation.y = rotAngle;
      graticule.rotation.y = rotAngle;

      const sun = sunVectorECI(simDate);
      sunlight.position.set(sun.x * 10, sun.z * 10, -sun.y * 10);

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
        }
      });

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
      if (mountNode.contains(renderer.domElement)) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, [mountRef, timeRef, speedRef]);
}
