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
 *
 * Trail options (`track.trail`, see docs/trajectory-layer.md): both lines
 * carry a per-segment time attribute, and a small patch of the fat-line
 * shader uses it to fade the bright line over a time window behind the tip
 * and, in the "inertial" frame, to rotate each point back by the Earth's
 * rotation since it was flown — no per-frame geometry work for either.
 *
 * Precision: the lines live in a child group whose origin is re-based near
 * the vehicle when the camera is close (float32 vertices relative to an
 * origin within ~60 km keep millimetre precision), so trails do not shimmer
 * against the model while following a vehicle.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EARTH_FLATTENING, sunVectorECI } from "../astronomy";
import { geodeticUpEcef, trajectoryAttitudeAt, uprightBodyQuaternion } from "./attitude";
import { sampleTrajectoryPath, trajectoryEcefAt, trajectoryStateAt } from "./interpolate";
import {
  acquireTrajectoryModel,
  bodyToWorldQuaternion,
  instantiateTrajectoryModel,
  releaseTrajectoryModel,
  setSolarArrayDrive,
  trajectoryModelLengthM,
  type TrajectoryModelTemplate,
} from "./models";
import { llaToEcef } from "./parse";
import type { BodyQuaternion, TrajectoryLandmark, TrajectoryTrack } from "./types";

const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;
/** Scene unit (one equatorial Earth radius) in metres. */
const SCENE_UNIT_M = 6378137;

// Tracks are stored in an "overlay-local" frame, ECEF mapped as (x/Re, z/Rp,
// -y/Re), which turns the WGS84 ellipsoid into the unit sphere, so scaling a
// track group about the origin lifts it radially by an altitude offset and
// Earth occlusion is a unit-sphere test. The root group is y-scaled by
// EARTH_FLATTENING like the globe (SatelliteScene's earthGroup), so in world
// space a point at 0 km sits on the drawn ellipsoid and on the launch-site
// imagery; without it a pad at 26° N floats ~4 km above the globe. Positions are stored unlifted; each frame
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
/** How long before a track's first sample its model is shown standing at that sample (pad countdown). */
const PREFLIGHT_HOLD_MS = 15 * 60_000;
const GROUND_DISC_RADIUS_M = 3000;
const GROUND_DISC_MAX_ALT_KM = 10;
const GROUND_DISC_FADE_START_KM = 5;
/** Occlusion sphere radius (scene units); a bit inside the unit sphere so surface points stay visible. */
const OCCLUDER_RADIUS = 0.9995;
/** Earth rotation rate (rad/s), for the inertial trail frame (GMST rate; precession is negligible over a flight). */
export const EARTH_ROTATION_RAD_S = 7.2921159e-5;
/** Re-base a track's line origin onto its tip when the camera is within this distance of it (Earth radii, ~320 km)… */
const REBASE_CAMERA_DISTANCE = 0.05;
/** …and the tip is farther than this from the current origin (Earth radii, ~64 km). */
const REBASE_TIP_DISTANCE = 0.01;
/** Name labels closer than this on screen (px, both axes scaled by the label size) are stacked. */
const LABEL_STACK_STEP = 1.15;
const LANDMARK_DEFAULT_COLOR = "#d7dde4";
const LANDMARK_MARKER_SIZE_PX = 7;

/**
 * Patch a fat-line material for the trail options: per-vertex age (for the
 * window fade) and the optional inertial rotation. Returns false (material
 * untouched) when the three.js shader no longer has the expected anchors.
 */
export function patchTrailLineMaterial(
  material: LineMaterial,
  uniforms: { trailNowS: { value: number }; trailInertial: { value: number }; trailOrigin: { value: THREE.Vector3 }; trailWindowS: { value: number } },
): boolean {
  const vStart = "vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );";
  const vEnd = "vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );";
  const vAspect = "float aspect = resolution.x / resolution.y;";
  const fOut = "gl_FragColor = vec4( diffuseColor.rgb, alpha );";
  const vs = material.vertexShader;
  const fs = material.fragmentShader;
  if (!vs.includes(vStart) || !vs.includes(vEnd) || !vs.includes(vAspect) || !fs.includes(fOut)) return false;
  const omega = EARTH_ROTATION_RAD_S.toExponential(8);
  material.vertexShader =
    `attribute float instanceTimeStart;
attribute float instanceTimeEnd;
uniform float trailNowS;
uniform float trailInertial;
uniform vec3 trailOrigin;
varying float vTrailAge;
vec3 trailFrame( vec3 p, float t ) {
  if ( trailInertial < 0.5 ) return p;
  float a = ${omega} * ( t - trailNowS );
  float c = cos( a );
  float s = sin( a );
  vec3 q = p + trailOrigin;
  return vec3( c * q.x + s * q.z, q.y, - s * q.x + c * q.z ) - trailOrigin;
}
` +
    vs
      .replace(vStart, "vec4 start = modelViewMatrix * vec4( trailFrame( instanceStart, instanceTimeStart ), 1.0 );")
      .replace(vEnd, "vec4 end = modelViewMatrix * vec4( trailFrame( instanceEnd, instanceTimeEnd ), 1.0 );")
      .replace(vAspect, `vTrailAge = trailNowS - ( ( position.y < 0.5 ) ? instanceTimeStart : instanceTimeEnd );
			${vAspect}`);
  material.fragmentShader =
    `uniform float trailWindowS;
varying float vTrailAge;
` +
    fs.replace(
      fOut,
      `if ( trailWindowS > 0.0 ) {
				float trailFade = 1.0 - vTrailAge / trailWindowS;
				if ( trailFade <= 0.0 ) discard;
				alpha *= min( trailFade, 1.0 );
			}
			${fOut}`,
    );
  Object.assign(material.uniforms, uniforms);
  material.needsUpdate = true;
  return true;
}

/**
 * Inertial-frame trail point (overlay-local, Earth radii): an Earth-fixed
 * point flown at `pointS` drawn at `nowS` is rotated about the polar (+Y)
 * axis by ω⊕·(pointS − nowS), so that after the overlay group's GMST(now)
 * rotation it sits where it was in inertial space. Mirrors the shader.
 */
export function inertialTrailPoint(p: THREE.Vector3, pointS: number, nowS: number, out: THREE.Vector3): THREE.Vector3 {
  const a = EARTH_ROTATION_RAD_S * (pointS - nowS);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return out.set(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
}

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

/**
 * An ad-hoc vehicle placed by the caller every frame (the selected editor
 * satellite in the 近接 camera), drawn by the same camera-relative metre pass
 * as the trajectory models. Positions are plain float64 numbers in scene
 * (world) units; the camera difference is taken before scaling to metres.
 */
export interface SatelliteVehicleState {
  /** Built-in key or GLB URL (today always "satellite-bus" = 標準バス). */
  model: string;
  /** Model centre in world scene units (Earth radii). */
  x: number;
  y: number;
  z: number;
  /** Body → world rotation (see bodyToWorldQuaternion with rotAngle = 0 for ECI). */
  bodyToWorld: { x: number; y: number; z: number; w: number };
  /** Single-axis solar-array drive angle about body +Y (0 for body-fixed panels). */
  driveAngleRad: number;
  /** Local vertical in world axes (unit), for the sky/ground fill light. */
  up: { x: number; y: number; z: number };
  /** Draw the body X/Y/Z triad (red/green/blue, labelled). */
  showAxes: boolean;
  /** Unit Sun direction in world axes for the Sun arrow, or null for none. */
  sunDirection: { x: number; y: number; z: number } | null;
}

interface SatelliteSlot {
  model: string;
  template: TrajectoryModelTemplate | null;
  object: THREE.Object3D | null;
  released: boolean;
}

/** Overlay arrows / labels drawn on top of the satellite model (no depth test). */
interface SatelliteOverlay {
  group: THREE.Group;
  axes: THREE.ArrowHelper[];
  sun: THREE.ArrowHelper;
  axisLabels: Label[];
  sunLabel: Label | null;
}

const OVERLAY_AXIS_COLORS = [0xff4d4d, 0x4dd65a, 0x4d8dff] as const;
const OVERLAY_AXIS_NAMES = ["X", "Y", "Z"] as const;
const OVERLAY_SUN_COLOR = 0xffc233;
/**
 * Axis arrow length / Sun arrow length, in model lengths (the 標準バス is
 * 10.4 m across its wings, so the Sun arrow is ≈1.5× the model's half-span).
 * Both are further capped so arrowhead and label stay inside the frame
 * (OVERLAY_FRAME_FILL of the visible half-extent, minus the label), which
 * matters on narrow portrait screens where the model nearly fills the width.
 */
const OVERLAY_AXIS_LENGTHS = 0.55;
const OVERLAY_SUN_LENGTHS = 0.75;
const OVERLAY_FRAME_FILL = 0.9;
/** Never shorter than this (model lengths), so the arrows stay readable when zoomed right in. */
const OVERLAY_MIN_LENGTHS = 0.3;

interface TrailUniforms {
  trailNowS: { value: number };
  trailInertial: { value: number };
  trailOrigin: { value: THREE.Vector3 };
}

interface TrackEntry {
  track: TrajectoryTrack;
  group: THREE.Group;
  /** Child of `group` holding both lines, positioned at `origin` (see rebaseEntry). */
  lineGroup: THREE.Group;
  /** Line origin, overlay-local scene units (unlifted). Line vertices are stored relative to it. */
  origin: THREE.Vector3;
  /** Sampled path times (ms) and scene-space positions (xyz interleaved, unlifted, absolute). */
  timesMs: Float64Array;
  scenePositions: Float64Array;
  /** Time base of the float32 per-segment times (the first sampled time), ms. */
  t0Ms: number;
  faintLine: Line2;
  faintSegments: Float32Array;
  faintBuffer: THREE.InterleavedBuffer;
  brightLine: Line2;
  /** Interleaved segment buffer of the bright line (6 floats per segment). */
  brightSegments: Float32Array;
  brightBuffer: THREE.InterleavedBuffer;
  /** Per-segment [start, end] times of the bright line, seconds after t0Ms. */
  brightTimes: Float32Array;
  brightTimeBuffer: THREE.InterleavedBuffer;
  /** Shared by both line materials. */
  uniforms: TrailUniforms;
  brightWindow: { value: number };
  /** Whether the trail shader patch is in place (window / inertial supported). */
  trailPatched: boolean;
  /** Segment whose end currently holds the live tip, or -1. */
  tipSegment: number;
  /**
   * The bright buffers were rewritten wholesale (rebaseEntry) and must be
   * uploaded in full on the next frame; otherwise update() uploads only the
   * one or two segments it touched (the path can hold ~50 000 segments).
   */
  brightFullUpload: boolean;
  marker: THREE.Points;
  events: THREE.Points | null;
  eventGeometry: THREE.BufferGeometry | null;
  eventMaterial: THREE.PointsMaterial | null;
  /** Times of the drawn events (same order as eventLabels and the event vertices). */
  eventTimesMs: number[];
  /** Events shown this frame: [eventLo, eventHi) (all unless the trail hides future / old ones). */
  eventLo: number;
  eventHi: number;
  eventLabels: Label[];
  nameLabel: Label | null;
  /** Set by renderVehicles when the model is drawn large enough to replace the dot. */
  hideMarker: boolean;
  /** Whether the marker / name label is shown this frame (inside the span, or held at its end). */
  inSpan: boolean;
  vehicle: VehicleSlot | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  usesSprite: boolean;
}

interface LandmarkEntry {
  landmark: TrajectoryLandmark;
  /** Overlay-local position (unlifted). */
  position: THREE.Vector3;
  /** Label anchor: the top of the model, if any. */
  labelPosition: THREE.Vector3;
  marker: THREE.Points;
  markerMaterial: THREE.PointsMaterial;
  label: Label | null;
  /** Body → ECEF attitude (upright). */
  attitude: BodyQuaternion;
  vehicle: VehicleSlot | null;
  /** Inside its time window (update). */
  active: boolean;
  /** Camera within maxDistanceKm (renderVehicles, applied next frame). */
  near: boolean;
  hideMarker: boolean;
}

const scratchEcefPos = new Float64Array(3);
const scratchEcefVel = new Float64Array(3);
const scratchTipEcef = new Float64Array(3);

/** Queue segment k (stride floats each) of an interleaved buffer for upload, or the whole buffer when `full`. */
function markSegment(buffer: THREE.InterleavedBuffer, k: number, stride: number, full: boolean) {
  if (!full) buffer.addUpdateRange(k * stride, stride);
  buffer.needsUpdate = true;
}

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

  // Ad-hoc satellite vehicle (see setSatelliteVehicle).
  private satelliteState: SatelliteVehicleState | null = null;
  private satelliteSlot: SatelliteSlot | null = null;
  private satelliteOverlay: SatelliteOverlay | null = null;
  private satelliteCoversMarker = false;
  private readonly tmpQuat = new THREE.Quaternion();

  // Landmarks (see setLandmarks).
  private readonly landmarkGroup = new THREE.Group();
  private landmarks: LandmarkEntry[] = [];
  private landmarkList: readonly TrajectoryLandmark[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "TrajectoryTracks";
    // Same flattening as the globe group: overlay-local (unit sphere) → world (ECEF / Re).
    this.root.scale.set(1, EARTH_FLATTENING, 1);
    this.scene.add(this.root);
    this.landmarkGroup.name = "TrajectoryLandmarks";
    this.root.add(this.landmarkGroup);
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

  /** Overlay root (Earth-fixed, GMST-rotated): trails, markers, labels and landmark dots. */
  getRootObject(): THREE.Object3D {
    return this.root;
  }

  /**
   * Replace the landmarks (fixed points with a dot, a label and an optional
   * upright model). No-op for the same array.
   */
  setLandmarks(landmarks: readonly TrajectoryLandmark[]): void {
    if (landmarks === this.landmarkList) return;
    this.landmarkList = landmarks;
    this.landmarks.forEach((l) => this.disposeLandmark(l));
    this.landmarks = [];
    for (const landmark of landmarks) {
      const entry = this.buildLandmark(landmark);
      if (entry) this.landmarks.push(entry);
    }
    if (Number.isFinite(this.lastSimMs)) this.updateLandmarks(this.lastSimMs);
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
    this.updateLandmarks(simMs);
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
   * True position (no drawing lift) and velocity (per second) in the
   * Earth-fixed, world-aligned frame before the GMST rotation: ECEF / Re as
   * (x, z, −y), i.e. the frame of the drawn (flattened) globe, not the
   * unit-sphere overlay-local frame of the trail.
   * False for an unknown id or outside the span. Allocation-free.
   */
  localStateAt(id: string, timeMs: number, outPos: THREE.Vector3, outVel: THREE.Vector3): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!trajectoryEcefAt(entry.track, timeMs, scratchEcefPos, scratchEcefVel)) return false;
    const p = scratchEcefPos;
    const v = scratchEcefVel;
    outPos.set(p[0] / EARTH_RADIUS_EQUATOR_KM, p[2] / EARTH_RADIUS_EQUATOR_KM, -p[1] / EARTH_RADIUS_EQUATOR_KM);
    outVel.set(v[0] / EARTH_RADIUS_EQUATOR_KM, v[2] / EARTH_RADIUS_EQUATOR_KM, -v[1] / EARTH_RADIUS_EQUATOR_KM);
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
   * Place (or with null, hide) the ad-hoc satellite vehicle for the next
   * {@link renderVehicles} call. Call every frame while it should be drawn.
   * The model is loaded once and kept (hidden) until the model string
   * changes or the renderer is disposed.
   */
  setSatelliteVehicle(state: SatelliteVehicleState | null): void {
    this.satelliteState = state;
    if (!state) return;
    if (this.satelliteSlot?.model === state.model) return;
    if (this.satelliteSlot) this.releaseSatelliteSlot(this.satelliteSlot);
    const slot: SatelliteSlot = { model: state.model, template: null, object: null, released: false };
    this.satelliteSlot = slot;
    acquireTrajectoryModel(state.model).then(
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
        console.warn(`Satellite model "${state.model}" could not be loaded.`, error);
      },
    );
  }

  /** Whether the satellite model was drawn large enough (last frame) to replace its marker dot. */
  satelliteVehicleCoversMarker(): boolean {
    return this.satelliteState !== null && this.satelliteCoversMarker;
  }

  /** Length of the satellite model in metres (loaded, else registry, else 50). */
  satelliteVehicleLengthM(model: string): number {
    const slot = this.satelliteSlot;
    if (slot?.model === model && slot.template) return slot.template.lengthM;
    return trajectoryModelLengthM(model) ?? DEFAULT_VEHICLE_LENGTH_M;
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
    // Camera in the overlay-local frame (inverse GMST rotation, then undo the
    // root's flattening so the Earth is the unit sphere there).
    const camLocal = this.tmpCamLocal.set(camX * cosR - camZ * sinR, camY / EARTH_FLATTENING, camX * sinR + camZ * cosR);
    this.updateLabelOcclusion(camLocal);
    this.updateTrailLift(camLocal, simDate.getTime());
    this.updateLabelStacking(camera, viewportH);

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
      // Before lift-off the vehicle stands on the pad: hold the first sample
      // for up to PREFLIGHT_HOLD_MS so a countdown shows the rocket. After the
      // end it is held at the last sample for track.holdEndMs (default 0).
      const firstMs = entry.track.samples[0].timeMs;
      const lastMs = entry.track.samples[entry.track.samples.length - 1].timeMs;
      const holdEndMs = Math.max(0, entry.track.holdEndMs ?? 0);
      const drawMs =
        simMs < firstMs && firstMs - simMs <= PREFLIGHT_HOLD_MS
          ? firstMs
          : simMs > lastMs && simMs - lastMs <= holdEndMs
            ? lastMs
            : simMs;
      if (!trajectoryEcefAt(entry.track, drawMs, scratchEcefPos)) continue;
      const p = scratchEcefPos;
      const lx = p[0] / EARTH_RADIUS_EQUATOR_KM;
      const ly = p[2] / EARTH_RADIUS_POLAR_KM;
      const lz = -p[1] / EARTH_RADIUS_EQUATOR_KM;
      if (this.occludedByEarth(camLocal, lx, ly, lz)) continue;
      // float64 subtraction first, then metres.
      const dx = (lx * cosR + lz * sinR - camX) * SCENE_UNIT_M;
      const dy = (ly * EARTH_FLATTENING - camY) * SCENE_UNIT_M;
      const dz = (-lx * sinR + lz * cosR - camZ) * SCENE_UNIT_M;
      const dist = Math.hypot(dx, dy, dz);
      const lengthM = slot.template.lengthM;
      const px = (lengthM * pxPerRad) / Math.max(dist, 1e-3);
      if (px < MODEL_MIN_PX) continue;

      const state = trajectoryStateAt(entry.track, drawMs);
      if (!state) continue;
      const q = trajectoryAttitudeAt(entry.track, drawMs, state, this.bodyQuat);
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
          (gy * EARTH_FLATTENING - camY) * SCENE_UNIT_M,
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
    // Landmarks: static upright models, same camera-relative placement.
    for (const lm of this.landmarks) {
      lm.hideMarker = false;
      const dist0 = lm.position.distanceTo(camLocal);
      const maxKm = lm.landmark.maxDistanceKm;
      lm.near = maxKm === undefined || dist0 * EARTH_RADIUS_EQUATOR_KM <= maxKm;
      const slot = lm.vehicle;
      if (!slot || !slot.object || !slot.template) continue;
      const object = slot.object;
      object.visible = false;
      if (!lm.active) continue;
      const { x: lx, y: ly, z: lz } = lm.position;
      if (this.occludedByEarth(camLocal, lx, ly, lz)) continue;
      const dx = (lx * cosR + lz * sinR - camX) * SCENE_UNIT_M;
      const dy = (ly * EARTH_FLATTENING - camY) * SCENE_UNIT_M;
      const dz = (-lx * sinR + lz * cosR - camZ) * SCENE_UNIT_M;
      const dist = Math.hypot(dx, dy, dz);
      const lengthM = slot.template.lengthM;
      const px = (lengthM * pxPerRad) / Math.max(dist, 1e-3);
      if (px < MODEL_MIN_PX) continue;
      lm.hideMarker = px >= MODEL_HIDE_MARKER_PX;
      bodyToWorldQuaternion(lm.attitude, rotAngle, object.quaternion);
      const centre = this.tmpCentre.set(dx, dy, dz);
      if (slot.template.anchor === "base") {
        centre.addScaledVector(this.tmpPivot.set(1, 0, 0).applyQuaternion(object.quaternion), lengthM / 2);
      }
      object.position.copy(centre).sub(this.tmpPivot.copy(slot.template.pivotBody).applyQuaternion(object.quaternion));
      object.visible = true;
      drawn += 1;
      // The model reaches ~lengthM sideways too (tower arms): bracket generously.
      nearest = Math.min(nearest, dist - lengthM);
      farthest = Math.max(farthest, dist + lengthM);
    }
    // Ad-hoc satellite (近接 camera): same camera-relative placement.
    this.satelliteCoversMarker = false;
    const sat = this.satelliteState;
    const satSlot = this.satelliteSlot;
    if (satSlot?.object) satSlot.object.visible = false;
    if (this.satelliteOverlay) this.satelliteOverlay.group.visible = false;
    if (sat && satSlot?.object && satSlot.template && satSlot.model === sat.model
      && !this.occludedByEarth(this.tmp.set(camX, camY, camZ), sat.x, sat.y, sat.z)) {
      const dx = (sat.x - camX) * SCENE_UNIT_M;
      const dy = (sat.y - camY) * SCENE_UNIT_M;
      const dz = (sat.z - camZ) * SCENE_UNIT_M;
      const dist = Math.hypot(dx, dy, dz);
      const lengthM = satSlot.template.lengthM;
      const px = (lengthM * pxPerRad) / Math.max(dist, 1e-3);
      if (px >= MODEL_MIN_PX) {
        const object = satSlot.object;
        const q = this.tmpQuat.set(sat.bodyToWorld.x, sat.bodyToWorld.y, sat.bodyToWorld.z, sat.bodyToWorld.w).normalize();
        object.quaternion.copy(q);
        object.position.set(dx, dy, dz).sub(this.tmpPivot.copy(satSlot.template.pivotBody).applyQuaternion(q));
        setSolarArrayDrive(object, Number.isFinite(sat.driveAngleRad) ? sat.driveAngleRad : 0);
        object.visible = true;
        this.satelliteCoversMarker = px >= MODEL_HIDE_MARKER_PX;
        drawn += 1;
        if (dist - lengthM < nearest) {
          nearest = dist - lengthM;
          this.fillLight.position.set(sat.up.x, sat.up.y, sat.up.z);
          nearestUpSet = true;
        }
        farthest = Math.max(farthest, dist + lengthM);
        if (sat.showAxes || sat.sunDirection) {
          // Visible half-extent at the model's distance (the narrower of width / height).
          const frameHalfM = dist / Math.max(camera.projectionMatrix.elements[0], p5);
          this.placeSatelliteOverlay(sat, q, dx, dy, dz, lengthM, dist, frameHalfM);
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
    if (this.satelliteSlot) this.releaseSatelliteSlot(this.satelliteSlot);
    this.satelliteSlot = null;
    this.satelliteState = null;
    this.disposeSatelliteOverlay();
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.tracks = [];
    this.landmarks.forEach((l) => this.disposeLandmark(l));
    this.landmarks = [];
    this.landmarkList = [];
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
    const p = entry.scenePositions;
    const o = entry.origin;

    // Trail options (display only, read live from the track).
    const trail = entry.track.trail;
    const inertial = entry.trailPatched && trail?.frame === "inertial";
    const windowMs = entry.trailPatched && trail?.windowMs !== undefined && trail.windowMs > 0 ? trail.windowMs : 0;
    const future = trail?.future !== false;
    entry.faintLine.visible = future;
    entry.uniforms.trailNowS.value = (simMs - entry.t0Ms) / 1000;
    entry.uniforms.trailInertial.value = inertial ? 1 : 0;
    entry.brightWindow.value = windowMs / 1000;
    this.updateEvents(entry, simMs, inertial, future, windowMs);

    // Upload only the touched segments, unless a rebase rewrote everything.
    const full = entry.brightFullUpload;
    if (full) {
      entry.brightFullUpload = false;
      entry.brightBuffer.clearUpdateRanges();
      entry.brightTimeBuffer.clearUpdateRanges();
      entry.brightBuffer.needsUpdate = true;
      entry.brightTimeBuffer.needsUpdate = true;
    }
    // Restore the segment end overwritten by the previous live tip.
    if (entry.tipSegment >= 0) {
      const k = entry.tipSegment;
      segments[k * 6 + 3] = p[(k + 1) * 3] - o.x;
      segments[k * 6 + 4] = p[(k + 1) * 3 + 1] - o.y;
      segments[k * 6 + 5] = p[(k + 1) * 3 + 2] - o.z;
      entry.brightTimes[k * 2 + 1] = (times[k + 1] - entry.t0Ms) / 1000;
      entry.tipSegment = -1;
      markSegment(entry.brightBuffer, k, 6, full);
      markSegment(entry.brightTimeBuffer, k, 2, full);
    }

    if (simMs < times[0] || simMs >= times[n - 1]) {
      const finished = simMs >= times[n - 1];
      geom.instanceCount = finished ? n - 1 : 0;
      entry.brightLine.visible = finished;
      // Held at the end point (track.holdEndMs): marker and label stay.
      const held = finished && simMs - times[n - 1] <= Math.max(0, entry.track.holdEndMs ?? 0);
      entry.inSpan = held;
      if (held) {
        const last = this.tmp.set(p[(n - 1) * 3], p[(n - 1) * 3 + 1], p[(n - 1) * 3 + 2]);
        entry.marker.position.copy(last);
        entry.marker.visible = !entry.hideMarker;
        if (entry.nameLabel) {
          entry.nameLabel.sprite.position.copy(last);
          entry.nameLabel.sprite.visible = !entry.nameLabel.occluded;
        }
        return;
      }
      entry.marker.visible = false;
      if (entry.nameLabel) entry.nameLabel.sprite.visible = false;
      return;
    }

    const k = this.segmentIndex(times, simMs);
    const tip = this.interpolate(entry, k, simMs, this.tmp);
    segments[k * 6 + 3] = tip.x - o.x;
    segments[k * 6 + 4] = tip.y - o.y;
    segments[k * 6 + 5] = tip.z - o.z;
    entry.brightTimes[k * 2 + 1] = (simMs - entry.t0Ms) / 1000;
    entry.tipSegment = k;
    markSegment(entry.brightBuffer, k, 6, full);
    markSegment(entry.brightTimeBuffer, k, 2, full);
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

  /**
   * Event dots and labels shown this frame: none in the inertial frame
   * (they are Earth-fixed points), only past ones without the future path,
   * and only those inside the trail window when one is set.
   */
  private updateEvents(entry: TrackEntry, simMs: number, inertial: boolean, future: boolean, windowMs: number) {
    const times = entry.eventTimesMs;
    let lo = 0;
    let hi = times.length;
    if (inertial) hi = 0;
    else {
      if (!future) while (hi > 0 && times[hi - 1] > simMs) hi -= 1;
      if (windowMs > 0) while (lo < hi && times[lo] < simMs - windowMs) lo += 1;
    }
    if (lo === entry.eventLo && hi === entry.eventHi) return;
    entry.eventLo = lo;
    entry.eventHi = hi;
    if (entry.events && entry.eventGeometry) {
      entry.eventGeometry.setDrawRange(lo, Math.max(0, hi - lo));
      entry.events.visible = hi > lo;
    }
    this.applyFocus(entry);
  }

  private eventLabelShown(entry: TrackEntry, index: number, label: Label): boolean {
    return entry.track.id === this.focusedId && !label.occluded && index >= entry.eventLo && index < entry.eventHi;
  }

  /** Landmark dots and labels: inside their time window and near enough to the camera. */
  private updateLandmarks(simMs: number) {
    for (const lm of this.landmarks) {
      const { fromMs, untilMs } = lm.landmark;
      lm.active = (fromMs === undefined || simMs >= fromMs) && (untilMs === undefined || simMs <= untilMs);
      const show = lm.active && lm.near;
      lm.marker.visible = show && !lm.hideMarker;
      if (lm.label) lm.label.sprite.visible = show && !lm.label.occluded;
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

  /**
   * Position on the path at `t` (overlay-local, unlifted): the track's cubic
   * Hermite state, the same curve the path points were sampled from and the
   * model is drawn on, so the live tip never cuts a corner between points.
   * Falls back to the chord of segment k.
   */
  private interpolate(entry: TrackEntry, k: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    if (trajectoryEcefAt(entry.track, t, scratchTipEcef)) {
      return ecefToTrajectoryScene(scratchTipEcef[0], scratchTipEcef[1], scratchTipEcef[2], out);
    }
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
      entry.eventLabels.forEach((label, i) => {
        const pos = label.sprite.position;
        label.occluded = this.occludedByEarth(camLocal, pos.x, pos.y, pos.z);
        label.sprite.visible = this.eventLabelShown(entry, i, label);
      });
    }
    for (const lm of this.landmarks) {
      if (!lm.label) continue;
      const pos = lm.labelPosition;
      lm.label.occluded = this.occludedByEarth(camLocal, pos.x, pos.y, pos.z);
    }
  }

  /**
   * Keep name labels (tracks, then landmarks) from overprinting: a label
   * whose screen box overlaps an earlier visible one is moved down by one
   * label height per overlap (e.g. booster and ship during the stacked
   * ascent). Uses this frame's matrices; takes effect next frame.
   */
  private updateLabelStacking(camera: THREE.PerspectiveCamera, viewportH: number) {
    const placed = this.stackPlaced;
    placed.length = 0;
    const halfH = viewportH / 2;
    const aspect = camera.aspect || 1;
    const stack = (label: Label | null, shown: boolean) => {
      if (!label) return;
      let slot = 0;
      if (shown) {
        const v = this.tmp.setFromMatrixPosition(label.sprite.matrixWorld).project(camera);
        if (v.z < 1) {
          const x = v.x * halfH * aspect;
          const y = v.y * halfH;
          const step = label.heightPx * LABEL_STACK_STEP;
          for (let guard = 0; guard <= placed.length; guard++) {
            const yy = y - slot * step;
            let hit = false;
            for (const q of placed) {
              if (Math.abs(q.x - x) < Math.max(q.w, label.widthPx) && Math.abs(q.y - yy) < step) {
                hit = true;
                break;
              }
            }
            if (!hit) break;
            slot += 1;
          }
          placed.push({ x, y: y - slot * step, w: label.widthPx });
        }
      }
      const cy = 0.5 + slot * LABEL_STACK_STEP;
      if (label.sprite.center.y !== cy) label.sprite.center.y = cy;
    };
    for (const entry of this.entries.values()) stack(entry.nameLabel, entry.track.visible && entry.inSpan && !!entry.nameLabel?.sprite.visible);
    for (const lm of this.landmarks) stack(lm.label, !!lm.label?.sprite.visible);
  }

  private readonly stackPlaced: { x: number; y: number; w: number }[] = [];

  /**
   * Radial drawing lift, applied as a group scale about the Earth's centre
   * (takes effect next frame): proportional to the camera's distance to the
   * NEAREST visible track tip, capped at TRAJECTORY_SURFACE_OFFSET_MAX, and
   * the same for every track and the landmarks — a per-track lift moved the
   * other track's path by up to ~0.6 km as the camera followed one vehicle.
   * Also re-bases a track's line origin onto its tip when the camera is close
   * (float32 precision, see rebaseEntry).
   */
  private updateTrailLift(camLocal: THREE.Vector3, simMs: number) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const entry of this.entries.values()) {
      if (!entry.group.visible) continue;
      const times = entry.timesMs;
      const n = times.length;
      const t = Math.min(Math.max(simMs, times[0]), times[n - 1]);
      const tip = this.interpolate(entry, this.segmentIndex(times, t), t, this.tmpLift);
      const d = tip.distanceTo(camLocal);
      nearest = Math.min(nearest, d);
      if (d < REBASE_CAMERA_DISTANCE && tip.distanceTo(entry.origin) > REBASE_TIP_DISTANCE) this.rebaseEntry(entry, tip);
    }
    const lift = Number.isFinite(nearest)
      ? Math.min(TRAJECTORY_SURFACE_OFFSET_MAX, TRAJECTORY_SURFACE_OFFSET_PER_DISTANCE * nearest)
      : TRAJECTORY_SURFACE_OFFSET_MAX;
    for (const entry of this.entries.values()) entry.group.scale.setScalar(1 + lift);
    this.landmarkGroup.scale.setScalar(1 + lift);
  }

  /**
   * Move the line origin to `origin` and rewrite both line buffers relative
   * to it (the live tip is rewritten by the next update()). Float32 vertices
   * near 1 Earth radius only resolve ~0.4 m, which shimmers at follow-camera
   * range; relative to a nearby origin they resolve millimetres.
   */
  private rebaseEntry(entry: TrackEntry, origin: THREE.Vector3) {
    entry.origin.copy(origin);
    entry.lineGroup.position.copy(origin);
    entry.uniforms.trailOrigin.value.copy(origin);
    this.writeSegments(entry.scenePositions, origin, entry.faintSegments);
    this.writeSegments(entry.scenePositions, origin, entry.brightSegments);
    entry.faintBuffer.clearUpdateRanges();
    entry.faintBuffer.needsUpdate = true;
    entry.brightBuffer.clearUpdateRanges();
    entry.brightBuffer.needsUpdate = true;
    // The tip segment now holds its true end again; restore its time too.
    if (entry.tipSegment >= 0) {
      const k = entry.tipSegment;
      entry.brightTimes[k * 2 + 1] = (entry.timesMs[k + 1] - entry.t0Ms) / 1000;
      entry.tipSegment = -1;
    }
    entry.brightTimeBuffer.clearUpdateRanges();
    entry.brightTimeBuffer.needsUpdate = true;
    entry.brightFullUpload = true;
  }

  /** Interleaved [start xyz, end xyz] segments of a polyline, relative to `origin`. */
  private writeSegments(positions: Float64Array, origin: THREE.Vector3, out: Float32Array) {
    const segments = positions.length / 3 - 1;
    for (let i = 0; i < segments; i++) {
      const a = i * 3;
      const j = i * 6;
      out[j] = positions[a] - origin.x;
      out[j + 1] = positions[a + 1] - origin.y;
      out[j + 2] = positions[a + 2] - origin.z;
      out[j + 3] = positions[a + 3] - origin.x;
      out[j + 4] = positions[a + 4] - origin.y;
      out[j + 5] = positions[a + 5] - origin.z;
    }
  }

  private updateLabelScale(scalePerPx: number) {
    if (Math.abs(scalePerPx - this.labelScalePerPx) <= 1e-6 * this.labelScalePerPx) return;
    this.labelScalePerPx = scalePerPx;
    for (const entry of this.entries.values()) {
      if (entry.nameLabel) this.scaleLabel(entry.nameLabel);
      entry.eventLabels.forEach((l) => this.scaleLabel(l));
    }
    for (const lm of this.landmarks) if (lm.label) this.scaleLabel(lm.label);
  }

  private scaleLabel(label: Label) {
    label.sprite.scale.set(label.widthPx * this.labelScalePerPx, label.heightPx * this.labelScalePerPx, 1);
  }

  private applyFocus(entry: TrackEntry) {
    const focused = entry.track.id === this.focusedId;
    entry.eventLabels.forEach((label, i) => {
      label.sprite.visible = this.eventLabelShown(entry, i, label);
    });
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

  // --- satellite vehicle ---------------------------------------------------------

  private releaseSatelliteSlot(slot: SatelliteSlot) {
    if (slot.released) return;
    slot.released = true;
    if (slot.object) this.vehicleScene.remove(slot.object);
    slot.object = null;
    releaseTrajectoryModel(slot.model);
  }

  /** Axes triad and Sun arrow at the satellite centre (camera-relative metres), drawn over the model. */
  private placeSatelliteOverlay(
    sat: SatelliteVehicleState,
    q: THREE.Quaternion,
    dx: number,
    dy: number,
    dz: number,
    lengthM: number,
    dist: number,
    frameHalfM: number,
  ) {
    const overlay = this.ensureSatelliteOverlay();
    overlay.group.visible = true;
    overlay.group.position.set(dx, dy, dz);
    // Room for an arrow plus its label (metres per pixel at the model's distance).
    const mPerPx = dist * this.labelScalePerPx;
    const fit = (lengths: number, label: Label | null | undefined) =>
      Math.max(
        OVERLAY_MIN_LENGTHS * lengthM,
        Math.min(lengths * lengthM, OVERLAY_FRAME_FILL * frameHalfM - ((label?.widthPx ?? 0) + 4) * mPerPx),
      );
    const axisLength = fit(OVERLAY_AXIS_LENGTHS, overlay.axisLabels[0]);
    for (let i = 0; i < 3; i += 1) {
      const arrow = overlay.axes[i];
      arrow.visible = sat.showAxes;
      const label = overlay.axisLabels[i];
      if (label) label.sprite.visible = sat.showAxes;
      if (!sat.showAxes) continue;
      const dir = this.tmp.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(q);
      arrow.setDirection(dir);
      arrow.setLength(axisLength, 0.18 * axisLength, 0.08 * axisLength);
      if (label) {
        label.sprite.position.copy(dir).multiplyScalar(axisLength * 1.04);
        this.scaleLabel(label);
      }
    }
    const sun = sat.sunDirection;
    overlay.sun.visible = sun !== null;
    if (overlay.sunLabel) overlay.sunLabel.sprite.visible = sun !== null;
    if (sun) {
      const sunLength = fit(OVERLAY_SUN_LENGTHS, overlay.sunLabel);
      const dir = this.tmp.set(sun.x, sun.y, sun.z).normalize();
      overlay.sun.setDirection(dir);
      overlay.sun.setLength(sunLength, 0.16 * sunLength, 0.07 * sunLength);
      if (overlay.sunLabel) {
        overlay.sunLabel.sprite.position.copy(dir).multiplyScalar(sunLength * 1.04);
        this.scaleLabel(overlay.sunLabel);
      }
    }
  }

  private ensureSatelliteOverlay(): SatelliteOverlay {
    if (this.satelliteOverlay) return this.satelliteOverlay;
    const group = new THREE.Group();
    group.name = "SatelliteAttitudeOverlay";
    const onTop = (arrow: THREE.ArrowHelper) => {
      for (const material of [arrow.line.material, arrow.cone.material] as THREE.Material[]) {
        material.depthTest = false;
        material.depthWrite = false;
      }
      arrow.line.renderOrder = 10;
      arrow.cone.renderOrder = 10;
      return arrow;
    };
    const origin = new THREE.Vector3();
    const axes = OVERLAY_AXIS_COLORS.map((color) => onTop(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 1, color)));
    const sun = onTop(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 1, OVERLAY_SUN_COLOR));
    const toCss = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;
    const axisLabels = OVERLAY_AXIS_NAMES.map((name, i) => createLabel(name, toCss(OVERLAY_AXIS_COLORS[i]))).filter(
      (l): l is Label => l !== null,
    );
    const sunLabel = createLabel("太陽", toCss(OVERLAY_SUN_COLOR));
    group.add(...axes, sun);
    for (const label of [...axisLabels, sunLabel]) {
      if (!label) continue;
      label.sprite.renderOrder = 11;
      group.add(label.sprite);
    }
    this.vehicleScene.add(group);
    this.satelliteOverlay = { group, axes, sun, axisLabels: axisLabels.length === 3 ? axisLabels : [], sunLabel };
    return this.satelliteOverlay;
  }

  private disposeSatelliteOverlay() {
    const overlay = this.satelliteOverlay;
    if (!overlay) return;
    this.satelliteOverlay = null;
    overlay.group.removeFromParent();
    for (const arrow of [...overlay.axes, overlay.sun]) arrow.dispose();
    overlay.axisLabels.forEach(disposeLabel);
    disposeLabel(overlay.sunLabel);
  }

  // --- build / dispose ---------------------------------------------------------

  private buildEntry(track: TrajectoryTrack): TrackEntry | null {
    const { timesMs, positions } = sampleTrajectoryPath(track);
    const n = timesMs.length;
    if (n < 2) return null;

    const scenePositions = new Float64Array(n * 3);
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

    // Lines live in a child group positioned at `origin` (the first point;
    // re-based near the camera later), with vertices stored relative to it.
    const origin = new THREE.Vector3(scenePositions[0], scenePositions[1], scenePositions[2]);
    const lineGroup = new THREE.Group();
    lineGroup.position.copy(origin);
    group.add(lineGroup);
    const relative = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      relative[i] = scenePositions[i] - origin.x;
      relative[i + 1] = scenePositions[i + 1] - origin.y;
      relative[i + 2] = scenePositions[i + 2] - origin.z;
    }
    // Per-segment [start, end] times in seconds after the first sample.
    const t0Ms = timesMs[0];
    const segmentTimes = new Float32Array((n - 1) * 2);
    for (let i = 0; i < n - 1; i++) {
      segmentTimes[i * 2] = (timesMs[i] - t0Ms) / 1000;
      segmentTimes[i * 2 + 1] = (timesMs[i + 1] - t0Ms) / 1000;
    }
    const uniforms: TrailUniforms = {
      trailNowS: { value: 0 },
      trailInertial: { value: 0 },
      trailOrigin: { value: origin.clone() },
    };
    const brightWindow = { value: 0 };
    const addTimes = (geometry: LineGeometry, times: Float32Array) => {
      const buffer = new THREE.InstancedInterleavedBuffer(times, 2, 1);
      geometry.setAttribute("instanceTimeStart", new THREE.InterleavedBufferAttribute(buffer, 1, 0));
      geometry.setAttribute("instanceTimeEnd", new THREE.InterleavedBufferAttribute(buffer, 1, 1));
      return buffer;
    };

    // Faint full path. depthWrite off on both lines so the coplanar bright
    // line (drawn later via renderOrder) does not z-fight with it.
    const faintGeometry = new LineGeometry();
    faintGeometry.setPositions(relative);
    const faintBuffer = (faintGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
    faintBuffer.setUsage(THREE.DynamicDrawUsage);
    addTimes(faintGeometry, segmentTimes);
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
    lineGroup.add(faintLine);

    // Bright traversed path: same segments, drawn up to the live tip.
    const brightGeometry = new LineGeometry();
    brightGeometry.setPositions(relative);
    const startAttr = brightGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    const brightBuffer = startAttr.data;
    brightBuffer.setUsage(THREE.DynamicDrawUsage);
    const brightSegments = brightBuffer.array as Float32Array;
    const brightTimes = segmentTimes.slice();
    const brightTimeBuffer = addTimes(brightGeometry, brightTimes);
    brightTimeBuffer.setUsage(THREE.DynamicDrawUsage);
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
    const trailPatched =
      // The faint path shares the window: its flown part older than the
      // window is cut too (the future part has a negative age and stays).
      patchTrailLineMaterial(faintMaterial, { ...uniforms, trailWindowS: brightWindow }) &&
      patchTrailLineMaterial(brightMaterial, { ...uniforms, trailWindowS: brightWindow });
    if (!trailPatched) console.warn("Trajectory trail options unavailable: unexpected fat-line shader.");
    const brightLine = new Line2(brightGeometry, brightMaterial);
    brightLine.frustumCulled = false;
    brightLine.renderOrder = 2;
    brightLine.visible = false;
    lineGroup.add(brightLine);

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
    let eventGeometry: THREE.BufferGeometry | null = null;
    let eventMaterial: THREE.PointsMaterial | null = null;
    const eventLabels: Label[] = [];
    const eventTimesMs: number[] = [];
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
        eventTimesMs.push(ev.timeMs);
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
        eventGeometry = new THREE.BufferGeometry();
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
      lineGroup,
      origin,
      timesMs,
      scenePositions,
      t0Ms,
      faintLine,
      faintSegments: faintBuffer.array as Float32Array,
      faintBuffer,
      brightLine,
      brightSegments,
      brightBuffer,
      brightTimes,
      brightTimeBuffer,
      uniforms,
      brightWindow,
      trailPatched,
      tipSegment: -1,
      brightFullUpload: false,
      marker,
      events,
      eventGeometry,
      eventMaterial,
      eventTimesMs,
      eventLo: 0,
      eventHi: eventTimesMs.length,
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

  // --- landmarks -------------------------------------------------------------

  private buildLandmark(landmark: TrajectoryLandmark): LandmarkEntry | null {
    const altKm = landmark.altKm ?? 0;
    if (![landmark.latDeg, landmark.lonDeg, altKm].every(Number.isFinite)) return null;
    const e = llaToEcef(landmark.latDeg, landmark.lonDeg, altKm);
    const position = ecefToTrajectoryScene(e.x, e.y, e.z, new THREE.Vector3());
    const topKm = altKm + (landmark.model ? (trajectoryModelLengthM(landmark.model) ?? 0) / 1000 : 0);
    const t = llaToEcef(landmark.latDeg, landmark.lonDeg, topKm);
    const labelPosition = ecefToTrajectoryScene(t.x, t.y, t.z, new THREE.Vector3());
    const color = new THREE.Color(landmark.color ?? LANDMARK_DEFAULT_COLOR);
    const sprite = acquireRoundSprite();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const markerMaterial = new THREE.PointsMaterial({
      color,
      size: LANDMARK_MARKER_SIZE_PX,
      sizeAttenuation: false,
      map: sprite,
      transparent: true,
      alphaTest: 0.5,
    });
    const marker = new THREE.Points(geometry, markerMaterial);
    marker.frustumCulled = false;
    marker.renderOrder = 3;
    marker.position.copy(position);
    marker.visible = false;
    marker.userData.usesSprite = sprite !== null;
    this.landmarkGroup.add(marker);
    const label = landmark.label ? createLabel(landmark.label, `#${color.getHexString()}`) : null;
    if (label) {
      label.sprite.position.copy(labelPosition);
      label.sprite.visible = false;
      this.scaleLabel(label);
      this.landmarkGroup.add(label.sprite);
    }
    const entry: LandmarkEntry = {
      landmark,
      position,
      labelPosition,
      marker,
      markerMaterial,
      label,
      attitude: uprightBodyQuaternion(landmark.latDeg, landmark.lonDeg, landmark.headingDeg ?? 0),
      vehicle: null,
      active: true,
      near: false,
      hideMarker: false,
    };
    if (landmark.model) {
      const slot = this.createVehicleSlot(landmark.model);
      entry.vehicle = slot;
      const model = landmark.model;
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
          console.warn(`Landmark model "${model}" could not be loaded; showing the marker only.`, error);
        },
      );
    }
    return entry;
  }

  private disposeLandmark(entry: LandmarkEntry) {
    entry.marker.removeFromParent();
    entry.marker.geometry.dispose();
    entry.markerMaterial.dispose();
    if (entry.marker.userData.usesSprite) releaseRoundSprite();
    disposeLabel(entry.label);
    if (entry.vehicle) {
      this.disposeVehicle(entry.vehicle);
      entry.vehicle = null;
    }
  }
}
