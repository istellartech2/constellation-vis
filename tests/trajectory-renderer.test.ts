import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  EARTH_ROTATION_RAD_S,
  inertialTrailPoint,
  patchTrailLineMaterial,
  TrajectoryRenderer,
} from "../src/lib/trajectory/renderer";
import type { TrajectoryTrack } from "../src/lib/trajectory/types";

const T0 = Date.UTC(2026, 10, 15, 18);
const RE_KM = 6378.137;
const RE_M = 6378137;

/** Slow vertical rise at lat 0 / lon 0 (ECEF +X), so the default attitude is vertical. */
function padTrack(): TrajectoryTrack {
  return {
    id: "pad",
    name: "pad",
    color: "#ff7a45",
    visible: true,
    sourceFrame: "ECEF",
    samples: [
      { timeMs: T0, position: { x: RE_KM, y: 0, z: 0 } },
      { timeMs: T0 + 10_000, position: { x: RE_KM + 0.1, y: 0, z: 0 } },
    ],
    events: [],
    attitudeRules: [],
    model: "generic-rocket",
  };
}

interface Call {
  scene: THREE.Scene;
  near: number;
  far: number;
}

function stubRenderer() {
  const calls: Call[] = [];
  const stub = {
    autoClear: true,
    getSize: (v: THREE.Vector2) => v.set(800, 600),
    clearDepth: () => {},
    render: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      expect(stub.autoClear).toBe(false);
      calls.push({ scene, near: camera.near, far: camera.far });
    },
  };
  return { renderer: stub as unknown as THREE.WebGLRenderer, stub, calls };
}

function cameraAt(local: [number, number, number], target: [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.0001, 100);
  camera.position.set(...local);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function markers(scene: THREE.Scene): THREE.Points[] {
  const out: THREE.Points[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Points && (o.material as THREE.PointsMaterial).size === 9) out.push(o);
  });
  return out;
}

async function setup() {
  const scene = new THREE.Scene();
  const r = new TrajectoryRenderer(scene);
  r.setTracks([padTrack()]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { scene, r };
}

describe("TrajectoryRenderer vehicle pass", () => {
  it("draws the model camera-relative in metres with a tight depth range", async () => {
    const { scene, r } = await setup();
    const date = new Date(T0);
    r.update(date, 0);
    expect(markers(scene)[0].visible).toBe(true);
    // 300 m east (ECEF +Y → local −Z), 20 m up, looking at the pad.
    const camera = cameraAt([1 + 20 / RE_M, 0, -300 / RE_M], [1, 0, 0]);
    const { renderer, stub, calls } = stubRenderer();
    r.renderVehicles(renderer, camera, date, 0);
    expect(stub.autoClear).toBe(true);
    // Ground disc pass, then the model pass.
    expect(calls.length).toBe(2);
    const modelPass = calls[1];
    let model: THREE.Object3D | undefined;
    modelPass.scene.traverse((o) => {
      if (o.name === "TrajectoryModel:generic-rocket") model = o;
    });
    expect(model?.visible).toBe(true);
    const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(model!.quaternion);
    expect(nose.x).toBeCloseTo(1, 6);
    // Base (body origin) on the track point, relative to the camera.
    const expectedBase = new THREE.Vector3(1, 0, 0).sub(camera.position).multiplyScalar(RE_M);
    expect(model!.position.distanceTo(expectedBase)).toBeLessThan(0.05);
    const dist = expectedBase.length();
    expect(modelPass.near).toBeGreaterThan(dist - 45);
    expect(modelPass.far).toBeLessThan(dist + 45);
    expect(r.vehicleLengthM("pad")).toBeCloseTo(41.6, 1);
    // The model is large on screen, so the marker dot is hidden next frame.
    r.update(date, 0);
    expect(markers(scene)[0].visible).toBe(false);
    r.dispose();
  });

  it("skips the pass when the vehicle is behind the Earth", async () => {
    const { r } = await setup();
    const date = new Date(T0);
    r.update(date, 0);
    const { renderer, calls } = stubRenderer();
    r.renderVehicles(renderer, cameraAt([-1.001, 0, 0], [-2, 0, 0]), date, 0);
    expect(calls.length).toBe(0);
    r.dispose();
  });

  it("reports the true local state and the default vehicle length", async () => {
    const { r } = await setup();
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    expect(r.localStateAt("pad", T0 + 5000, pos, vel)).toBe(true);
    expect(pos.x).toBeCloseTo(1 + 0.05 / RE_KM, 9);
    expect(vel.x).toBeCloseTo(0.01 / RE_KM, 9);
    expect(r.localStateAt("pad", T0 + 20_000, pos, vel)).toBe(false);
    expect(r.localStateAt("missing", T0, pos, vel)).toBe(false);
    expect(r.vehicleLengthM("missing")).toBe(50);
    r.dispose();
  });
});

describe("TrajectoryRenderer satellite vehicle (近接)", () => {
  it("draws the ad-hoc satellite camera-relative with its wings driven and overlays on top", async () => {
    const scene = new THREE.Scene();
    const r = new TrajectoryRenderer(scene);
    const date = new Date(T0);
    r.update(date, 0);
    const satX = 1.1;
    const state = {
      model: "satellite-bus",
      x: satX,
      y: 0,
      z: 0,
      bodyToWorld: new THREE.Quaternion(),
      driveAngleRad: 0.5,
      up: { x: 1, y: 0, z: 0 },
      showAxes: true,
      sunDirection: { x: 0, y: 1, z: 0 },
    };
    r.setSatelliteVehicle(state);
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.setSatelliteVehicle(state);
    const camera = cameraAt([satX + 30 / RE_M, 0, 5 / RE_M], [satX, 0, 0]);
    const { renderer, calls } = stubRenderer();
    r.renderVehicles(renderer, camera, date, 0);
    expect(calls.length).toBe(1);
    let model: THREE.Object3D | undefined;
    let overlay: THREE.Object3D | undefined;
    calls[0].scene.traverse((o) => {
      if (o.name === "TrajectoryModel:satellite-bus") model = o;
      if (o.name === "SatelliteAttitudeOverlay") overlay = o;
    });
    expect(model?.visible).toBe(true);
    const expected = new THREE.Vector3(satX, 0, 0).sub(camera.position).multiplyScalar(RE_M);
    expect(model!.position.distanceTo(expected)).toBeLessThan(0.01);
    const wings: THREE.Object3D[] = [];
    model!.traverse((o) => {
      if (o.name === "solar-wing") wings.push(o);
    });
    expect(wings.length).toBe(2);
    for (const w of wings) expect(w.rotation.y).toBeCloseTo(0.5, 9);
    expect(overlay?.visible).toBe(true);
    expect(r.satelliteVehicleCoversMarker()).toBe(true);
    expect(r.satelliteVehicleLengthM("satellite-bus")).toBeCloseTo(10.4, 6);
    // Cleared: not drawn any more.
    r.setSatelliteVehicle(null);
    const second = stubRenderer();
    r.renderVehicles(second.renderer, camera, date, 0);
    expect(second.calls.length).toBe(0);
    expect(r.satelliteVehicleCoversMarker()).toBe(false);
    r.dispose();
  });
});

function findModel(scene: THREE.Scene, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  scene.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

function entryLines(scene: THREE.Scene): { faint: Line2; bright: Line2 } {
  const lines: Line2[] = [];
  scene.traverse((o) => {
    if (o instanceof Line2) lines.push(o);
  });
  return { faint: lines[0], bright: lines[1] };
}

describe("TrajectoryRenderer trail options", () => {
  it("patches the fat-line shader (time attributes, window fade, inertial rotation)", () => {
    const material = new LineMaterial();
    const uniforms = {
      trailNowS: { value: 0 },
      trailInertial: { value: 0 },
      trailOrigin: { value: new THREE.Vector3() },
      trailWindowS: { value: 0 },
    };
    expect(patchTrailLineMaterial(material, uniforms)).toBe(true);
    expect(material.vertexShader).toContain("trailFrame( instanceStart, instanceTimeStart )");
    expect(material.vertexShader).toContain("vTrailAge =");
    expect(material.fragmentShader).toContain("trailWindowS");
    expect(material.uniforms.trailWindowS).toBe(uniforms.trailWindowS);
    material.dispose();
  });

  it("draws an inertial-frame point where it was when flown", () => {
    // Overlay group rotated by GMST(t) = g0 + ω t (the scene's convention).
    const g0 = 1.234;
    const flownS = 1000;
    const nowS = 4600;
    const p = new THREE.Vector3(0.8, 0.3, -0.5);
    const drawn = inertialTrailPoint(p, flownS, nowS, new THREE.Vector3());
    const world = drawn.applyAxisAngle(new THREE.Vector3(0, 1, 0), g0 + EARTH_ROTATION_RAD_S * nowS);
    const then = p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), g0 + EARTH_ROTATION_RAD_S * flownS);
    expect(world.distanceTo(then)).toBeLessThan(1e-12);
    // The newest point is not moved.
    expect(inertialTrailPoint(p, nowS, nowS, new THREE.Vector3()).distanceTo(p)).toBe(0);
  });

  it("hides the future path, updates the window uniforms, and holds the model after the end", async () => {
    const scene = new THREE.Scene();
    const r = new TrajectoryRenderer(scene);
    const base = padTrack();
    r.setTracks([{ ...base, holdEndMs: 30_000, trail: { future: false, windowMs: 5000, frame: "inertial" } }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { faint, bright } = entryLines(scene);
    r.update(new Date(T0 + 4000), 0);
    expect(faint.visible).toBe(false);
    const u = (bright.material as LineMaterial).uniforms;
    expect(u.trailWindowS.value).toBe(5);
    expect(u.trailInertial.value).toBe(1);
    expect(u.trailNowS.value).toBeCloseTo(4, 9);

    // 20 s after the end (inside the 30 s hold): marker and model stay at the last sample.
    const held = new Date(T0 + 30_000);
    r.update(held, 0);
    expect(markers(scene)[0].visible).toBe(true);
    const camera = cameraAt([1 + 20 / RE_M, 0, -300 / RE_M], [1, 0, 0]);
    const first = stubRenderer();
    r.renderVehicles(first.renderer, camera, held, 0);
    const model = findModel(first.calls[first.calls.length - 1].scene, "TrajectoryModel:generic-rocket");
    expect(model?.visible).toBe(true);
    const expectedBase = new THREE.Vector3(1 + 0.1 / RE_KM, 0, 0).sub(camera.position).multiplyScalar(RE_M);
    expect(model!.position.distanceTo(expectedBase)).toBeLessThan(0.05);
    // After the hold: gone.
    const late = new Date(T0 + 41_000);
    r.update(late, 0);
    expect(markers(scene)[0].visible).toBe(false);
    const second = stubRenderer();
    r.renderVehicles(second.renderer, camera, late, 0);
    expect(second.calls.length).toBe(0);
    r.dispose();
  });

  it("re-bases the line origin near the camera without moving the line", async () => {
    const { scene, r } = await setup();
    const { faint } = entryLines(scene);
    const group = faint.parent!;
    const attr = faint.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    const absolute = (i: number) => new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)).add(group.position);
    const before = absolute(0);
    // Move the origin far away by hand, then let the camera-proximity rule bring it back.
    (r as unknown as { rebaseEntry(e: unknown, o: THREE.Vector3): void }).rebaseEntry(
      (r as unknown as { entries: Map<string, unknown> }).entries.get("pad"),
      new THREE.Vector3(0.5, 0.5, 0),
    );
    expect(group.position.x).toBe(0.5);
    expect(absolute(0).distanceTo(before)).toBeLessThan(1e-7);
    const date = new Date(T0 + 5000);
    r.update(date, 0);
    r.renderVehicles(stubRenderer().renderer, cameraAt([1 + 20 / RE_M, 0, -300 / RE_M], [1, 0, 0]), date, 0);
    expect(group.position.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-4);
    expect(absolute(0).distanceTo(before)).toBeLessThan(1e-9);
    r.dispose();
  });
});

describe("TrajectoryRenderer ellipsoid", () => {
  it("draws a 0 km point at 26° N on the flattened globe, not above it", async () => {
    // WGS84 point at 26° N, 0 km (lon 0).
    const lat = (26 * Math.PI) / 180;
    const e2 = 1 - (6356.7523142 / RE_KM) ** 2;
    const n = RE_KM / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const x = n * Math.cos(lat);
    const z = n * (1 - e2) * Math.sin(lat);
    const scene = new THREE.Scene();
    const r = new TrajectoryRenderer(scene);
    const track = padTrack();
    track.samples = [
      { timeMs: T0, position: { x, y: 0, z } },
      { timeMs: T0 + 10_000, position: { x: x + 0.01, y: 0, z } },
    ];
    r.setTracks([track]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.update(new Date(T0), 0);
    scene.updateMatrixWorld(true);
    // The globe is the unit sphere y-scaled by Rp/Re: its surface point is ECEF / Re.
    const surface = new THREE.Vector3(x / RE_KM, z / RE_KM, 0);
    const marker = markers(scene)[0];
    const world = marker.getWorldPosition(new THREE.Vector3());
    expect(world.distanceTo(surface) * RE_M).toBeLessThan(1);
    // localStateAt is in the same (flattened, world-aligned) frame.
    const pos = new THREE.Vector3();
    expect(r.localStateAt("pad", T0, pos, new THREE.Vector3())).toBe(true);
    expect(pos.distanceTo(surface) * RE_M).toBeLessThan(1e-3);
    // The vehicle base is placed on the same point (camera 300 m east, looking at it).
    const camera = cameraAt([surface.x, surface.y, -300 / RE_M], [surface.x, surface.y, 0]);
    const { renderer, calls } = stubRenderer();
    r.renderVehicles(renderer, camera, new Date(T0), 0);
    let model: THREE.Object3D | undefined;
    calls[calls.length - 1].scene.traverse((o) => {
      if (o.name === "TrajectoryModel:generic-rocket") model = o;
    });
    expect(model?.visible).toBe(true);
    const expectedBase = surface.clone().sub(camera.position).multiplyScalar(RE_M);
    expect(model!.position.distanceTo(expectedBase)).toBeLessThan(0.05);
    r.dispose();
  });
});

describe("TrajectoryRenderer landmarks", () => {
  it("draws a landmark model upright on its point and shows its dot only when near", async () => {
    const scene = new THREE.Scene();
    const r = new TrajectoryRenderer(scene);
    r.setLandmarks([{ id: "tower", label: "Tower", latDeg: 0, lonDeg: 0, model: "launch-tower", headingDeg: 270, maxDistanceKm: 50 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const date = new Date(T0);
    r.update(date, 0);
    const camera = cameraAt([1 + 50 / RE_M, 0, -600 / RE_M], [1, 0, 0]);
    const { renderer, calls } = stubRenderer();
    r.renderVehicles(renderer, camera, date, 0);
    const pass = calls[calls.length - 1];
    const tower = findModel(pass.scene, "TrajectoryModel:launch-tower");
    expect(tower?.visible).toBe(true);
    // Body +X (up) along the local vertical (ECEF +X → local +X here).
    const up = new THREE.Vector3(1, 0, 0).applyQuaternion(tower!.quaternion);
    expect(up.x).toBeCloseTo(1, 6);
    // Origin (the mount axis) on the point.
    const expected = new THREE.Vector3(1, 0, 0).sub(camera.position).multiplyScalar(RE_M);
    expect(tower!.position.distanceTo(expected)).toBeLessThan(0.05);
    // Large on screen → the dot gives way to the model; far away → no dot either.
    r.update(date, 0);
    const dots: THREE.Points[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Points && (o.material as THREE.PointsMaterial).size === 7) dots.push(o);
    });
    expect(dots[0].visible).toBe(false);
    r.renderVehicles(stubRenderer().renderer, cameraAt([3, 0, 0], [0, 0, 0]), date, 0);
    r.update(date, 0);
    expect(dots[0].visible).toBe(false);
    r.dispose();
  });
});
