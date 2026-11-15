import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { geodeticUpEcef, trajectoryAttitudeAt, uprightBodyQuaternion } from "../src/lib/trajectory/attitude";
import {
  acquireTrajectoryModel,
  bodyToWorldQuaternion,
  GLTF_TO_BODY,
  LANDMARK_MODELS,
  releaseTrajectoryModel,
  trajectoryModelLengthM,
  parseGlbTemplate,
  templateFromGltfScene,
  TRAJECTORY_MODELS,
  trajectoryModelUrl,
} from "../src/lib/trajectory/models";
import type { TrajectoryState, TrajectoryTrack } from "../src/lib/trajectory/types";

function readGlb(name: string): ArrayBuffer {
  const buf = readFileSync(join(import.meta.dir, "..", "public", "models", `${name}.glb`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function bodyBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

describe("model registry", () => {
  it("lists the built-in keys with Japanese labels", () => {
    expect(TRAJECTORY_MODELS.map((m) => m.key)).toEqual([
      "starship-v3-booster",
      "starship-v3-ship",
      "generic-rocket",
      "satellite-bus",
    ]);
    expect(trajectoryModelUrl("starship-v3-ship")).toBe("./models/starship-v3-ship.glb");
    expect(trajectoryModelUrl("generic-rocket")).toBeNull();
    expect(trajectoryModelUrl("blob:abc")).toBe("blob:abc");
  });
});

describe("launch tower landmark", () => {
  it("is a procedural landmark model, not offered for tracks", async () => {
    expect(LANDMARK_MODELS.map((m) => m.key)).toEqual(["launch-tower"]);
    expect(TRAJECTORY_MODELS.some((m) => m.key === "launch-tower")).toBe(false);
    expect(trajectoryModelUrl("launch-tower")).toBeNull();
    expect(trajectoryModelLengthM("launch-tower")).toBe(145);
    const t = await acquireTrajectoryModel("launch-tower");
    try {
      const box = bodyBox(t.root);
      // ~145 m tall (plus the mast) along body +X from the ground; the column
      // stands toward body +Y and the arms leave the mount axis (|Z| < 4.5 m) clear.
      expect(box.min.x).toBeGreaterThan(-0.5);
      expect(box.min.x).toBeLessThan(0.5);
      expect(box.max.x).toBeGreaterThan(145);
      expect(box.max.y).toBeGreaterThan(20);
      expect(t.anchor).toBe("base");
      let blocksAxis = false;
      t.root.updateMatrixWorld(true);
      t.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const b = new THREE.Box3().setFromObject(mesh);
        if (b.min.y < 4.5 && b.max.y > -4.5 && b.min.z < 4.5 && b.max.z > -4.5 && b.max.x > 0 && mesh.geometry.type === "BoxGeometry") blocksAxis = true;
      });
      expect(blocksAxis).toBe(false);
    } finally {
      releaseTrajectoryModel("launch-tower");
    }
  });

  it("stands upright facing a bearing", () => {
    const q = uprightBodyQuaternion(26, -97, 270);
    const Q = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(Q);
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
    const up = geodeticUpEcef(26, -97, new THREE.Vector3());
    expect(x.distanceTo(up)).toBeLessThan(1e-9);
    const lon = (-97 * Math.PI) / 180;
    const west = new THREE.Vector3(Math.sin(lon), -Math.cos(lon), 0);
    expect(y.distanceTo(west)).toBeLessThan(1e-9);
  });
});

describe("GLB normalisation", () => {
  for (const [name, length] of [
    ["starship-v3-booster", 72.3],
    ["starship-v3-ship", 52.1],
  ] as const) {
    it(`puts ${name} nose on body +X with the base at the origin`, async () => {
      const t = await parseGlbTemplate(readGlb(name), name);
      expect(t.lengthM).toBeCloseTo(length, 1);
      expect(t.anchor).toBe("base");
      const box = bodyBox(t.root);
      expect(box.min.x).toBeGreaterThan(-0.5);
      expect(box.min.x).toBeLessThan(0.5);
      expect(box.max.x).toBeCloseTo(length, 1);
      expect(t.pivotBody.x).toBeCloseTo(length / 2, 1);
    });
  }

  it("puts the ship's heat-shield tiles on body +Z (belly)", async () => {
    const t = await parseGlbTemplate(readGlb("starship-v3-ship"), "starship-v3-ship");
    t.root.updateMatrixWorld(true);
    const sum = { tile: 0, tileN: 0, steel: 0, steelN: 0 };
    const v = new THREE.Vector3();
    t.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      const groups = mesh.geometry.groups.length
        ? mesh.geometry.groups
        : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
      for (const g of groups) {
        const name = materials[g.materialIndex ?? 0].name;
        if (name !== "tile" && name !== "steel") continue;
        for (let i = g.start; i < g.start + g.count; i += 1) {
          v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
          if (name === "tile") {
            sum.tile += v.z;
            sum.tileN += 1;
          } else {
            sum.steel += v.z;
            sum.steelN += 1;
          }
        }
      }
    });
    expect(sum.tileN).toBeGreaterThan(0);
    expect(sum.tile / sum.tileN).toBeGreaterThan(0.3);
    expect(sum.steel / sum.steelN).toBeLessThan(-1);
  });

  it("normalises unknown models by their longest axis", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 30));
    mesh.position.set(5, 0, 10);
    const scene = new THREE.Group();
    scene.add(mesh);
    const t = templateFromGltfScene(scene, "user.glb", false);
    expect(t.lengthM).toBeCloseTo(30, 6);
    const box = bodyBox(t.root);
    expect(box.min.x).toBeCloseTo(0, 6);
    expect(box.max.x).toBeCloseTo(30, 6);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(0, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
  });
});

describe("model → world chain", () => {
  const T0 = Date.UTC(2026, 10, 15, 18);
  const track: TrajectoryTrack = {
    id: "t",
    name: "t",
    color: "#fff",
    visible: true,
    sourceFrame: "ECEF",
    samples: [
      { timeMs: T0, position: { x: 6378.137, y: 0, z: 0 } },
      { timeMs: T0 + 1000, position: { x: 6378.137, y: 1, z: 0 } },
    ],
    events: [],
    attitudeRules: [{ timeMs: T0, mode: "vertical" }],
  };
  const state = (latDeg: number, lonDeg: number): TrajectoryState => ({
    timeMs: T0,
    position: { x: 6378.137, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    latDeg,
    lonDeg,
    altKm: 0,
    speedKmS: 0,
  });

  function modelNoseWorld(latDeg: number, lonDeg: number, rotAngle: number): THREE.Vector3 {
    const q = trajectoryAttitudeAt(track, T0, state(latDeg, lonDeg))!;
    const world = bodyToWorldQuaternion(q, rotAngle, new THREE.Quaternion()).multiply(GLTF_TO_BODY);
    return new THREE.Vector3(0, 1, 0).applyQuaternion(world); // glTF +Y = nose
  }

  it("sends a vertical model's +Y to world +X at lat 0 / lon 0", () => {
    const n = modelNoseWorld(0, 0, 0);
    expect(n.x).toBeCloseTo(1, 9);
    expect(n.y).toBeCloseTo(0, 9);
    expect(n.z).toBeCloseTo(0, 9);
  });

  it("sends it to world +Y at the north pole", () => {
    const n = modelNoseWorld(90, 0, 0);
    expect(n.y).toBeCloseTo(1, 9);
  });

  it("matches the scene mapping (x, z, −y) rotated by GMST", () => {
    const rot = 0.7;
    const n = modelNoseWorld(0, 90, rot); // ECEF +Y → local (0, 0, −1)
    const expected = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    expect(n.distanceTo(expected)).toBeLessThan(1e-9);
  });
});

describe("satellite bus (標準バス) solar wings", () => {
  it("is labelled 標準バス and has two wing pivots whose cell face follows the drive like solarArrayIncidence", async () => {
    const { acquireTrajectoryModel, instantiateTrajectoryModel, setSolarArrayDrive, releaseTrajectoryModel } = await import(
      "../src/lib/trajectory/models"
    );
    const { solarArrayIncidence, satelliteAttitudeEci } = await import("../src/lib/attitude/satelliteAttitude");
    expect(TRAJECTORY_MODELS.find((m) => m.key === "satellite-bus")?.label).toBe("標準バス");
    const template = await acquireTrajectoryModel("satellite-bus");
    const object = instantiateTrajectoryModel(template);
    // An arbitrary attitude and Sun.
    const q = satelliteAttitudeEci(
      { x: 7000, y: 0, z: 0 },
      { x: 0, y: 5, z: 5 },
      new Date(Date.UTC(2026, 10, 15)),
      { mode: "lvlh", inertialRaDeg: 0, inertialDecDeg: 0 },
      [],
    );
    const sun = new THREE.Vector3(0.3, -0.5, 0.8).normalize();
    const { cosIncidence, driveAngleRad } = solarArrayIncidence(q, sun, "singleAxis");
    expect(setSolarArrayDrive(object, driveAngleRad)).toBe(2);
    object.updateMatrixWorld(true);
    const qBody = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    object.traverse((o) => {
      if (o.name !== "solar-wing") return;
      // Cell face normal (wing −Z) in body axes, then ECI.
      const n = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion).applyQuaternion(qBody);
      expect(n.dot(sun)).toBeCloseTo(cosIncidence, 9);
    });
    // Body→ECI to the scene at GMST-free rotation: ECI (x, y, z) → scene (x, z, −y).
    const world = bodyToWorldQuaternion(q, 0, new THREE.Quaternion());
    const zBody = new THREE.Vector3(0, 0, 1);
    const zEci = zBody.clone().applyQuaternion(qBody);
    const zWorld = zBody.clone().applyQuaternion(world);
    expect(zWorld.x).toBeCloseTo(zEci.x, 9);
    expect(zWorld.y).toBeCloseTo(zEci.z, 9);
    expect(zWorld.z).toBeCloseTo(-zEci.y, 9);
    releaseTrajectoryModel("satellite-bus");
  });
});
