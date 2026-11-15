/**
 * Three.js renderer for tabulated trajectory tracks (see ./types.ts).
 *
 * Every track is Earth-fixed (ECEF km), so all trail geometry lives in one
 * group rotated by GMST each frame, exactly like the KML layer. Per visible
 * track:
 *   - the full path, faint;
 *   - the traversed part (first sample → current sim time) bright, ending in
 *     a live tip interpolated between path samples;
 *   - a fixed-pixel marker at the current position (hidden outside the span,
 *     and while the 3D model is drawn at ≥ 6 px);
 *   - small fixed-pixel markers at each event, with text labels for the
 *     focused track, and a name label next to the marker.
 *
 * 3D vehicle models are drawn by {@link TrajectoryRenderer.renderVehicles}, a
 * second pass after the main render: a separate scene in METRES, positioned
 * relative to the camera (the subtraction is done in float64 before scaling
 * to metres), with its own near/far bracketing the visible models and a
 * cleared depth buffer. The main scene's near plane (0.1 Earth radii) and
 * float32 positions cannot resolve a 70 m vehicle's fins; logarithmic depth
 * would z-fight at that scale too.
 *
 * `update()` is allocation-free: a binary search on the sampled times, then
 * the bright line's instance count and one segment end are rewritten.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { sunVectorECI } from "../astronomy";
import { geodeticUpEcef, trajectoryAttitudeAt } from "./attitude";
import { sampleTrajectoryPath, trajectoryEcefAt, trajectoryStateAt } from "./interpolate";
import {
  acquireTrajectoryModel,
  bodyToWorldQuaternion,
  instantiateTrajectoryModel,
  releaseTrajectoryModel,
  trajectoryModelLengthM,
  type TrajectoryModelTemplate,
} from "./models";
import type { BodyQuaternion, TrajectoryTrack } from "./types";

const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;
/** Scene unit (one equatorial Earth radius) in metres. */
const SCENE_UNIT_M = 6378137;

// The scene's ECEF mapping (x/Re, z/Rp, -y/Re) turns the WGS84 ellipsoid into
// the unit sphere, so scaling a track group about the origin lifts it
// radially by an altitude offset. Positions are stored unlifted; each frame
// the lift is min(MAX, PER_DISTANCE × camera distance to the track tip): ~0.6
// km from afar (enough against the globe, whose 128-segment facets sag ~2 km
// below the true surface anyway) but only metres when following a vehicle,
// so the trail stays on the model drawn at the true position.
const TRAJECTORY_SURFACE_OFFSET_MAX = 0.0001;
const TRAJECTORY_SURFACE_OFFSET_PER_DISTANCE = 0.01;

const FAINT_LINE_OPACITY = 0.28;
const LINE_WIDTH_PX = 2;
const MARKER_SIZE_PX = 9;
const EVENT_SIZE_PX = 6;
const EVENT_SIZE_FOCUSED_PX = 8;
const LABEL_FONT_PX = 11;
const LABEL_HEIGHT_PX = 16;
const LABEL_PAD_LEFT_PX = 9;
const DEFAULT_VEHICLE_LENGTH_M = 50;
/** Models projected smaller than this are skipped (marker dot only). */
const MODEL_MIN_PX = 2;
/** Models projected at least this large replace the marker dot. */
const MODEL_HIDE_MARKER_PX = 6;
const GROUND_DISC_RADIUS_M = 3000;
const GROUND_DISC_MAX_ALT_KM = 10;
const GROUND_DISC_FADE_START_KM = 5;
/** Occlusion sphere radius (scene units); a bit inside the unit sphere so surface points stay visible. */
const OCCLUDER_RADIUS = 0.9995;

/** ECEF km → scene local (Earth-fixed group) coordinates (unlifted; see the group scale). */
export function ecefToTrajectoryScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x / EARTH_RADIUS_EQUATOR_KM, z / EARTH_RADIUS_POLAR_KM, -y / EARTH_RADIUS_EQUATOR_KM);
}

let roundSpriteTexture: THREE.Texture | null = null;
let roundSpriteUsers = 0;

/** Shared round sprite so markers are dots, not squares. Reference counted. */
function acquireRoundSprite(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  if (!roundSpriteTexture) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    roundSpriteTexture = new THREE.CanvasTexture(canvas);
  }
  roundSpriteUsers++;
  return roundSpriteTexture;
}

function releaseRoundSprite() {
  roundSpriteUsers = Math.max(0, roundSpriteUsers - 1);
  if (roundSpriteUsers === 0 && roundSpriteTexture) {
    roundSpriteTexture.dispose();
    roundSpriteTexture = null;
  }
}

/** Fixed-pixel text sprite anchored at its left-middle (text starts right of the point). */
interface Label {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.Texture;
  widthPx: number;
  heightPx: number;
  occluded: boolean;
}

function createLabel(text: string, color: string): Label | null {
  if (typeof document === "undefined") return null;
  const dpr = Math.min(2, Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = `600 ${LABEL_FONT_PX * dpr}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const textWidth = Math.ceil(ctx.measureText(text).width / dpr);
  const widthPx = LABEL_PAD_LEFT_PX + textWidth + 4;
  const heightPx = LABEL_HEIGHT_PX;
  canvas.width = Math.ceil(widthPx * dpr);
  canvas.height = Math.ceil(heightPx * dpr);
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.strokeText(text, LABEL_PAD_LEFT_PX * dpr, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, LABEL_PAD_LEFT_PX * dpr, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0, 0.5);
  sprite.renderOrder = 5;
  sprite.frustumCulled = false;
  return { sprite, material, texture, widthPx, heightPx, occluded: false };
}

function disposeLabel(label: Label | null) {
  if (!label) return;
  label.sprite.removeFromParent();
  label.texture.dispose();
  label.material.dispose();
}

interface VehicleSlot {
  model: string;
  template: TrajectoryModelTemplate | null;
  object: THREE.Object3D | null;
  disc: THREE.Group;
  discFill: THREE.MeshBasicMaterial;
  discGrid: THREE.LineBasicMaterial;
  discDisposables: { dispose(): void }[];
  released: boolean;
}

interface TrackEntry {
  track: TrajectoryTrack;
  group: THREE.Group;
  /** Sampled path times (ms) and scene-space positions (xyz interleaved, unlifted). */
  timesMs: Float64Array;
  scenePositions: Float32Array;
  faintLine: Line2;
  brightLine: Line2;
  /** Interleaved segment buffer of the bright line (6 floats per segment). */
  brightSegments: Float32Array;
  brightBuffer: THREE.InterleavedBuffer;
  /** Segment whose end currently holds the live tip, or -1. */
  tipSegment: number;
  marker: THREE.Points;
  events: THREE.Points | null;
  eventMaterial: THREE.PointsMaterial | null;
  eventLabels: Label[];
  nameLabel: Label | null;
  /** Set by renderVehicles when the model is drawn large enough to replace the dot. */
  hideMarker: boolean;
  /** Whether the marker / name label is inside the span this frame. */
  inSpan: boolean;
  vehicle: VehicleSlot | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  usesSprite: boolean;
}

const scratchEcefPos = new Float64Array(3);
const scratchEcefVel = new Float64Array(3);

export class TrajectoryRenderer {
  private readonly scene: THREE.Scene;
  private readonly tmpLift = new THREE.Vector3();
  private readonly root: THREE.Group;
  private readonly entries = new Map<string, TrackEntry>();
  private tracks: TrajectoryTrack[] = [];
  private lineMaterials = new Set<LineMaterial>();
  private readonly resolution = new THREE.Vector2(
    typeof window !== "undefined" ? window.innerWidth : 1,
    typeof window !== "undefined" ? window.innerHeight : 1,
  );
  private lastSimMs = Number.NaN;
  private focusedId: string | null = null;
  /** Sprite scale per CSS pixel for sizeAttenuation:false sprites: 2 / (P[5] · H). */
  private labelScalePerPx: number;

  // Vehicle pass: ground discs (unlit, loose depth range) then models (tight range).
  private readonly vehicleScene = new THREE.Scene();
  private readonly discScene = new THREE.Scene();
  /** Neutral PMREM room environment so metallic GLB steel is not black (created lazily). */
  private environment: THREE.Texture | null = null;
  private environmentFailed = false;
  private readonly vehicleCamera = new THREE.PerspectiveCamera();
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly fillLight = new THREE.HemisphereLight(0xc4d6ff, 0x3a332c, 0.9);
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.15);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "TrajectoryTracks";
    this.scene.add(this.root);
    // Until the first renderVehicles() call: assume a 45° fov.
    this.labelScalePerPx = (2 * Math.tan(Math.PI / 8)) / Math.max(1, this.resolution.y);
    this.vehicleScene.name = "TrajectoryVehicles";
    this.vehicleScene.add(this.sunLight, this.sunLight.target, this.fillLight, this.ambientLight);
    this.vehicleScene.environmentIntensity = 0.35;
  }

  /** Refresh fat-line resolution (call from the resize handler). */
  setResolution(width: number, height: number): void {
    this.resolution.set(width, height);
    this.lineMaterials.forEach((m) => m.resolution.copy(this.resolution));
  }

  getTracks(): readonly TrajectoryTrack[] {
    return this.tracks;
  }

  /**
   * Replace the set of tracks. Geometry is rebuilt only for tracks whose
   * samples, events, colour or name changed; a visibility flip just toggles
   * the group, and a model change swaps only the vehicle. Attitude rules are
   * read live from the track. No-op for the same array reference.
   */
  setTracks(tracks: TrajectoryTrack[]): void {
    if (tracks === this.tracks) return;
    this.tracks = tracks;
    const keep = new Set<string>();
    for (const track of tracks) {
      keep.add(track.id);
      const existing = this.entries.get(track.id);
      if (
        existing &&
        existing.track.samples === track.samples &&
        existing.track.events === track.events &&
        existing.track.color === track.color &&
        existing.track.name === track.name
      ) {
        existing.track = track;
        existing.group.visible = track.visible;
        this.syncVehicle(existing);
        continue;
      }
      // Keep a loaded vehicle across a trail rebuild.
      const vehicle = existing?.vehicle ?? null;
      if (existing) {
        existing.vehicle = null;
        this.disposeEntry(existing);
      }
      const entry = this.buildEntry(track);
      if (entry) {
        entry.vehicle = vehicle;
        this.entries.set(track.id, entry);
        entry.group.visible = track.visible;
        this.applyFocus(entry);
        this.syncVehicle(entry);
      } else {
        if (vehicle) this.disposeVehicle(vehicle);
        this.entries.delete(track.id);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!keep.has(id)) this.disposeEntry(entry);
    }
    // Force the next update() to re-evaluate traversed parts for new entries.
    if (Number.isFinite(this.lastSimMs)) this.updateTracks(this.lastSimMs);
  }

  /** Follow Earth rotation and advance every track to `simDate`. Allocation-free. */
  update(simDate: Date, rotAngle: number): void {
    this.root.rotation.y = rotAngle;
    const simMs = simDate.getTime();
    this.lastSimMs = simMs;
    this.updateTracks(simMs);
  }

  /**
   * Earth-fixed scene position (inside the GMST-rotated group, i.e. before
   * that rotation) of `id` at `simMs`, or of its first sample when outside
   * the span. Null for an unknown track. Follows the drawn (lifted) trail.
   */
  localPositionAt(id: string, simMs: number, out: THREE.Vector3): THREE.Vector3 | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const n = entry.timesMs.length;
    if (n === 0) return null;
    if (simMs < entry.timesMs[0] || simMs > entry.timesMs[n - 1]) {
      const p = entry.scenePositions;
      return out.set(p[0], p[1], p[2]);
    }
    const k = this.segmentIndex(entry.timesMs, simMs);
    return this.interpolate(entry, k, simMs, out);
  }

  /**
   * True position (no drawing lift) in overlay-local scene units (Earth
   * radii, same mapping as the trail) and velocity in those units per second.
   * False for an unknown id or outside the span. Allocation-free.
   */
  localStateAt(id: string, timeMs: number, outPos: THREE.Vector3, outVel: THREE.Vector3): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!trajectoryEcefAt(entry.track, timeMs, scratchEcefPos, scratchEcefVel)) return false;
    const p = scratchEcefPos;
    const v = scratchEcefVel;
    outPos.set(p[0] / EARTH_RADIUS_EQUATOR_KM, p[2] / EARTH_RADIUS_POLAR_KM, -p[1] / EARTH_RADIUS_EQUATOR_KM);
    outVel.set(v[0] / EARTH_RADIUS_EQUATOR_KM, v[2] / EARTH_RADIUS_POLAR_KM, -v[1] / EARTH_RADIUS_EQUATOR_KM);
    return true;
  }

  /**
   * Model length in metres: the loaded model's, else the registry length of a
   * built-in key (known before loading), else 50.
   */
  vehicleLengthM(id: string): number {
    const entry = this.entries.get(id);
    const loaded = entry?.vehicle?.template?.lengthM;
    if (loaded) return loaded;
    const track = entry?.track ?? this.tracks.find((t) => t.id === id);
    return trajectoryModelLengthM(track?.model) ?? DEFAULT_VEHICLE_LENGTH_M;
  }

  /** Show event labels (and enlarge event dots) for this track only; null = none. */
  setFocusedTrack(id: string | null): void {
    if (id === this.focusedId) return;
    this.focusedId = id;
    for (const entry of this.entries.values()) this.applyFocus(entry);
  }

  /**
   * Second render pass for 3D models; call right after
   * `renderer.render(scene, camera)`. Leaves renderer state as found. Also
   * refreshes label pixel scale and Earth occlusion (applied next frame).
   */
  renderVehicles(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    simDate: Date,
    rotAngle: number,
  ): void {
    renderer.getSize(this.tmpSize);
    const viewportH = Math.max(1, this.tmpSize.y);
    const p5 = camera.projectionMatrix.elements[5];
    if (!(p5 > 0)) return;
    this.updateLabelScale(2 / (p5 * viewportH));

    const cosR = Math.cos(rotAngle);
    const sinR = Math.sin(rotAngle);
    const me = camera.matrixWorld.elements;
    const camX = me[12];
    const camY = me[13];
    const camZ = me[14];
    // Camera in the Earth-fixed local frame (inverse GMST rotation).
    const camLocal = this.tmpCamLocal.set(camX * cosR - camZ * sinR, camY, camX * sinR + camZ * cosR);
    this.updateLabelOcclusion(camLocal);
    this.updateTrailLift(camLocal, simDate.getTime());

    const simMs = simDate.getTime();
    const pxPerRad = (p5 * viewportH) / 2;
    let drawn = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let farthest = 0;
    let discs = 0;
    let discNearest = Number.POSITIVE_INFINITY;
    let discFarthest = 0;
    let nearestUpSet = false;

    for (const entry of this.entries.values()) {
      entry.hideMarker = false;
      const slot = entry.vehicle;
      if (!slot || !slot.object || !slot.template) continue;
      const object = slot.object;
      object.visible = false;
      slot.disc.visible = false;
      if (!entry.track.visible) continue;
      if (!trajectoryEcefAt(entry.track, simMs, scratchEcefPos)) continue;
      const p = scratchEcefPos;
      const lx = p[0] / EARTH_RADIUS_EQUATOR_KM;
      const ly = p[2] / EARTH_RADIUS_POLAR_KM;
      const lz = -p[1] / EARTH_RADIUS_EQUATOR_KM;
      if (this.occludedByEarth(camLocal, lx, ly, lz)) continue;
      // float64 subtraction first, then metres.
      const dx = (lx * cosR + lz * sinR - camX) * SCENE_UNIT_M;
      const dy = (ly - camY) * SCENE_UNIT_M;
      const dz = (-lx * sinR + lz * cosR - camZ) * SCENE_UNIT_M;
      const dist = Math.hypot(dx, dy, dz);
      const lengthM = slot.template.lengthM;
      const px = (lengthM * pxPerRad) / Math.max(dist, 1e-3);
      if (px < MODEL_MIN_PX) continue;

      const state = trajectoryStateAt(entry.track, simMs);
      if (!state) continue;
      const q = trajectoryAttitudeAt(entry.track, simMs, state, this.bodyQuat);
      if (!q) continue;
      entry.hideMarker = px >= MODEL_HIDE_MARKER_PX;

      bodyToWorldQuaternion(q, rotAngle, object.quaternion);
      // Geodetic up in world coordinates (ECEF → local (x, z, −y) → rotY).
      const upE = geodeticUpEcef(state.latDeg, state.lonDeg, this.tmpUpEcef);
      const ulx = upE.x;
      const uly = upE.z;
      const ulz = -upE.y;
      const up = this.tmpUpWorld.set(ulx * cosR + ulz * sinR, uly, -ulx * sinR + ulz * cosR);
      // Rockets keep their BASE on the track point at every attitude (centre =
      // track point + nose · L/2), so stacked stages (`mount`) stay joined and
      // the pad/catch contact is exact; the vehicle turns about its base.
      const centre = this.tmpCentre.set(dx, dy, dz);
      if (slot.template.anchor === "base") {
        centre.addScaledVector(this.tmpPivot.set(1, 0, 0).applyQuaternion(object.quaternion), lengthM / 2);
      }
      object.position.copy(centre).sub(this.tmpPivot.copy(slot.template.pivotBody).applyQuaternion(object.quaternion));
      // Upper stage stacked on the lower one until separation.
      const mount = entry.track.mount;
      if (mount && simMs < mount.untilMs) {
        object.position.addScaledVector(this.tmpPivot.set(1, 0, 0).applyQuaternion(object.quaternion), mount.offsetM);
      }
      object.visible = true;
      drawn += 1;
      if (dist - lengthM < nearest) {
        nearest = dist - lengthM;
        this.fillLight.position.copy(up);
        nearestUpSet = true;
      }
      farthest = Math.max(farthest, dist + lengthM);

      // Sea-level ground reference near lift-off / landing.
      if (state.altKm < GROUND_DISC_MAX_ALT_KM) {
        const h = state.altKm;
        const gx = (p[0] - upE.x * h) / EARTH_RADIUS_EQUATOR_KM;
        const gy = (p[2] - upE.z * h) / EARTH_RADIUS_POLAR_KM;
        const gz = -(p[1] - upE.y * h) / EARTH_RADIUS_EQUATOR_KM;
        const disc = slot.disc;
        disc.position.set(
          (gx * cosR + gz * sinR - camX) * SCENE_UNIT_M,
          (gy - camY) * SCENE_UNIT_M,
          (-gx * sinR + gz * cosR - camZ) * SCENE_UNIT_M,
        );
        disc.quaternion.setFromUnitVectors(this.yAxis, up);
        const fade = 1 - THREE.MathUtils.smoothstep(h, GROUND_DISC_FADE_START_KM, GROUND_DISC_MAX_ALT_KM);
        slot.discFill.opacity = 0.22 * fade;
        slot.discGrid.opacity = 0.45 * fade;
        disc.visible = fade > 0;
        if (disc.visible) {
          const discDist = disc.position.length();
          discFarthest = Math.max(discFarthest, discDist + GROUND_DISC_RADIUS_M);
          discNearest = Math.min(discNearest, discDist - GROUND_DISC_RADIUS_M);
          discs += 1;
        }
      }
    }
    if (drawn === 0) return;

    // Lights: real sun direction (ECI (x, y, z) → world (x, z, −y)) plus a
    // sky/ground fill along the nearest vehicle's local up.
    const sun = sunVectorECI(simDate);
    this.sunLight.position.set(sun.x, sun.z, -sun.y);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.target.updateMatrixWorld();
    if (!nearestUpSet) this.fillLight.position.set(0, 1, 0);
    this.ensureEnvironment(renderer);

    const vc = this.vehicleCamera;
    vc.fov = camera.fov;
    vc.aspect = camera.aspect;
    vc.zoom = camera.zoom;
    vc.filmGauge = camera.filmGauge;
    vc.filmOffset = camera.filmOffset;
    if (camera.view?.enabled) {
      vc.view = Object.assign(vc.view ?? { ...camera.view }, camera.view);
    } else if (vc.view) {
      vc.view.enabled = false;
    }
    vc.position.set(0, 0, 0);
    camera.getWorldQuaternion(vc.quaternion);
    vc.updateMatrixWorld();

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    if (discs > 0) {
      vc.near = Math.max(0.05, discNearest);
      vc.far = Math.max(vc.near + 1, discFarthest);
      vc.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(this.discScene, vc);
    }
    vc.near = Math.max(0.05, nearest);
    vc.far = Math.max(vc.near + 1, farthest);
    vc.updateProjectionMatrix();
    renderer.clearDepth();
    renderer.render(this.vehicleScene, vc);
    renderer.autoClear = autoClear;
  }

  /** Lazily build the PMREM room environment; skipped (marker-safe) when unavailable. */
  private ensureEnvironment(renderer: THREE.WebGLRenderer) {
    if (this.environment || this.environmentFailed) return;
    if (!(renderer instanceof THREE.WebGLRenderer)) {
      this.environmentFailed = true;
      return;
    }
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
      this.vehicleScene.environment = this.environment;
    } catch (error) {
      this.environmentFailed = true;
      console.warn("Trajectory vehicle environment map unavailable.", error);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.tracks = [];
    this.scene.remove(this.root);
    this.vehicleScene.clear();
    this.vehicleScene.environment = null;
    this.environment?.dispose();
    this.environment = null;
    this.discScene.clear();
    this.sunLight.dispose();
    this.fillLight.dispose();
    this.ambientLight.dispose();
  }

  // --- internals -----------------------------------------------------------

  private readonly tmp = new THREE.Vector3();
  private readonly tmpSize = new THREE.Vector2();
  private readonly tmpCamLocal = new THREE.Vector3();
  private readonly tmpUpEcef = new THREE.Vector3();
  private readonly tmpUpWorld = new THREE.Vector3();
  private readonly tmpCentre = new THREE.Vector3();
  private readonly tmpPivot = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly bodyQuat: BodyQuaternion = { w: 1, x: 0, y: 0, z: 0 };

  private updateTracks(simMs: number) {
    for (const entry of this.entries.values()) {
      if (!entry.track.visible) continue;
      this.updateEntry(entry, simMs);
    }
  }

  private updateEntry(entry: TrackEntry, simMs: number) {
    const times = entry.timesMs;
    const n = times.length;
    const segments = entry.brightSegments;
    const geom = entry.brightLine.geometry as LineGeometry;

    // Restore the segment end overwritten by the previous live tip.
    if (entry.tipSegment >= 0) {
      const k = entry.tipSegment;
      const p = entry.scenePositions;
      segments[k * 6 + 3] = p[(k + 1) * 3];
      segments[k * 6 + 4] = p[(k + 1) * 3 + 1];
      segments[k * 6 + 5] = p[(k + 1) * 3 + 2];
      entry.tipSegment = -1;
      entry.brightBuffer.needsUpdate = true;
    }

    if (simMs < times[0] || simMs >= times[n - 1]) {
      const finished = simMs >= times[n - 1];
      geom.instanceCount = finished ? n - 1 : 0;
      entry.brightLine.visible = finished;
      entry.marker.visible = false;
      entry.inSpan = false;
      if (entry.nameLabel) entry.nameLabel.sprite.visible = false;
      return;
    }

    const k = this.segmentIndex(times, simMs);
    const tip = this.interpolate(entry, k, simMs, this.tmp);
    segments[k * 6 + 3] = tip.x;
    segments[k * 6 + 4] = tip.y;
    segments[k * 6 + 5] = tip.z;
    entry.tipSegment = k;
    entry.brightBuffer.needsUpdate = true;
    geom.instanceCount = k + 1;
    entry.brightLine.visible = true;
    entry.marker.position.copy(tip);
    entry.marker.visible = !entry.hideMarker;
    entry.inSpan = true;
    if (entry.nameLabel) {
      // The tip is this frame's true position (the trail is unlifted in
      // storage), so the label stays on the model even at 1.6 km/s.
      entry.nameLabel.sprite.position.copy(tip);
      entry.nameLabel.sprite.visible = !entry.nameLabel.occluded;
    }
  }

  /** Largest k with times[k] <= t, clamped to [0, n-2]. */
  private segmentIndex(times: Float64Array, t: number): number {
    let lo = 0;
    let hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return Math.min(lo, times.length - 2);
  }

  private interpolate(entry: TrackEntry, k: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const times = entry.timesMs;
    const p = entry.scenePositions;
    const t0 = times[k];
    const t1 = times[k + 1];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const a = k * 3;
    const b = (k + 1) * 3;
    return out.set(
      p[a] + (p[b] - p[a]) * f,
      p[a + 1] + (p[b + 1] - p[a + 1]) * f,
      p[a + 2] + (p[b + 2] - p[a + 2]) * f,
    );
  }

  /** Segment camera → point (local frame) crosses the Earth before reaching the point. */
  private occludedByEarth(cam: THREE.Vector3, px: number, py: number, pz: number): boolean {
    const dx = px - cam.x;
    const dy = py - cam.y;
    const dz = pz - cam.z;
    const a = dx * dx + dy * dy + dz * dz;
    if (a === 0) return false;
    const b = 2 * (cam.x * dx + cam.y * dy + cam.z * dz);
    const c = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - OCCLUDER_RADIUS * OCCLUDER_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t > 0 && t < 1;
  }

  private updateLabelOcclusion(camLocal: THREE.Vector3) {
    for (const entry of this.entries.values()) {
      if (!entry.track.visible) continue;
      const name = entry.nameLabel;
      if (name && entry.inSpan) {
        const pos = name.sprite.position;
        name.occluded = this.occludedByEarth(camLocal, pos.x, pos.y, pos.z);
      }
      if (entry.track.id !== this.focusedId) continue;
      for (const label of entry.eventLabels) {
        const pos = label.sprite.position;
        label.occluded = this.occludedByEarth(camLocal, pos.x, pos.y, pos.z);
        label.sprite.visible = !label.occluded;
      }
    }
  }

  /**
   * Radial drawing lift per track, applied as a group scale about the Earth's
   * centre (takes effect next frame): proportional to the camera's distance to
   * the track's current tip, capped at TRAJECTORY_SURFACE_OFFSET_MAX.
   */
  private updateTrailLift(camLocal: THREE.Vector3, simMs: number) {
    for (const entry of this.entries.values()) {
      if (!entry.group.visible) continue;
      const times = entry.timesMs;
      const n = times.length;
      const t = Math.min(Math.max(simMs, times[0]), times[n - 1]);
      const tip = this.interpolate(entry, this.segmentIndex(times, t), t, this.tmpLift);
      const lift = Math.min(TRAJECTORY_SURFACE_OFFSET_MAX, TRAJECTORY_SURFACE_OFFSET_PER_DISTANCE * tip.distanceTo(camLocal));
      entry.group.scale.setScalar(1 + lift);
    }
  }

  private updateLabelScale(scalePerPx: number) {
    if (Math.abs(scalePerPx - this.labelScalePerPx) <= 1e-6 * this.labelScalePerPx) return;
    this.labelScalePerPx = scalePerPx;
    for (const entry of this.entries.values()) {
      if (entry.nameLabel) this.scaleLabel(entry.nameLabel);
      entry.eventLabels.forEach((l) => this.scaleLabel(l));
    }
  }

  private scaleLabel(label: Label) {
    label.sprite.scale.set(label.widthPx * this.labelScalePerPx, label.heightPx * this.labelScalePerPx, 1);
  }

  private applyFocus(entry: TrackEntry) {
    const focused = entry.track.id === this.focusedId;
    for (const label of entry.eventLabels) label.sprite.visible = focused && !label.occluded;
    if (entry.eventMaterial) {
      entry.eventMaterial.size = focused ? EVENT_SIZE_FOCUSED_PX : EVENT_SIZE_PX;
      entry.eventMaterial.opacity = focused ? 1 : 0.9;
    }
  }

  // --- vehicles --------------------------------------------------------------

  /** Make the entry's vehicle match `track.model` (swap or drop as needed). */
  private syncVehicle(entry: TrackEntry) {
    const model = entry.track.model;
    if (entry.vehicle?.model === model) return;
    if (entry.vehicle) {
      this.disposeVehicle(entry.vehicle);
      entry.vehicle = null;
    }
    entry.hideMarker = false;
    if (!model) return;
    const slot = this.createVehicleSlot(model);
    entry.vehicle = slot;
    acquireTrajectoryModel(model).then(
      (template) => {
        if (slot.released) return;
        slot.template = template;
        const object = instantiateTrajectoryModel(template);
        object.visible = false;
        slot.object = object;
        this.vehicleScene.add(object);
      },
      (error: unknown) => {
        if (slot.released) return;
        console.warn(`Trajectory model "${model}" could not be loaded; showing the marker only.`, error);
      },
    );
  }

  private createVehicleSlot(model: string): VehicleSlot {
    const disc = new THREE.Group();
    disc.visible = false;
    disc.scale.setScalar(GROUND_DISC_RADIUS_M);
    const fillGeometry = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    const discFill = new THREE.MeshBasicMaterial({
      color: 0x8fa3b8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeometry, discFill);
    fill.renderOrder = -2;
    const grid = new THREE.PolarGridHelper(1, 12, 6, 64, 0xd7e3f0, 0xd7e3f0);
    const discGrid = grid.material as THREE.LineBasicMaterial;
    discGrid.transparent = true;
    discGrid.opacity = 0.45;
    discGrid.depthWrite = false;
    grid.renderOrder = -1;
    disc.add(fill, grid);
    this.discScene.add(disc);
    return {
      model,
      template: null,
      object: null,
      disc,
      discFill,
      discGrid,
      discDisposables: [fillGeometry, discFill, grid.geometry, discGrid],
      released: false,
    };
  }

  /** Remove the per-renderer clone; shared template geometry/materials stay with the cache. */
  private disposeVehicle(slot: VehicleSlot) {
    if (slot.released) return;
    slot.released = true;
    if (slot.object) this.vehicleScene.remove(slot.object);
    slot.object = null;
    this.discScene.remove(slot.disc);
    slot.discDisposables.forEach((d) => d.dispose());
    releaseTrajectoryModel(slot.model);
  }

  // --- build / dispose ---------------------------------------------------------

  private buildEntry(track: TrajectoryTrack): TrackEntry | null {
    const { timesMs, positions } = sampleTrajectoryPath(track);
    const n = timesMs.length;
    if (n < 2) return null;

    const scenePositions = new Float32Array(n * 3);
    const v = this.tmp;
    for (let i = 0; i < n; i++) {
      ecefToTrajectoryScene(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], v);
      scenePositions[i * 3] = v.x;
      scenePositions[i * 3 + 1] = v.y;
      scenePositions[i * 3 + 2] = v.z;
    }

    const color = new THREE.Color(track.color);
    const group = new THREE.Group();
    group.name = `Trajectory:${track.name}`;
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    // Faint full path. depthWrite off on both lines so the coplanar bright
    // line (drawn later via renderOrder) does not z-fight with it.
    const faintGeometry = new LineGeometry();
    faintGeometry.setPositions(scenePositions);
    const faintMaterial = new LineMaterial({
      color,
      linewidth: LINE_WIDTH_PX,
      worldUnits: false,
      transparent: true,
      opacity: FAINT_LINE_OPACITY,
      depthWrite: false,
    });
    faintMaterial.resolution.copy(this.resolution);
    const faintLine = new Line2(faintGeometry, faintMaterial);
    faintLine.frustumCulled = false;
    faintLine.renderOrder = 1;
    group.add(faintLine);

    // Bright traversed path: same segments, drawn up to the live tip.
    const brightGeometry = new LineGeometry();
    brightGeometry.setPositions(scenePositions);
    const startAttr = brightGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    const brightBuffer = startAttr.data;
    brightBuffer.setUsage(THREE.DynamicDrawUsage);
    const brightSegments = brightBuffer.array as Float32Array;
    brightGeometry.instanceCount = 0;
    const brightMaterial = new LineMaterial({
      color,
      linewidth: LINE_WIDTH_PX,
      worldUnits: false,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    brightMaterial.resolution.copy(this.resolution);
    const brightLine = new Line2(brightGeometry, brightMaterial);
    brightLine.frustumCulled = false;
    brightLine.renderOrder = 2;
    brightLine.visible = false;
    group.add(brightLine);

    const sprite = acquireRoundSprite();

    // Current-position marker: one vertex at the origin, moved via position.
    const markerGeometry = new THREE.BufferGeometry();
    markerGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const markerMaterial = new THREE.PointsMaterial({
      color,
      size: MARKER_SIZE_PX,
      sizeAttenuation: false,
      map: sprite,
      transparent: true,
      alphaTest: 0.5,
    });
    const marker = new THREE.Points(markerGeometry, markerMaterial);
    marker.frustumCulled = false;
    marker.renderOrder = 3;
    marker.visible = false;
    group.add(marker);

    const labelColor = `#${color.clone().lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`;

    // Event markers (lighter than the track colour) and their labels.
    let events: THREE.Points | null = null;
    let eventMaterial: THREE.PointsMaterial | null = null;
    const eventLabels: Label[] = [];
    if (track.events.length > 0) {
      const eventPositions: number[] = [];
      for (const ev of track.events) {
        if (ev.timeMs < timesMs[0] || ev.timeMs > timesMs[n - 1]) continue;
        const k = this.segmentIndex(timesMs, ev.timeMs);
        const t0 = timesMs[k];
        const t1 = timesMs[k + 1];
        const f = t1 > t0 ? Math.min(1, Math.max(0, (ev.timeMs - t0) / (t1 - t0))) : 0;
        const xyz: number[] = [];
        for (let c = 0; c < 3; c++) {
          const a = scenePositions[k * 3 + c];
          const b = scenePositions[(k + 1) * 3 + c];
          xyz.push(a + (b - a) * f);
        }
        eventPositions.push(...xyz);
        const label = createLabel(ev.label, labelColor);
        if (label) {
          label.sprite.position.set(xyz[0], xyz[1], xyz[2]);
          label.sprite.visible = false;
          this.scaleLabel(label);
          group.add(label.sprite);
          eventLabels.push(label);
        }
      }
      if (eventPositions.length > 0) {
        const eventGeometry = new THREE.BufferGeometry();
        eventGeometry.setAttribute("position", new THREE.Float32BufferAttribute(eventPositions, 3));
        eventMaterial = new THREE.PointsMaterial({
          color: color.clone().lerp(new THREE.Color(0xffffff), 0.55),
          size: EVENT_SIZE_PX,
          sizeAttenuation: false,
          map: sprite,
          transparent: true,
          alphaTest: 0.5,
          opacity: 0.9,
        });
        events = new THREE.Points(eventGeometry, eventMaterial);
        events.renderOrder = 3;
        group.add(events);
        geometries.push(eventGeometry);
        materials.push(eventMaterial);
      }
    }

    const nameLabel = createLabel(track.name, labelColor);
    if (nameLabel) {
      nameLabel.sprite.visible = false;
      this.scaleLabel(nameLabel);
      group.add(nameLabel.sprite);
    }

    geometries.push(faintGeometry, brightGeometry, markerGeometry);
    materials.push(faintMaterial, brightMaterial, markerMaterial);
    this.lineMaterials.add(faintMaterial);
    this.lineMaterials.add(brightMaterial);
    this.root.add(group);

    return {
      track,
      group,
      timesMs,
      scenePositions,
      faintLine,
      brightLine,
      brightSegments,
      brightBuffer,
      tipSegment: -1,
      marker,
      events,
      eventMaterial,
      eventLabels,
      nameLabel,
      hideMarker: false,
      inSpan: false,
      vehicle: null,
      materials,
      geometries,
      usesSprite: sprite !== null,
    };
  }

  private disposeEntry(entry: TrackEntry) {
    this.root.remove(entry.group);
    entry.geometries.forEach((g) => g.dispose());
    entry.materials.forEach((m) => {
      if (m instanceof LineMaterial) this.lineMaterials.delete(m);
      m.dispose();
    });
    entry.eventLabels.forEach(disposeLabel);
    disposeLabel(entry.nameLabel);
    if (entry.vehicle) {
      this.disposeVehicle(entry.vehicle);
      entry.vehicle = null;
    }
    if (entry.usesSprite) releaseRoundSprite();
    if (this.entries.get(entry.track.id) === entry) this.entries.delete(entry.track.id);
  }
}
