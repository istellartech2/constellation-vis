/**
 * three.js side of library models: parse the glTF, list its nodes, and wrap
 * the scene into a body-frame template (same contract as the built-ins in
 * ../trajectory/models.ts). Used by both the import preview and the
 * renderer's model cache, so the preview is exactly what 近接 draws.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TrajectoryModelTemplate } from "../trajectory/models";
import { bodyBoxSize, longestSide, metresPerModelUnit, modelToBodyMatrix, type Vec3 } from "./orientation";
import type { LibraryModelSettings, ModelNodeRef } from "./types";

/** Name of solar-wing pivot nodes (same as SOLAR_WING_NODE_NAME in ../trajectory/models). */
export const LIBRARY_SOLAR_WING_NODE_NAME = "solar-wing";

export async function parseModelScene(data: ArrayBuffer): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  return gltf.scene;
}

/** Bounding-box size of a scene in its own (model) units. */
export function measureScene(scene: THREE.Object3D): Vec3 {
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  return [size.x, size.y, size.z].map((v) => (Number.isFinite(v) ? v : 0)) as Vec3;
}

export interface ModelNodeInfo extends ModelNodeRef {
  depth: number;
  /** Number of meshes in the subtree. */
  meshes: number;
}

/** Depth-first node list of a glTF scene (excluding the root), for the 太陽電池パドル picker. */
export function listModelNodes(scene: THREE.Object3D): ModelNodeInfo[] {
  const out: ModelNodeInfo[] = [];
  const walk = (node: THREE.Object3D, path: number[]) => {
    node.children.forEach((child, i) => {
      const p = [...path, i];
      let meshes = 0;
      child.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes += 1;
      });
      out.push({ path: p, name: child.name, depth: p.length - 1, meshes });
      walk(child, p);
    });
  };
  walk(scene, []);
  return out;
}

export function findNodeByPath(scene: THREE.Object3D, path: readonly number[]): THREE.Object3D | null {
  let node: THREE.Object3D | undefined = scene;
  for (const i of path) {
    node = node?.children[i];
    if (!node) return null;
  }
  return node === scene ? null : node;
}

const isPrefix = (a: readonly number[], b: readonly number[]) => a.length < b.length && a.every((v, i) => b[i] === v);

/**
 * Wrap `scene` (consumed: re-parented, wings re-attached; pass a clone to
 * keep the original) into a body-frame template:
 * p_body = s · R · p_model + t, with R from the orientation, s from the
 * scale, and t putting the origin at the bbox centre or at the base (min
 * along body X, lateral centre). Selected solar-wing nodes are moved under
 * body-aligned pivot groups named {@link LIBRARY_SOLAR_WING_NODE_NAME} on
 * their own bbox centre line, so setSolarArrayDrive turns them about body +Y.
 */
export function buildLibraryTemplate(
  scene: THREE.Object3D,
  settings: Pick<LibraryModelSettings, "orientation" | "scale" | "origin" | "solarWings">,
  model: string,
): TrajectoryModelTemplate {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
  const size: Vec3 = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const s = metresPerModelUnit(settings.scale, longestSide(size));
  const m = modelToBodyMatrix(settings.orientation);
  // Matrix4 columns = images of the model axes (the transpose's rows).
  const rotation = new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], 0,
    m[1][0], m[1][1], m[1][2], 0,
    m[2][0], m[2][1], m[2][2], 0,
    0, 0, 0, 1,
  );
  const inner = new THREE.Group();
  inner.quaternion.setFromRotationMatrix(rotation);
  inner.scale.setScalar(s);
  inner.add(scene);
  // Body-frame box of the scaled, rotated model (rotation is an axis permutation).
  const center = box.getCenter(new THREE.Vector3()).applyQuaternion(inner.quaternion).multiplyScalar(s);
  const bodySize = bodyBoxSize(settings.orientation, size).map((v) => v * s) as Vec3;
  const base = settings.origin === "base";
  const offset = base
    ? new THREE.Vector3(center.x - bodySize[0] / 2, center.y, center.z)
    : center.clone();
  inner.position.copy(offset).negate();
  const root = new THREE.Group();
  root.name = `TrajectoryModel:${model}`;
  root.add(inner);
  root.updateMatrixWorld(true);

  // Solar wings: skip nodes inside another selected node (they turn with it).
  const paths = settings.solarWings.map((w) => w.path);
  const wings = paths
    .filter((p) => !paths.some((q) => isPrefix(q, p)))
    .map((p) => findNodeByPath(scene, p))
    .filter((n): n is THREE.Object3D => n !== null);
  for (const node of wings) {
    const wingBox = new THREE.Box3().setFromObject(node);
    const c = wingBox.isEmpty() ? new THREE.Vector3() : wingBox.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = LIBRARY_SOLAR_WING_NODE_NAME;
    pivot.position.set(c.x, 0, c.z);
    root.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(node);
  }

  const lengthM = (base ? bodySize[0] : Math.max(...bodySize)) || 1;
  return {
    model,
    root,
    lengthM,
    pivotBody: base ? new THREE.Vector3(lengthM / 2, 0, 0) : new THREE.Vector3(),
    anchor: base ? "base" : "center",
  };
}

/** Dispose every geometry, material and texture under `root`. */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
