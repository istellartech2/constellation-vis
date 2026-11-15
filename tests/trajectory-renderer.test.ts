import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { TrajectoryRenderer } from "../src/lib/trajectory/renderer";
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
