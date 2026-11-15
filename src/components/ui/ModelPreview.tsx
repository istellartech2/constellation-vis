import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildLibraryTemplate, LIBRARY_SOLAR_WING_NODE_NAME } from "../../lib/modelLibrary/template";
import type { LibraryModelSettings } from "../../lib/modelLibrary/types";
import { setSolarArrayDrive } from "../../lib/trajectory/models";

interface Props {
  /** Parsed glTF scene (not modified: each rebuild uses a clone). */
  scene: THREE.Object3D | null;
  settings: Pick<LibraryModelSettings, "orientation" | "scale" | "origin" | "solarWings">;
  /** Whether the settings are valid (perpendicular axes); invalid → keep the last good preview. */
  valid: boolean;
  /** 「回転を確認」: solar-wing drive angle shown in the preview (degrees about body +Y). */
  wingAngleDeg: number;
  /** Legend text of the body axes (wording differs for rockets). */
  legend: { x: string; z: string };
}

const BODY_AXES = [
  { dir: new THREE.Vector3(1, 0, 0), color: 0xe5484d },
  { dir: new THREE.Vector3(0, 1, 0), color: 0x46a758 },
  { dir: new THREE.Vector3(0, 0, 1), color: 0x3e7bfa },
] as const;

/** Model-axis gizmo colours (lighter than the body triad, thin lines). */
const MODEL_AXIS_COLORS = [0xff9a9e, 0x9be29f, 0x9fbcff] as const;
const GIZMO_PX = 92;
const WING_HIGHLIGHT = 0xffc83d;

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontPx = 34;
  const font = `600 ${fontPx}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;
  let width = 160;
  if (ctx) {
    ctx.font = font;
    width = Math.ceil(ctx.measureText(text).width) + 12;
  }
  canvas.width = width;
  canvas.height = fontPx + 12;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 6, canvas.height / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

/** Dispose geometries, materials and sprite textures owned by helper objects (not the model). */
function disposeHelpers(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !(o as THREE.Sprite).isSprite) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
  });
}

/**
 * Small live 3D preview of a library model in the BODY frame. Body −Z
 * (zenith) is screen-up, so the Earth side is down, as in 近接.
 * - thin semi-transparent body triad (legend in HTML, so nothing is clipped);
 * - bottom-left gizmo: the model's own axes (「モデル X/Y/Z」) as they end up;
 * - selected solar wings outlined, turned by `wingAngleDeg`.
 */
export default function ModelPreview({ scene, settings, valid, wingAngleDeg, legend }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    triad: THREE.Group;
    gizmo: THREE.Group;
    wingBoxes: THREE.BoxHelper[];
  } | null>(null);
  const lastFitRef = useRef<number>(0);
  const angleRef = useRef(wingAngleDeg);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      mount.textContent = "プレビューを表示できません（WebGL が使えません）";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    // Sized by the container (CSS), so the canvas never forces the dialog wider.
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    disposeHelpers(room);
    pmrem.dispose();
    world.environment = env;
    world.environmentIntensity = 0.5;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 0.6, -1.5);
    world.add(sun, new THREE.HemisphereLight(0xc4d6ff, 0x3a332c, 0.8));
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1e6);
    // Body −Z (away from the Earth) is screen-up.
    camera.up.set(0, 0, -1);
    // OrbitControls: drag to rotate, wheel / pinch to zoom (touch is built in).
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    const content = new THREE.Group();
    const triad = new THREE.Group();
    world.add(content, triad);
    const gizmoScene = new THREE.Scene();
    const gizmo = new THREE.Group();
    gizmoScene.add(gizmo);
    const gizmoCamera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10);
    stateRef.current = { renderer, camera, controls, content, triad, gizmo, wingBoxes: [] };
    // A fresh camera must be framed again (StrictMode mounts twice).
    lastFitRef.current = 0;

    const resize = () => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    let frame = 0;
    const offset = new THREE.Vector3();
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      renderer.setViewport(0, 0, w, h);
      renderer.clear();
      renderer.render(world, camera);
      // Model-axis gizmo, bottom-left, seen from the same direction.
      offset.subVectors(camera.position, controls.target).normalize().multiplyScalar(5);
      gizmoCamera.position.copy(offset);
      gizmoCamera.up.copy(camera.up);
      gizmoCamera.lookAt(0, 0, 0);
      renderer.clearDepth();
      renderer.setViewport(4, 4, GIZMO_PX, GIZMO_PX);
      renderer.render(gizmoScene, gizmoCamera);
      renderer.setViewport(0, 0, w, h);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeHelpers(triad);
      disposeHelpers(gizmo);
      stateRef.current?.wingBoxes.forEach((b) => disposeHelpers(b));
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  // Rebuild the body-frame model, triad, gizmo and wing outlines when the scene or settings change.
  const { orientation, scale, origin, solarWings } = settings;
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !scene || !valid) return;
    const { content, triad, gizmo, camera, controls } = state;
    content.clear();
    state.wingBoxes.forEach((b) => disposeHelpers(b));
    state.wingBoxes = [];
    const template = buildLibraryTemplate(scene.clone(true), { orientation, scale, origin, solarWings }, "preview");
    content.add(template.root);
    template.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template.root);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1e-6);

    // Thin, semi-transparent body triad at the body origin (the model's reference point).
    disposeHelpers(triad);
    triad.clear();
    const axisLength = span * 0.45;
    for (const axis of BODY_AXES) {
      const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(), axisLength, axis.color, axisLength * 0.1, axisLength * 0.04);
      arrow.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (material) {
          material.depthTest = false;
          material.transparent = true;
          material.opacity = 0.6;
        }
        o.renderOrder = 5;
      });
      triad.add(arrow);
    }

    // Model axes as they end up in the body frame (the template's inner rotation).
    disposeHelpers(gizmo);
    gizmo.clear();
    const inner = template.root.children[0];
    for (let i = 0; i < 3; i++) {
      const dir = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(inner.quaternion);
      const color = MODEL_AXIS_COLORS[i];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-0.6), dir]),
        new THREE.LineBasicMaterial({ color }),
      );
      const label = makeLabel(`モデル ${"XYZ"[i]}`, color);
      label.scale.set(0.42 * label.userData.aspect, 0.42, 1);
      label.position.copy(dir).multiplyScalar(1.22);
      gizmo.add(line, label);
    }

    // Outline the selected solar wings.
    template.root.traverse((o) => {
      if (o.name !== LIBRARY_SOLAR_WING_NODE_NAME) return;
      const helper = new THREE.BoxHelper(o, WING_HIGHLIGHT);
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 6;
      state.wingBoxes.push(helper);
      content.add(helper);
    });
    setSolarArrayDrive(template.root, THREE.MathUtils.degToRad(angleRef.current));
    state.wingBoxes.forEach((b) => b.update());

    // Fit the model's bounding sphere to the narrower field of view (the
    // model fills the frame) when the size changes noticeably (not on every axis tweak).
    if (Math.abs(span - lastFitRef.current) > lastFitRef.current * 0.05) {
      lastFitRef.current = span;
      const centre = box.getCenter(new THREE.Vector3());
      const radius = size.length() / 2;
      const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
      const halfMin = Math.min(halfV, Math.atan(Math.tan(halfV) * camera.aspect));
      const distance = (radius / Math.sin(halfMin)) * 1.02;
      controls.target.copy(centre);
      camera.position.copy(centre).add(new THREE.Vector3(1.1, 1.5, -0.8).normalize().multiplyScalar(distance));
      camera.near = span / 1000;
      camera.far = span * 100;
      camera.updateProjectionMatrix();
      controls.update();
    }
  }, [scene, valid, orientation, scale, origin, solarWings]);

  // 「回転を確認」: turn the wings without rebuilding.
  useEffect(() => {
    angleRef.current = wingAngleDeg;
    const state = stateRef.current;
    if (!state) return;
    setSolarArrayDrive(state.content, THREE.MathUtils.degToRad(wingAngleDeg));
    state.content.updateMatrixWorld(true);
    state.wingBoxes.forEach((b) => b.update());
  }, [wingAngleDeg]);

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-lg border border-line bg-sunken md:h-80">
      <div ref={mountRef} className="absolute inset-0 text-xs text-fg-muted" aria-label="3Dモデルのプレビュー（ドラッグで回転）" role="img" />
      <div className="pointer-events-none absolute left-2 top-1.5 space-y-0.5 text-[10px] leading-tight">
        <div><span className="text-[#e5484d]">━ +X {legend.x}</span></div>
        <div><span className="text-[#46a758]">━ +Y</span></div>
        <div><span className="text-[#3e7bfa]">━ +Z {legend.z}</span></div>
      </div>
      <div className="pointer-events-none absolute bottom-1.5 right-2 text-right text-[10px] leading-tight text-fg-subtle">
        左下: モデル自身の軸
        {solarWings.length > 0 && (
          <>
            <br />
            <span className="text-[#ffc83d]">□ 太陽電池パドル</span>
          </>
        )}
      </div>
    </div>
  );
}
