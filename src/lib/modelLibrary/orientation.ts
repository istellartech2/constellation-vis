/**
 * Pure orientation / scale math of library models (no three.js), so it can
 * be unit-tested and shared by the import preview and the renderer.
 */
import {
  METRES_PER_UNIT,
  type LibraryModelMeta,
  MODEL_AXES,
  type ModelAxis,
  type ModelOrientation,
  type ModelScale,
  type ModelUnit,
} from "./types";

export type Vec3 = [number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [Vec3, Vec3, Vec3];

export function axisVector(axis: ModelAxis): Vec3 {
  const s = axis[0] === "-" ? -1 : 1;
  const i = axis[1] === "X" ? 0 : axis[1] === "Y" ? 1 : 2;
  const v: Vec3 = [0, 0, 0];
  v[i] = s;
  return v;
}

export function axisIndex(axis: ModelAxis): 0 | 1 | 2 {
  return axis[1] === "X" ? 0 : axis[1] === "Y" ? 1 : 2;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The signed axis of a unit coordinate vector. */
export function vectorAxis(v: Vec3): ModelAxis {
  const i = v.findIndex((c) => c !== 0);
  return `${v[i] < 0 ? "-" : "+"}${"XYZ"[i]}` as ModelAxis;
}

export function isModelAxis(v: unknown): v is ModelAxis {
  return typeof v === "string" && (MODEL_AXES as readonly string[]).includes(v);
}

/** Forward and nadir must be perpendicular (different letters). */
export function isValidOrientation(o: ModelOrientation): boolean {
  return isModelAxis(o.forward) && isModelAxis(o.nadir) && axisIndex(o.forward) !== axisIndex(o.nadir);
}

/** The model axis that becomes body +Y (= nadir × forward, right-handed). */
export function bodyYAxis(o: ModelOrientation): ModelAxis {
  return vectorAxis(cross(axisVector(o.nadir), axisVector(o.forward)));
}

/**
 * Rotation model → body (row-major): rows are the model vectors that become
 * body X (forward), Y (nadir × forward) and Z (nadir). Proper (det +1).
 */
export function modelToBodyMatrix(o: ModelOrientation): Mat3 {
  if (!isValidOrientation(o)) throw new Error("forward and nadir axes must be perpendicular");
  const f = axisVector(o.forward);
  const d = axisVector(o.nadir);
  return [f, cross(d, f), d];
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Bounding-box size in body axes (a permutation of the model-axis size). */
export function bodyBoxSize(o: ModelOrientation, size: Vec3): Vec3 {
  const y = bodyYAxis(o);
  return [size[axisIndex(o.forward)], size[axisIndex(y)], size[axisIndex(o.nadir)]];
}

/** Orientation used when the dialog's 「自動推定」 is pressed (and as the import default). */
export type ModelKind = "satellite" | "rocket";

/** Up axis of the source data: glTF is Y-up; CAD exports are often Z-up. */
export type SourceUp = "y" | "z";

/**
 * Bounding-box orientation guess, given the source data's up axis.
 * - satellite: Earth is "down", so nadir = −up; of the two horizontal axes
 *   the longer is the wing span (body ±Y) and the other is forward (+).
 *   (Z-up CAD, wings along X → forward +Y, nadir −Z.)
 * - rocket: the nose is + of the longest axis. Standing up (nose = up) the
 *   belly is +Z for Y-up (the built-in glTF convention) and +Y for Z-up;
 *   lying flat it is −up.
 */
export function autoOrientation(size: Vec3, kind: ModelKind, up: SourceUp = "y"): ModelOrientation {
  const upIndex = up === "y" ? 1 : 2;
  const [h1, h2] = [0, 1, 2].filter((i) => i !== upIndex);
  const letter = (i: number) => "XYZ"[i];
  if (kind === "rocket") {
    const longest = size[1] >= size[0] && size[1] >= size[2] ? 1 : size[0] >= size[2] ? 0 : 2;
    const forward = `+${letter(longest)}` as ModelAxis;
    if (longest === upIndex) return { forward, nadir: up === "y" ? "+Z" : "+Y" };
    return { forward, nadir: `-${letter(upIndex)}` as ModelAxis };
  }
  const span = size[h1] >= size[h2] ? h1 : h2;
  const forwardIndex = span === h1 ? h2 : h1;
  return { forward: `+${letter(forwardIndex)}` as ModelAxis, nadir: `-${letter(upIndex)}` as ModelAxis };
}

/** Guess the source up axis from an orientation (for editing models saved without it). */
export function sourceUpOf(o: ModelOrientation): SourceUp {
  return o.nadir[1] === "Z" || o.forward[1] === "Z" ? "z" : "y";
}

/** Unit guess from the longest bbox side in model units (CAD exports are often mm). */
export function guessUnit(longestSide: number): ModelUnit {
  if (longestSide >= 1000) return "mm";
  if (longestSide >= 200) return "cm";
  return "m";
}

/** Metres per model unit for a scale setting; `longestSide` is the longest bbox side in model units. */
export function metresPerModelUnit(scale: ModelScale, longestSide: number): number {
  if (scale.mode === "unit") return METRES_PER_UNIT[scale.unit] ?? 1;
  if (!(longestSide > 0) || !(scale.lengthM > 0)) return 1;
  return scale.lengthM / longestSide;
}

export function longestSide(size: Vec3): number {
  return Math.max(size[0], size[1], size[2]);
}

/** Overall size of a library model in metres (longest side). */
export function libraryModelLengthM(meta: Pick<LibraryModelMeta, "scale" | "bboxSize">): number {
  return longestSide(meta.bboxSize) * metresPerModelUnit(meta.scale, longestSide(meta.bboxSize));
}
