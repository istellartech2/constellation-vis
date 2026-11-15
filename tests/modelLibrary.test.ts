import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import {
  autoOrientation,
  bodyBoxSize,
  bodyYAxis,
  guessUnit,
  isValidOrientation,
  libraryModelLengthM,
  metresPerModelUnit,
  modelToBodyMatrix,
  applyMat3,
  sourceUpOf,
} from "../src/lib/modelLibrary/orientation";
import { checkModelFileName, checkModelFileSize, inspectModelData } from "../src/lib/modelLibrary/format";
import { createMemoryBackend, ModelLibrary, sanitizeModelMeta, type ModelStoreBackend } from "../src/lib/modelLibrary/store";
import { buildLibraryTemplate, LIBRARY_SOLAR_WING_NODE_NAME, listModelNodes } from "../src/lib/modelLibrary/template";
import { isSatelliteModelValue, libraryModelId, MODEL_AXES, type LibraryModelSettings } from "../src/lib/modelLibrary/types";
import { GLTF_TO_BODY, SOLAR_WING_NODE_NAME, setSolarArrayDrive } from "../src/lib/trajectory/models";

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("orientation math", () => {
  it("reproduces the built-in glTF → body rotation (+Y nose, +Z belly)", () => {
    const m = modelToBodyMatrix({ forward: "+Y", nadir: "+Z" });
    for (const v of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const expected = v.clone().applyQuaternion(GLTF_TO_BODY);
      const got = applyMat3(m, [v.x, v.y, v.z]);
      expect(got[0]).toBeCloseTo(expected.x, 12);
      expect(got[1]).toBeCloseTo(expected.y, 12);
      expect(got[2]).toBeCloseTo(expected.z, 12);
    }
  });

  it("is a proper rotation for every perpendicular pair and rejects parallel axes", () => {
    for (const forward of MODEL_AXES) {
      for (const nadir of MODEL_AXES) {
        const o = { forward, nadir };
        if (forward[1] === nadir[1]) {
          expect(isValidOrientation(o)).toBe(false);
          expect(() => modelToBodyMatrix(o)).toThrow();
          continue;
        }
        const [a, b, c] = modelToBodyMatrix(o);
        const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        expect(det).toBe(1);
        // The forward axis maps to body +X, the nadir axis to body +Z.
        const f = applyMat3([a, b, c], [forward[1] === "X" ? 1 : 0, forward[1] === "Y" ? 1 : 0, forward[1] === "Z" ? 1 : 0].map((v) => (forward[0] === "-" ? -v : v)) as [number, number, number]);
        expect(f.map((v) => v + 0)).toEqual([1, 0, 0]);
      }
    }
    expect(bodyYAxis({ forward: "+X", nadir: "+Z" })).toBe("+Y");
    expect(bodyYAxis({ forward: "+Y", nadir: "+Z" })).toBe("-X");
    expect(bodyYAxis({ forward: "+X", nadir: "-Y" })).toBe("+Z");
  });

  it("permutes the bbox into body axes", () => {
    expect(bodyBoxSize({ forward: "+Y", nadir: "+Z" }, [1, 2, 3])).toEqual([2, 1, 3]);
    expect(bodyBoxSize({ forward: "-Z", nadir: "+X" }, [1, 2, 3])).toEqual([3, 2, 1]);
  });

  it("guesses orientation from the bounding box", () => {
    // Rockets: nose = longest axis; standing on the up axis → glTF belly convention.
    expect(autoOrientation([1, 10, 1], "rocket")).toEqual({ forward: "+Y", nadir: "+Z" });
    expect(autoOrientation([1, 1, 10], "rocket", "z")).toEqual({ forward: "+Z", nadir: "+Y" });
    // Lying flat: belly toward −up.
    expect(autoOrientation([10, 1, 2], "rocket")).toEqual({ forward: "+X", nadir: "-Y" });
    expect(autoOrientation([10, 1, 2], "rocket", "z")).toEqual({ forward: "+X", nadir: "-Z" });
    // Satellites: nadir = −up, the longer horizontal side is the wing span (body ±Y).
    expect(autoOrientation([7400, 2000, 1600], "satellite", "z")).toEqual({ forward: "+Y", nadir: "-Z" });
    expect(autoOrientation([10, 2, 3], "satellite", "y")).toEqual({ forward: "+Z", nadir: "-Y" });
    for (const [size, up] of [[[10, 2, 3], "y"], [[2, 3, 10], "y"], [[10, 2, 3], "z"], [[2, 10, 3], "z"]] as const) {
      const o = autoOrientation([...size] as [number, number, number], "satellite", up);
      expect(isValidOrientation(o)).toBe(true);
      expect(bodyBoxSize(o, [...size] as [number, number, number])[1]).toBe(10);
    }
    expect(sourceUpOf({ forward: "+Y", nadir: "-Z" })).toBe("z");
    expect(sourceUpOf({ forward: "+Z", nadir: "-Y" })).toBe("z");
    expect(sourceUpOf({ forward: "+X", nadir: "-Y" })).toBe("y");
  });

  it("guesses units and converts scale", () => {
    expect(guessUnit(3)).toBe("m");
    expect(guessUnit(450)).toBe("cm");
    expect(guessUnit(12000)).toBe("mm");
    expect(metresPerModelUnit({ mode: "unit", unit: "mm" }, 5000)).toBe(0.001);
    expect(metresPerModelUnit({ mode: "unit", unit: "in" }, 1)).toBe(0.0254);
    expect(metresPerModelUnit({ mode: "length", lengthM: 8 }, 4)).toBe(2);
    expect(libraryModelLengthM({ scale: { mode: "unit", unit: "mm" }, bboxSize: [1200, 300, 4500] })).toBeCloseTo(4.5, 12);
  });
});

describe("model strings", () => {
  it("parses library ids and validates satelliteModel values", () => {
    expect(libraryModelId("library:abc_12-3")).toBe("abc_12-3");
    expect(libraryModelId("library:")).toBeNull();
    expect(libraryModelId("library:a/b")).toBeNull();
    expect(libraryModelId("satellite-bus")).toBeNull();
    expect(isSatelliteModelValue("satellite-bus")).toBe(true);
    expect(isSatelliteModelValue("library:x1")).toBe(true);
    expect(isSatelliteModelValue("starship-v3-ship")).toBe(false);
    expect(isSatelliteModelValue("https://example.com/a.glb")).toBe(false);
  });
});

describe("file checks", () => {
  it("accepts .glb / .gltf names only", () => {
    expect(checkModelFileName("sat.GLB")).toBeNull();
    expect(checkModelFileName("sat.gltf")).toBeNull();
    expect(checkModelFileName("sat.obj")).toContain(".obj 形式");
  });

  it("limits and warns on size", () => {
    expect(checkModelFileSize(1e6)).toEqual({});
    expect(checkModelFileSize(20 * 1024 * 1024).warning).toBeDefined();
    expect(checkModelFileSize(60 * 1024 * 1024).error).toBeDefined();
  });

  it("detects GLB by magic and requires self-contained glTF", () => {
    const glb = new ArrayBuffer(12);
    new DataView(glb).setUint32(0, 0x46546c67, true);
    new DataView(glb).setUint32(4, 2, true);
    expect(inspectModelData(glb)).toEqual({ format: "glb" });
    new DataView(glb).setUint32(4, 1, true);
    expect("error" in inspectModelData(glb)).toBe(true);
    expect(inspectModelData(enc(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }] })))).toEqual({
      format: "gltf",
    });
    const external = inspectModelData(enc(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "scene.bin" }] })));
    expect("error" in external && external.error).toContain("scene.bin");
    expect("error" in inspectModelData(enc("solid cube\nendsolid"))).toBe(true);
    expect("error" in inspectModelData(enc(JSON.stringify({ asset: { version: "1.0" } })))).toBe(true);
  });
});

const SETTINGS: LibraryModelSettings = {
  name: "Test",
  orientation: { forward: "+Y", nadir: "-Z" },
  scale: { mode: "unit", unit: "mm" },
  origin: "center",
  solarWings: [],
};
const FILE = { fileName: "t.glb", format: "glb" as const, sizeBytes: 4, bboxSize: [1, 2, 3] as [number, number, number] };

describe("metadata validation", () => {
  it("keeps valid records and rejects broken ones", () => {
    const meta = { id: "abc", ...FILE, ...SETTINGS, addedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    expect(sanitizeModelMeta(meta)).toEqual(meta);
    expect(sanitizeModelMeta({ ...meta, orientation: { forward: "+X", nadir: "-X" } })).toBeNull();
    expect(sanitizeModelMeta({ ...meta, id: "../x" })).toBeNull();
    expect(sanitizeModelMeta({ ...meta, scale: { mode: "unit", unit: "ft" } })).toBeNull();
    expect(sanitizeModelMeta({ ...meta, solarWings: [{ path: [0, -1] }, { path: [1, 2], name: "w" }] })?.solarWings).toEqual([
      { path: [1, 2], name: "w" },
    ]);
  });
});

describe("ModelLibrary", () => {
  it("adds, updates and deletes with change notifications", async () => {
    const lib = new ModelLibrary(createMemoryBackend());
    const changes: string[] = [];
    lib.onChange((c) => changes.push(`${c.kind}:${c.id}`));
    const meta = await lib.add(FILE, SETTINGS, new ArrayBuffer(4));
    expect(lib.getSnapshot()).toMatchObject({ ready: true, mode: "persistent" });
    expect(lib.getSnapshot().models.map((m) => m.id)).toEqual([meta.id]);
    expect((await lib.load(meta.id))?.data.byteLength).toBe(4);
    await lib.update(meta.id, { ...SETTINGS, name: "Renamed" });
    expect(lib.get(meta.id)?.name).toBe("Renamed");
    await lib.update(meta.id, { ...SETTINGS, name: "Renamed", sourceUp: "z" }, { ...FILE, fileName: "v2.glb", sizeBytes: 6, bboxSize: [4, 5, 6], data: new ArrayBuffer(6) });
    expect(lib.get(meta.id)).toMatchObject({ fileName: "v2.glb", sizeBytes: 6, bboxSize: [4, 5, 6], sourceUp: "z" });
    expect((await lib.load(meta.id))?.data.byteLength).toBe(6);
    await lib.remove(meta.id);
    expect(lib.getSnapshot().models).toEqual([]);
    expect(await lib.load(meta.id)).toBeNull();
    expect(changes).toEqual([`update:${meta.id}`, `update:${meta.id}`, `delete:${meta.id}`]);
  });

  it("falls back to session storage when the backend fails", async () => {
    const broken: ModelStoreBackend = {
      listMeta: () => Promise.reject(new Error("blocked")),
      getData: () => Promise.reject(new Error("blocked")),
      putMeta: () => Promise.reject(new Error("blocked")),
      putData: () => Promise.reject(new Error("blocked")),
      remove: () => Promise.reject(new Error("blocked")),
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const lib = new ModelLibrary(broken);
      await lib.init();
      expect(lib.getSnapshot()).toMatchObject({ ready: true, mode: "session" });
      const meta = await lib.add(FILE, SETTINGS, new ArrayBuffer(8));
      expect((await lib.load(meta.id))?.data.byteLength).toBe(8);
      // A write failure after a good start also switches to session storage.
      const flaky = createMemoryBackend();
      const lib2 = new ModelLibrary({ ...flaky, putData: () => Promise.reject(new Error("quota")) });
      const meta2 = await lib2.add(FILE, SETTINGS, new ArrayBuffer(2));
      expect(lib2.getSnapshot().mode).toBe("session");
      expect((await lib2.load(meta2.id))?.data.byteLength).toBe(2);
    } finally {
      console.warn = warn;
    }
  });
});

describe("buildLibraryTemplate", () => {
  /** Z-up CAD-like model in mm: 4000 mm along model +Y (forward), sensor bump on model −Z. */
  function makeScene() {
    const scene = new THREE.Group();
    const bus = new THREE.Mesh(new THREE.BoxGeometry(1000, 4000, 1000));
    bus.name = "bus";
    const wing = new THREE.Group();
    wing.name = "wing";
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6000, 800, 20));
    panel.position.set(3500, 0, 0);
    wing.add(panel);
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 400));
    sensor.position.set(0, 0, -700);
    scene.add(bus, wing, sensor);
    return scene;
  }

  it("maps model axes, units and origin into the body frame", () => {
    const t = buildLibraryTemplate(makeScene(), SETTINGS, "library:t");
    t.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t.root);
    // forward +Y → body X (4 m), nadir −Z → body Z; model X (wing) → body Y.
    expect(box.max.x - box.min.x).toBeCloseTo(4, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(7, 6);
    // Centre origin: the bbox centre sits at the body origin.
    const c = box.getCenter(new THREE.Vector3());
    expect(c.length()).toBeLessThan(1e-6);
    expect(t.anchor).toBe("center");
    expect(t.lengthM).toBeCloseTo(7, 6);
    // The sensor (model −Z) is on the body +Z (nadir) side.
    const sensor = t.root.getObjectByName("bus")!.parent!.children[2];
    const p = new THREE.Vector3();
    sensor.getWorldPosition(p);
    expect(p.z).toBeGreaterThan(0.4);
  });

  it("puts the base origin at the aft end on the axis", () => {
    const t = buildLibraryTemplate(makeScene(), { ...SETTINGS, origin: "base", scale: { mode: "length", lengthM: 14 } }, "library:t");
    const box = new THREE.Box3().setFromObject(t.root);
    expect(box.min.x).toBeCloseTo(0, 6);
    expect(t.anchor).toBe("base");
    // Length mode: longest side (7000 mm) → 14 m, so ×2 of the mm scale.
    expect(t.lengthM).toBeCloseTo(8, 6);
    expect(t.pivotBody.x).toBeCloseTo(4, 6);
  });

  it("wraps selected solar wings in body-Y pivots", () => {
    const scene = makeScene();
    const nodes = listModelNodes(scene);
    expect(nodes.map((n) => n.name)).toEqual(["bus", "wing", "", ""]);
    const wingRef = { path: nodes[1].path, name: "wing" };
    // A child of a selected wing is ignored (it turns with its parent).
    const t = buildLibraryTemplate(scene, { ...SETTINGS, solarWings: [wingRef, { path: [1, 0], name: "" }] }, "library:t");
    expect(LIBRARY_SOLAR_WING_NODE_NAME).toBe(SOLAR_WING_NODE_NAME);
    expect(setSolarArrayDrive(t.root, Math.PI / 2)).toBe(1);
    t.root.updateMatrixWorld(true);
    const panel = t.root.getObjectByName("wing")!.children[0];
    const after = new THREE.Box3().setFromObject(panel);
    // Turning about body Y keeps the span along Y and swaps the panel's X/Z extents.
    expect(after.max.y - after.min.y).toBeCloseTo(6, 6);
    expect(after.max.x - after.min.x).toBeCloseTo(0.02, 6);
    expect(after.max.z - after.min.z).toBeCloseTo(0.8, 6);
  });
});

describe("library models in the trajectory model cache", () => {
  it("loads library:<id> by its metadata and reloads after an edit", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { modelLibrary } = await import("../src/lib/modelLibrary/store");
    const models = await import("../src/lib/trajectory/models");
    const buf = readFileSync(join(import.meta.dir, "..", "public", "models", "starship-v3-ship.glb"));
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const meta = await modelLibrary.add(
      { fileName: "ship.glb", format: "glb", sizeBytes: data.byteLength, bboxSize: [9, 52.1, 9] },
      { name: "Ship", orientation: { forward: "+Y", nadir: "+Z" }, scale: { mode: "unit", unit: "m" }, origin: "base", solarWings: [] },
      data,
    );
    const key = `library:${meta.id}`;
    expect(models.trajectoryModelUrl(key)).toBeNull();
    // Known from the metadata before the file is parsed (近接 / follow framing).
    expect(models.trajectoryModelLengthM(key)).toBeCloseTo(52.1, 6);
    const first = await models.acquireTrajectoryModel(key);
    expect(first.anchor).toBe("base");
    expect(first.lengthM).toBeCloseTo(52.1, 0);
    const phases: string[] = [];
    const off = models.onTrajectoryModelInvalidated((model, phase) => {
      if (model !== key) return;
      phases.push(phase);
      if (phase === "release") models.releaseTrajectoryModel(key);
    });
    await modelLibrary.update(meta.id, { ...meta, scale: { mode: "length", lengthM: 26.05 } });
    expect(phases).toEqual(["release", "reload"]);
    const second = await models.acquireTrajectoryModel(key);
    expect(second).not.toBe(first);
    expect(second.lengthM).toBeCloseTo(26.05, 1);
    models.releaseTrajectoryModel(key);
    await modelLibrary.remove(meta.id);
    expect(phases).toEqual(["release", "reload", "release"]);
    off();
    await expect(models.acquireTrajectoryModel(key)).rejects.toThrow("not in the model library");
    models.releaseTrajectoryModel(key);
  });
});
