import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { trajectoryAttitudeAt } from "../src/lib/trajectory/attitude";
import {
  bodyToWorldQuaternion,
  GLTF_TO_BODY,
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
      expect(box.min.x).toBeCloseTo(0, 3);
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
