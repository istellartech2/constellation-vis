/**
 * Three.js renderer for tabulated trajectory tracks (see ./types.ts).
 *
 * Every track is Earth-fixed (ECEF km), so all geometry lives in one group
 * rotated by GMST each frame, exactly like the KML layer. Per visible track:
 *   - the full path, faint;
 *   - the traversed part (first sample → current sim time) bright, ending in
 *     a live tip interpolated between path samples;
 *   - a fixed-pixel marker at the current position (hidden outside the span);
 *   - small fixed-pixel markers at each event.
 *
 * `update()` is allocation-free: a binary search on the sampled times, then
 * the bright line's instance count and one segment end are rewritten.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { TrajectoryTrack } from "./types";
import { sampleTrajectoryPath } from "./interpolate";

const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

// The scene's ECEF mapping (x/Re, z/Rp, -y/Re) turns the WGS84 ellipsoid into
// the unit sphere, so a radial lift in scene units is an altitude offset.
// Launch tracks start at altitude ~0 and would z-fight with the globe; lift
// them by ~5 km (above the 128-segment sphere's chord sag of ~0.0003) — less
// than KML's 0.002 so the low-altitude part of an ascent is not distorted.
const TRAJECTORY_SURFACE_OFFSET = 0.0008;

const FAINT_LINE_OPACITY = 0.28;
const LINE_WIDTH_PX = 2;
const MARKER_SIZE_PX = 9;
const EVENT_SIZE_PX = 6;

/** ECEF km → scene local (Earth-fixed group) coordinates, with the radial lift. */
export function ecefToTrajectoryScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(x / EARTH_RADIUS_EQUATOR_KM, z / EARTH_RADIUS_POLAR_KM, -y / EARTH_RADIUS_EQUATOR_KM);
  const len = out.length();
  if (len > 0) out.multiplyScalar((len + TRAJECTORY_SURFACE_OFFSET) / len);
  return out;
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

interface TrackEntry {
  track: TrajectoryTrack;
  group: THREE.Group;
  /** Sampled path times (ms) and scene-space positions (xyz interleaved, lifted). */
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
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  usesSprite: boolean;
}

export class TrajectoryRenderer {
  private readonly scene: THREE.Scene;
  private readonly root: THREE.Group;
  private readonly entries = new Map<string, TrackEntry>();
  private tracks: TrajectoryTrack[] = [];
  private lineMaterials = new Set<LineMaterial>();
  private readonly resolution = new THREE.Vector2(
    typeof window !== "undefined" ? window.innerWidth : 1,
    typeof window !== "undefined" ? window.innerHeight : 1,
  );
  private lastSimMs = Number.NaN;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "TrajectoryTracks";
    this.scene.add(this.root);
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
   * samples, events or colour changed; a visibility flip just toggles the
   * group. No-op for the same array reference.
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
        existing.track.color === track.color
      ) {
        existing.track = track;
        existing.group.visible = track.visible;
        continue;
      }
      if (existing) this.disposeEntry(existing);
      const entry = this.buildEntry(track);
      if (entry) {
        this.entries.set(track.id, entry);
        entry.group.visible = track.visible;
      } else {
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
   * the span. Null for an unknown track.
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

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.tracks = [];
    this.scene.remove(this.root);
  }

  // --- internals -----------------------------------------------------------

  private readonly tmp = new THREE.Vector3();

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

    if (simMs < times[0]) {
      geom.instanceCount = 0;
      entry.brightLine.visible = false;
      entry.marker.visible = false;
      return;
    }
    if (simMs >= times[n - 1]) {
      geom.instanceCount = n - 1;
      entry.brightLine.visible = true;
      entry.marker.visible = false;
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
    entry.marker.visible = true;
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

    // Event markers, lighter than the track colour.
    let events: THREE.Points | null = null;
    if (track.events.length > 0) {
      const eventPositions: number[] = [];
      for (const ev of track.events) {
        if (ev.timeMs < timesMs[0] || ev.timeMs > timesMs[n - 1]) continue;
        const k = this.segmentIndex(timesMs, ev.timeMs);
        const t0 = timesMs[k];
        const t1 = timesMs[k + 1];
        const f = t1 > t0 ? Math.min(1, Math.max(0, (ev.timeMs - t0) / (t1 - t0))) : 0;
        for (let c = 0; c < 3; c++) {
          const a = scenePositions[k * 3 + c];
          const b = scenePositions[(k + 1) * 3 + c];
          eventPositions.push(a + (b - a) * f);
        }
      }
      if (eventPositions.length > 0) {
        const eventGeometry = new THREE.BufferGeometry();
        eventGeometry.setAttribute("position", new THREE.Float32BufferAttribute(eventPositions, 3));
        const eventMaterial = new THREE.PointsMaterial({
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
    if (entry.usesSprite) releaseRoundSprite();
    this.entries.delete(entry.track.id);
  }
}
