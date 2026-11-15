/**
 * 3D vehicle models for trajectory tracks.
 *
 * Every model is normalised into a template whose local axes are the BODY
 * frame of ./types.ts (+X nose, +Z belly, +Y = Z × X) and whose units are
 * metres:
 *  - rockets ("base" anchor): origin at the base (engine end) on the axis;
 *    the geometric pivot is `pivotBody` = (L/2, 0, 0);
 *  - satellite-bus ("center" anchor): origin = pivot = geometric centre.
 *
 * Built-in GLBs (uchusen-rockets, MIT; see public/models/) are glTF +Y nose
 * with the origin at the base. The ship's heat-shield tiles sit on glTF +Z
 * (material "tile", centroid z > 0; the bare steel is on −Z), so glTF +Z is
 * the belly: body (X, Y, Z) = glTF (+Y, −X, +Z), a proper rotation (−90°
 * about Z).
 *
 * Unknown GLBs (user files / URLs) are normalised by bounding box: the
 * longest axis becomes body X with the nose toward + of that axis (glTF +Y
 * when Y is longest, the common "up" for rocket models), the base is the
 * minimum along that axis at the lateral bbox centre, and the remaining axes
 * keep a right-handed order. Their roll is therefore arbitrary.
 *
 * Library models (`library:<id>`, see ../modelLibrary) are loaded from the
 * browser's model library and normalised by their stored metadata
 * (orientation, scale, origin, solar wings) — see buildLibraryTemplate.
 *
 * Templates are cached at module level keyed by model string, so scene
 * rebuilds never refetch. Instances are `clone(true)` and SHARE geometry and
 * materials with the template: renderers must never dispose them; they call
 * `releaseTrajectoryModel` instead. Built-ins stay cached for the app's
 * lifetime; user GLBs are disposed 10 s after their last user releases them
 * (so a scene rebuild, which disposes the old renderer first, reuses them).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { modelLibrary } from "../modelLibrary/store";
import { buildLibraryTemplate, parseModelScene } from "../modelLibrary/template";
import { bodyBoxSize, longestSide, metresPerModelUnit } from "../modelLibrary/orientation";
import { LIBRARY_MODEL_PREFIX, libraryModelId, libraryModelKey } from "../modelLibrary/types";

export interface TrajectoryModelInfo {
  key: string;
  label: string;
  /** Overall length (rockets) or largest span (satellite), metres. */
  lengthM: number;
}

export const TRAJECTORY_MODELS: readonly TrajectoryModelInfo[] = [
  { key: "starship-v3-booster", label: "Starship V3 ブースター", lengthM: 72.3 },
  { key: "starship-v3-ship", label: "Starship V3 シップ", lengthM: 52.1 },
  { key: "generic-rocket", label: "汎用ロケット", lengthM: 40 },
  { key: "satellite-bus", label: "標準バス", lengthM: 10.4 },
];

/**
 * Static landmark models (not offered for tracks in the 軌跡 panel): drawn
 * upright at a fixed point by the same metre-scale pass as the vehicles.
 */
export const LANDMARK_MODELS: readonly TrajectoryModelInfo[] = [
  { key: "launch-tower", label: "発射塔", lengthM: 145 },
];

const PROCEDURAL_KEYS = new Set(["generic-rocket", "satellite-bus", "launch-tower"]);

const GLB_KEYS = new Set(["starship-v3-booster", "starship-v3-ship"]);

export interface TrajectoryModelTemplate {
  /** Model string this template was loaded for. */
  model: string;
  /** Body-frame root (metres). Clone it; never dispose its geometry/materials directly. */
  root: THREE.Object3D;
  lengthM: number;
  /** Rotation pivot in body coordinates (geometric centre). */
  pivotBody: THREE.Vector3;
  /** What the track position refers to: the base (engine end) or the centre. */
  anchor: "base" | "center";
}

/**
 * Length known before loading: the registry length of a built-in key, or a
 * library model's length from its metadata (body-X extent for a base
 * origin, else the longest side — the template's lengthM); else undefined.
 */
export function trajectoryModelLengthM(model: string | undefined): number | undefined {
  const builtIn = (TRAJECTORY_MODELS.find((m) => m.key === model) ?? LANDMARK_MODELS.find((m) => m.key === model))?.lengthM;
  if (builtIn !== undefined) return builtIn;
  const id = libraryModelId(model);
  const meta = id ? modelLibrary.get(id) : undefined;
  if (!meta) return undefined;
  const s = metresPerModelUnit(meta.scale, longestSide(meta.bboxSize));
  const body = bodyBoxSize(meta.orientation, meta.bboxSize);
  return (meta.origin === "base" ? body[0] : Math.max(...body)) * s || undefined;
}

/**
 * URL of a model: built-in GLBs resolve relative to the document, like
 * `EARTH_ASSETS` in ../earthTextures.ts (`./models/<key>.glb`); procedural
 * keys have no URL; anything else is taken as a URL / object URL.
 */
export function trajectoryModelUrl(model: string): string | null {
  if (GLB_KEYS.has(model)) return `./models/${model}.glb`;
  if (PROCEDURAL_KEYS.has(model) || model.startsWith(LIBRARY_MODEL_PREFIX)) return null;
  return model;
}

/** glTF (+Y nose, +Z belly) → body (+X nose, +Z belly): −90° about Z. */
export const GLTF_TO_BODY = Object.freeze(
  new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
  ),
) as THREE.Quaternion;

/** Body frame → scene world: rotY(rotAngle) · rotX(−90°) · (body → ECEF). */
export function bodyToWorldQuaternion(
  bodyToEcef: { w: number; x: number; y: number; z: number },
  rotAngle: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  // ECEF → overlay-local (x, z, −y) is rotX(−90°); then the GMST group rotation.
  const h = rotAngle / 2;
  const s = Math.SQRT1_2;
  // qY(rot) · qX(−90°)
  const ay = Math.sin(h);
  const aw = Math.cos(h);
  // (aw, 0, ay, 0) · (s, −s, 0, 0)  [w, x, y, z]
  const w = aw * s;
  const x = -aw * s;
  const y = ay * s;
  const z = ay * s;
  out.set(x, y, z, w);
  return out.multiply(scratchQuat.set(bodyToEcef.x, bodyToEcef.y, bodyToEcef.z, bodyToEcef.w));
}
const scratchQuat = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Wrap a glTF scene into a body-frame template. `builtIn` GLBs keep their
 * own origin (base on the axis); others are normalised by bounding box.
 */
export function templateFromGltfScene(scene: THREE.Object3D, model: string, builtIn: boolean): TrajectoryModelTemplate {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(scene);
  const base = new THREE.Vector3();
  let lengthM: number;
  if (builtIn || (size.y >= size.x && size.y >= size.z)) {
    inner.quaternion.copy(GLTF_TO_BODY);
    lengthM = size.y;
    if (builtIn) base.set(0, box.min.y, 0);
    else base.set(center.x, box.min.y, center.z);
  } else if (size.x >= size.z) {
    // Nose +X: identity (body Y = glTF Y, body Z = glTF Z).
    lengthM = size.x;
    base.set(box.min.x, center.y, center.z);
  } else {
    // Nose +Z: body X = glTF Z, body Y = glTF X, body Z = glTF Y (cyclic, det +1).
    inner.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
    );
    lengthM = size.z;
    base.set(center.x, center.y, box.min.z);
  }
  // p_body = R (p_gltf − base)
  inner.position.copy(base).applyQuaternion(inner.quaternion).negate();
  const root = new THREE.Group();
  root.name = `TrajectoryModel:${model}`;
  root.add(inner);
  return {
    model,
    root,
    lengthM: lengthM > 0 ? lengthM : 1,
    pivotBody: new THREE.Vector3(lengthM / 2, 0, 0),
    anchor: "base",
  };
}

export async function parseGlbTemplate(data: ArrayBuffer, model: string): Promise<TrajectoryModelTemplate> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  return templateFromGltfScene(gltf.scene, model, GLB_KEYS.has(model));
}

// ---------------------------------------------------------------------------
// Procedural models
// ---------------------------------------------------------------------------

/** ~40 m two-colour rocket: cylinder + nose cone + four fins, built glTF-style then rotated to body. */
function buildGenericRocket(): TrajectoryModelTemplate {
  const radius = 1.85;
  const bodyLength = 32;
  const coneLength = 8;
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.25, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.4, roughness: 0.6 });
  const gltfLike = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bodyLength, 32), white);
  body.position.y = bodyLength / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, coneLength, 32), white);
  cone.position.y = bodyLength + coneLength / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, 1.2, 32), dark);
  band.position.y = bodyLength * 0.62;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.75, 1.6, 24, 1, true), dark);
  nozzle.position.y = -0.8;
  gltfLike.add(body, cone, band, nozzle);
  const finGeometry = new THREE.BoxGeometry(0.25, 5, 2.6);
  for (let i = 0; i < 4; i += 1) {
    const fin = new THREE.Mesh(finGeometry, dark);
    const a = (i * Math.PI) / 2;
    fin.position.set(Math.cos(a) * (radius + 1.2), 2.5, Math.sin(a) * (radius + 1.2));
    fin.rotation.y = -a;
    gltfLike.add(fin);
  }
  // Shift so the nozzle exit is the base (y = 0).
  gltfLike.position.y = 1.6;
  const lengthM = bodyLength + coneLength + 1.6;
  const inner = new THREE.Group();
  inner.quaternion.copy(GLTF_TO_BODY);
  inner.add(gltfLike);
  const root = new THREE.Group();
  root.name = "TrajectoryModel:generic-rocket";
  root.add(inner);
  return { model: "generic-rocket", root, lengthM, pivotBody: new THREE.Vector3(lengthM / 2, 0, 0), anchor: "base" };
}

/**
 * Launch tower with catch arms ("chopsticks"), ≈145 m: a 10 m square
 * lattice column (corner posts, girders and X bracing, merged into one
 * mesh), a carriage and two arms at ~100 m reaching across the vehicle axis.
 * The ORIGIN is the launch mount axis at ground level (where the vehicle
 * stands and is caught), not the column: the column stands 22 m toward body
 * +Y, and the arms straddle the axis ±6.5 m apart along body Z, so a 9 m
 * vehicle on the axis never intersects it. Body +X is up.
 */
function buildLaunchTower(): TrajectoryModelTemplate {
  const height = 145;
  const half = 5;
  const column = 22;
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
    g.translate(x, y, z);
    parts.push(g);
  };
  // glTF-like frame: +Y up, column centred at x = −column (→ body +Y after GLTF_TO_BODY).
  const cx = -column;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(1.2, height, 1.2, cx + sx * half, height / 2, sz * half);
  const level = 9;
  const diag = Math.atan2(level, 2 * half);
  const diagLength = Math.hypot(level, 2 * half);
  for (let y = 0; y + level <= height; y += level) {
    for (const s of [-1, 1]) {
      box(2 * half, 0.6, 0.6, cx, y + level, s * half);
      box(0.6, 0.6, 2 * half, cx + s * half, y + level, 0);
      // X bracing on the four faces (alternating direction per level).
      const flip = (y / level) % 2 === 0 ? 1 : -1;
      box(diagLength, 0.35, 0.35, cx, y + level / 2, s * half, 0, flip * diag);
      box(0.35, 0.35, diagLength, cx + s * half, y + level / 2, 0, flip * diag, 0);
    }
  }
  box(1, 14, 1, cx, height + 7, 0); // mast
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.55, roughness: 0.6 });
  const armSteel = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.5, roughness: 0.5 });
  const lattice = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const gltfLike = new THREE.Group();
  if (lattice) gltfLike.add(new THREE.Mesh(lattice, steel));
  const armY = 100;
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(2 * half + 3, 7, 2 * half + 3), armSteel);
  carriage.position.set(cx, armY, 0);
  gltfLike.add(carriage);
  const armLength = column + 10 - half;
  const armGeometry = new THREE.BoxGeometry(armLength, 3, 1.8);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeometry, armSteel);
    arm.position.set(cx + half + armLength / 2, armY, s * 6.5);
    gltfLike.add(arm);
  }
  const inner = new THREE.Group();
  inner.quaternion.copy(GLTF_TO_BODY);
  inner.add(gltfLike);
  const root = new THREE.Group();
  root.name = "TrajectoryModel:launch-tower";
  root.add(inner);
  return { model: "launch-tower", root, lengthM: height, pivotBody: new THREE.Vector3(height / 2, 0, 0), anchor: "base" };
}

/** Name of the solar-wing pivot nodes of the satellite bus (rotated about body Y by a 1-axis drive). */
export const SOLAR_WING_NODE_NAME = "solar-wing";

/**
 * Box bus with two solar wings along body ±Y (≈10.4 m span) and an antenna
 * dish on +Z (the sensor / nadir side). Origin = centre.
 *
 * Each wing (panel + arm) hangs under its own pivot group named
 * {@link SOLAR_WING_NODE_NAME}, sitting on the body Y axis, so a single-axis
 * drive is just `pivot.rotation.y = driveAngleRad` (see
 * {@link setSolarArrayDrive}). At drive angle 0 the cell face is the −Z side
 * (zenith under Earth pointing), matching the attitude body frame.
 */
function buildSatelliteBus(): TrajectoryModelTemplate {
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.35 });
  const cells = new THREE.MeshStandardMaterial({ color: 0x1f3a7a, metalness: 0.5, roughness: 0.35 });
  const backing = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.3, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 0.6, roughness: 0.4 });
  const root = new THREE.Group();
  root.name = "TrajectoryModel:satellite-bus";
  root.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 1.8), foil));
  // Box face order: +X, −X, +Y, −Y, +Z, −Z → cells on −Z, backing elsewhere.
  const wingMaterials = [backing, backing, backing, backing, backing, cells];
  const wingGeometry = new THREE.BoxGeometry(1.6, 4, 0.06);
  const armGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = SOLAR_WING_NODE_NAME;
    pivot.userData.side = side;
    const wing = new THREE.Mesh(wingGeometry, wingMaterials);
    wing.position.set(0, side * (0.9 + 0.3 + 2), 0);
    const arm = new THREE.Mesh(armGeometry, metal);
    arm.position.set(0, side * 1.05, 0);
    pivot.add(wing, arm);
    root.add(pivot);
  }
  // Antenna dish toward +Z (sensor side; nadir under Earth pointing).
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.35, 24, 1, true), metal);
  dish.rotation.x = Math.PI / 2;
  dish.position.z = 0.9 + 0.2;
  root.add(dish);
  return { model: "satellite-bus", root, lengthM: 10.4, pivotBody: new THREE.Vector3(), anchor: "center" };
}

/**
 * Turn every solar-wing pivot of a model instance (a clone of the satellite
 * bus) to `driveAngleRad` about body +Y (right-handed). No-op for models
 * without wings. Returns the number of wings turned.
 */
export function setSolarArrayDrive(object: THREE.Object3D, driveAngleRad: number): number {
  let n = 0;
  object.traverse((node) => {
    if (node.name !== SOLAR_WING_NODE_NAME) return;
    node.rotation.set(0, driveAngleRad, 0);
    n += 1;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  promise: Promise<TrajectoryModelTemplate>;
  template: TrajectoryModelTemplate | null;
  refs: number;
  builtIn: boolean;
  /** Edited / deleted library model: dispose as soon as the last user lets go. */
  invalidated: boolean;
}

const cache = new Map<string, CacheEntry>();

function isBuiltIn(model: string): boolean {
  return TRAJECTORY_MODELS.some((m) => m.key === model) || LANDMARK_MODELS.some((m) => m.key === model);
}

async function loadLibraryTemplate(model: string): Promise<TrajectoryModelTemplate> {
  const id = libraryModelId(model);
  const entry = id ? await modelLibrary.load(id) : null;
  if (!entry) throw new Error(`model ${model}: not in the model library`);
  return buildLibraryTemplate(await parseModelScene(entry.data), entry.meta, model);
}

async function loadTemplate(model: string): Promise<TrajectoryModelTemplate> {
  if (model.startsWith(LIBRARY_MODEL_PREFIX)) return loadLibraryTemplate(model);
  if (model === "generic-rocket") return buildGenericRocket();
  if (model === "satellite-bus") return buildSatelliteBus();
  if (model === "launch-tower") return buildLaunchTower();
  const url = trajectoryModelUrl(model)!;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`model ${url}: HTTP ${response.status}`);
  return parseGlbTemplate(await response.arrayBuffer(), model);
}

/**
 * Get (loading once) the template for `model` and take a reference. Pair
 * every call with {@link releaseTrajectoryModel}.
 */
export function acquireTrajectoryModel(model: string): Promise<TrajectoryModelTemplate> {
  let entry = cache.get(model);
  if (!entry) {
    const created: CacheEntry = {
      promise: loadTemplate(model),
      template: null,
      refs: 0,
      builtIn: isBuiltIn(model),
      invalidated: false,
    };
    created.promise.then(
      (t) => {
        created.template = t;
        // Released (or invalidated) before it finished loading.
        if (created.refs === 0 && !created.builtIn && (cache.get(model) === created || created.invalidated)) {
          disposeTemplate(t);
          if (cache.get(model) === created) cache.delete(model);
        }
      },
      () => {
        // Let a later acquire retry.
        if (cache.get(model) === created) cache.delete(model);
      },
    );
    cache.set(model, created);
    entry = created;
  }
  entry.refs += 1;
  return entry.promise;
}

/** User GLBs linger this long after their last release, so a scene rebuild does not refetch them. */
const USER_MODEL_EVICT_DELAY_MS = 10_000;

export function releaseTrajectoryModel(model: string): void {
  const entry = cache.get(model);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.builtIn || !entry.template) return;
  if (entry.invalidated) {
    disposeTemplate(entry.template);
    cache.delete(model);
    return;
  }
  setTimeout(() => {
    if (cache.get(model) !== entry || entry.refs > 0 || !entry.template) return;
    disposeTemplate(entry.template);
    cache.delete(model);
  }, USER_MODEL_EVICT_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Invalidation (library model edited or deleted)
// ---------------------------------------------------------------------------

/**
 * "release": drop every instance of `model` now (release its references);
 * "reload": acquire it again (only after an edit, not a delete).
 */
export type TrajectoryModelInvalidationPhase = "release" | "reload";
type InvalidationListener = (model: string, phase: TrajectoryModelInvalidationPhase) => void;
const invalidationListeners = new Set<InvalidationListener>();

/** Renderers subscribe to swap stale instances; returns the unsubscribe. */
export function onTrajectoryModelInvalidated(listener: InvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

/**
 * Forget the cached template of `model`: listeners release their instances
 * (disposing it once unused), the entry leaves the cache, and with `reload`
 * listeners acquire the fresh template.
 */
export function invalidateTrajectoryModel(model: string, reload: boolean): void {
  const entry = cache.get(model);
  if (entry) entry.invalidated = true;
  for (const l of [...invalidationListeners]) l(model, "release");
  if (entry && cache.get(model) === entry) {
    cache.delete(model);
    if (entry.refs === 0 && entry.template) disposeTemplate(entry.template);
    // Still referenced by someone who did not listen: it is now an orphan,
    // left to the garbage collector (GPU buffers go with the WebGL context).
  }
  if (reload) for (const l of [...invalidationListeners]) l(model, "reload");
}

modelLibrary.onChange(({ kind, id }) => invalidateTrajectoryModel(libraryModelKey(id), kind === "update"));

/** Per-renderer instance; shares geometry and materials with the template. */
export function instantiateTrajectoryModel(template: TrajectoryModelTemplate): THREE.Object3D {
  return template.root.clone(true);
}

function disposeTemplate(template: TrajectoryModelTemplate): void {
  template.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
