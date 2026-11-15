/**
 * Model library: user-imported 3D models (glTF 2.0: .glb or self-contained
 * .gltf) kept in the browser (IndexedDB), with the metadata that maps the
 * model's own axes, units and origin onto the app's body frame
 * (docs/satellite-attitude.md: +X ram / nose, +Z nadir / sensor,
 * +Y = Z × X).
 *
 * A library model is referenced everywhere by the model string
 * `library:<id>` (DisplayOptions.satelliteModel, TrajectoryTrack.model).
 */

/** Model string prefix of library models. */
export const LIBRARY_MODEL_PREFIX = "library:";

/** A signed axis of the model's own coordinate system. */
export type ModelAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

export const MODEL_AXES: readonly ModelAxis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

/** Which model axes become body +X (forward / nose) and body +Z (nadir / sensor). */
export interface ModelOrientation {
  forward: ModelAxis;
  nadir: ModelAxis;
}

export type ModelUnit = "m" | "cm" | "mm" | "in";

export const MODEL_UNITS: readonly ModelUnit[] = ["m", "cm", "mm", "in"];

/** Metres per model unit. */
export const METRES_PER_UNIT: Readonly<Record<ModelUnit, number>> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };

/** How model units become metres: a unit, or the real overall length (longest bbox side). */
export type ModelScale = { mode: "unit"; unit: ModelUnit } | { mode: "length"; lengthM: number };

/** Where the model's reference point is: bbox centre (satellites) or the base on the forward axis (rockets). */
export type ModelOrigin = "center" | "base";

/** A node of the glTF scene, addressed by child indices from the scene root (names may be empty or repeated). */
export interface ModelNodeRef {
  path: number[];
  name: string;
}

export type ModelFormat = "glb" | "gltf";

export interface LibraryModelMeta {
  id: string;
  name: string;
  fileName: string;
  format: ModelFormat;
  sizeBytes: number;
  /** ISO time of import. */
  addedAt: string;
  /** ISO time of the last metadata edit. */
  updatedAt: string;
  orientation: ModelOrientation;
  scale: ModelScale;
  origin: ModelOrigin;
  /** Bounding-box size in model units (x, y, z), measured at import. */
  bboxSize: [number, number, number];
  /** Solar-array nodes turned about body +Y by the 1軸追尾 drive (empty = fixed). */
  solarWings: ModelNodeRef[];
  /** Up axis of the source data chosen in the dialog (「元データの上方向」); absent in older records. */
  sourceUp?: "y" | "z";
}

/** Editable part of the metadata (what the import / edit dialog changes). */
export type LibraryModelSettings = Pick<LibraryModelMeta, "name" | "orientation" | "scale" | "origin" | "solarWings"> &
  Partial<Pick<LibraryModelMeta, "sourceUp">>;

/** File size above which a warning is shown. */
export const MODEL_WARN_BYTES = 15 * 1024 * 1024;
/** File size limit. */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;

export function libraryModelKey(id: string): string {
  return `${LIBRARY_MODEL_PREFIX}${id}`;
}

/** The id of a `library:<id>` model string, else null. */
export function libraryModelId(model: string | undefined | null): string | null {
  if (!model || !model.startsWith(LIBRARY_MODEL_PREFIX)) return null;
  const id = model.slice(LIBRARY_MODEL_PREFIX.length);
  return isValidLibraryId(id) ? id : null;
}

export function isValidLibraryId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Built-in model of the 近接 satellite (標準バス). */
export const DEFAULT_SATELLITE_MODEL = "satellite-bus";

/** Whether `v` is a valid DisplayOptions.satelliteModel value ("satellite-bus" or `library:<id>`). */
export function isSatelliteModelValue(v: unknown): v is string {
  return v === DEFAULT_SATELLITE_MODEL || (typeof v === "string" && libraryModelId(v) !== null);
}

/** Element id of the 表示 › 3Dモデル section (satellite card 「機体モデル … 変更…」). */
export const MODEL_SECTION_ANCHOR = "display-models";
