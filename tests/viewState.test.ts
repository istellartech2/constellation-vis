import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildViewSettings,
  loadLastView,
  saveLastView,
  listSavedViews,
  saveNamedView,
  deleteNamedView,
  type CameraSnapshot,
  type DisplaySettings,
} from "../src/lib/viewState";
import { createDefaultIslSettings } from "../src/lib/isl/types";

// Minimal in-memory localStorage so the persistence helpers can be exercised
// outside a browser (Bun test runner has no DOM).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const CAMERA: CameraSnapshot = {
  mode: "free",
  position: [1, 2, 3],
  target: [0, 0, 0],
  earthCenterDistance: 0.45,
  thirdPersonDistance: 0.4,
  thirdPersonPitch: 0.38,
};

const DISPLAY: DisplaySettings = {
  satRadius: 0.02,
  earthTexture: "./assets/earth01.webp",
  showGraticule: true,
  showEcliptic: false,
  showGeoOrbit: false,
  showSunDirection: true,
  ecef: true,
  showPerturbation: false,
  showDerivedSatelliteInfo: false,
  brightEarth: false,
  whiteBackground: true,
  showGroundStationCones: true,
  showSatelliteFovCones: false,
  groundConeMinElevationDeg: 25,
  groundConeDistanceKm: 1500,
  groundConeColor: "#3ec7a1",
  fovConeHalfAngleDeg: 30,
  fovConeColor: "#3388ff",
  fovConeAlongTrackDeg: 0,
  fovConeCrossTrackDeg: 0,
  satelliteVisibleColor: "#00ff00",
  satelliteHiddenColor: "#ff0000",
  satelliteSelectedColor: "#00ffff",
  speedExp: 1.7,
  isl: createDefaultIslSettings(),
};

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage;
});

describe("viewState persistence", () => {
  it("round-trips the last view", () => {
    const view = buildViewSettings(DISPLAY, CAMERA);
    saveLastView(view);
    expect(loadLastView()).toEqual(view);
  });

  it("returns null for absent or corrupt data", () => {
    expect(loadLastView()).toBeNull();
    localStorage.setItem("constellation-vis:lastView", "{not json");
    expect(loadLastView()).toBeNull();
    localStorage.setItem(
      "constellation-vis:lastView",
      JSON.stringify({ version: 99, display: DISPLAY, camera: CAMERA }),
    );
    expect(loadLastView()).toBeNull();
  });

  it("saves, lists and deletes named views", () => {
    const view = buildViewSettings(DISPLAY, CAMERA);
    const afterSave = saveNamedView("東京上空", view);
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0].name).toBe("東京上空");
    expect(afterSave[0].settings).toEqual(view);

    expect(listSavedViews()).toHaveLength(1);

    const afterDelete = deleteNamedView(afterSave[0].id);
    expect(afterDelete).toHaveLength(0);
    expect(listSavedViews()).toHaveLength(0);
  });

  it("falls back to a placeholder name for blank input", () => {
    const view = buildViewSettings(DISPLAY, CAMERA);
    const result = saveNamedView("   ", view);
    expect(result[0].name).toBe("(無題)");
  });

  it("migrates a pre-Phase-5 (version 1) view instead of discarding it (M-3)", () => {
    const oldShapeDisplay = {
      ...DISPLAY,
      isl: { enabled: true, participantSatnums: [1, 2, 3], shellRanges: [] },
    };
    localStorage.setItem(
      "constellation-vis:lastView",
      JSON.stringify({ version: 1, display: oldShapeDisplay, camera: CAMERA }),
    );

    const loaded = loadLastView();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(2);
    // The old-shaped isl object is not trusted — it falls back to defaults
    // rather than silently running with a satnum-based snapshot that no
    // longer matches the current IslSettings semantics.
    expect(loaded!.display.isl.excludedShellKeys).toEqual([]);
    expect(loaded!.display.isl.includeBaseSatellites).toBe(true);
    expect(loaded!.display.isl.gslColor).toBe("#ff33cc");
  });

  it("migrates a version-1 view with no isl field at all", () => {
    const { isl, ...withoutIsl } = DISPLAY;
    void isl;
    localStorage.setItem(
      "constellation-vis:lastView",
      JSON.stringify({ version: 1, display: withoutIsl, camera: CAMERA }),
    );

    const loaded = loadLastView();
    expect(loaded).not.toBeNull();
    expect(loaded!.display.isl.includeBaseSatellites).toBe(true);
    expect(loaded!.display.isl.islColor).toBe("#33e0ff");
  });

  // S-3: the two ISL colors used to live as separate top-level
  // display.islGslColor/islIslColor fields — verify a saved view in that
  // shape still recovers its colors after moving into display.isl.
  it("migrates legacy top-level islGslColor/islIslColor into isl.gslColor/islColor", () => {
    const legacyDisplay = {
      ...DISPLAY,
      isl: { ...createDefaultIslSettings(), gslColor: undefined, islColor: undefined },
      islGslColor: "#123456",
      islIslColor: "#abcdef",
    };
    localStorage.setItem(
      "constellation-vis:lastView",
      JSON.stringify({ version: 2, display: legacyDisplay, camera: CAMERA }),
    );

    const loaded = loadLastView();
    expect(loaded).not.toBeNull();
    expect(loaded!.display.isl.gslColor).toBe("#123456");
    expect(loaded!.display.isl.islColor).toBe("#abcdef");
    expect((loaded!.display as unknown as { islGslColor?: string }).islGslColor).toBeUndefined();
  });
});
