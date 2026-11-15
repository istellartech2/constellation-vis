import { describe, it, expect, mock } from "bun:test";
import * as THREE from "three";
import {
  LAUNCH_SITE_LOAD_THRESHOLDS,
  LaunchSiteImageryLayer,
  buildPatchArrays,
  earthLocalToEcef,
  ecefAltitudeKm,
  ecefToEarthLocal,
  geodeticToEcefKm,
  launchSiteBounds,
  parseLaunchSiteIndex,
  patchEdgeAlpha,
  patchUv,
  siteLoadStep,
  siteWanted,
  type LaunchSiteImageryCredit,
} from "../src/lib/launchSiteImagery";

const STARBASE = { lat: 25.99, lon: -97.16 };

describe("launchSiteBounds", () => {
  it("spans ~80 km in both directions, widening longitude by 1/cos(lat)", () => {
    const b = launchSiteBounds(STARBASE.lat, STARBASE.lon, 80);
    const midLat = (b.south + b.north) / 2;
    const midLon = (b.west + b.east) / 2;
    expect(midLat).toBeCloseTo(STARBASE.lat, 5);
    expect(midLon).toBeCloseTo(STARBASE.lon, 5);
    // North–south and east–west extent on the ellipsoid, within ~1 %.
    const [sx, sy, sz] = geodeticToEcefKm(b.south, STARBASE.lon);
    const [nx, ny, nz] = geodeticToEcefKm(b.north, STARBASE.lon);
    const [wx, wy, wz] = geodeticToEcefKm(STARBASE.lat, b.west);
    const [ex, ey, ez] = geodeticToEcefKm(STARBASE.lat, b.east);
    expect(Math.hypot(nx - sx, ny - sy, nz - sz)).toBeGreaterThan(79);
    expect(Math.hypot(nx - sx, ny - sy, nz - sz)).toBeLessThan(81);
    expect(Math.hypot(ex - wx, ey - wy, ez - wz)).toBeGreaterThan(79);
    expect(Math.hypot(ex - wx, ey - wy, ez - wz)).toBeLessThan(81);
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
  });

  it("works in the southern hemisphere near the antimeridian (Mahia)", () => {
    const b = launchSiteBounds(-39.26, 177.86, 80);
    expect(b.south).toBeLessThan(-39.26);
    expect(b.north).toBeGreaterThan(-39.26);
    expect(b.east).toBeLessThan(180);
  });
});

describe("UV mapping and edge fade", () => {
  const b = launchSiteBounds(STARBASE.lat, STARBASE.lon, 80);

  it("maps the box corners to the image corners (v = 0 at the south edge)", () => {
    expect(patchUv(b, b.south, b.west)).toEqual([0, 0]);
    expect(patchUv(b, b.north, b.east)).toEqual([1, 1]);
    const [u, v] = patchUv(b, STARBASE.lat, STARBASE.lon);
    expect(u).toBeCloseTo(0.5, 6);
    expect(v).toBeCloseTo(0.5, 6);
  });

  it("fades to zero at the border and is opaque inside", () => {
    expect(patchEdgeAlpha(0, 0.5)).toBe(0);
    expect(patchEdgeAlpha(0.5, 1)).toBe(0);
    expect(patchEdgeAlpha(0.5, 0.5)).toBe(1);
    expect(patchEdgeAlpha(0.1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("builds a grid whose vertices sit on the ellipsoid with matching UVs", () => {
    const { positions, uvs, normals, indices } = buildPatchArrays(b, 4, 0);
    expect(positions.length).toBe(25 * 3);
    expect(indices.length).toBe(4 * 4 * 6);
    // First vertex: south-west corner, UV (0, 0).
    expect([uvs[0], uvs[1]]).toEqual([0, 0]);
    const [x, y, z] = earthLocalToEcef(positions[0], positions[1], positions[2]);
    expect(ecefAltitudeKm(x, y, z)).toBeCloseTo(0, 2);
    const [cx, cy, cz] = geodeticToEcefKm(b.south, b.west);
    expect(Math.hypot(x - cx, y - cy, z - cz)).toBeLessThan(1e-3);
    // Normals are unit vectors pointing outward.
    const n = [normals[0], normals[1], normals[2]];
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
    expect(n[0] * positions[0] + n[1] * positions[1] + n[2] * positions[2]).toBeGreaterThan(0.99);
    // Last vertex: north-east corner, UV (1, 1).
    expect([uvs[48], uvs[49]]).toEqual([1, 1]);
  });

  it("uses the same scene mapping as the trajectory layer", () => {
    const [x, y, z] = geodeticToEcefKm(STARBASE.lat, STARBASE.lon);
    const local = ecefToEarthLocal(x, y, z);
    expect(local[0]).toBeCloseTo(x / 6378.137, 9);
    expect(local[1]).toBeCloseTo(z / 6356.7523142, 9);
    expect(local[2]).toBeCloseTo(-y / 6378.137, 9);
    const back = earthLocalToEcef(...local);
    expect(back[0]).toBeCloseTo(x, 6);
    expect(back[1]).toBeCloseTo(y, 6);
    expect(back[2]).toBeCloseTo(z, 6);
  });
});

describe("load / unload decisions", () => {
  const t = LAUNCH_SITE_LOAD_THRESHOLDS;

  it("loads only when close and low, keeps with hysteresis", () => {
    expect(siteWanted({ distanceKm: 100, altitudeKm: 10 }, false)).toBe(true);
    expect(siteWanted({ distanceKm: 1600, altitudeKm: 10 }, false)).toBe(false);
    expect(siteWanted({ distanceKm: 100, altitudeKm: 1600 }, false)).toBe(false);
    // Between the load and keep radii a resident site stays.
    expect(siteWanted({ distanceKm: 1800, altitudeKm: 1800 }, true)).toBe(true);
    expect(siteWanted({ distanceKm: 2100, altitudeKm: 10 }, true)).toBe(false);
  });

  it("unloads only after the camera has been away for the delay", () => {
    const far = { distanceKm: 5000, altitudeKm: 20000 };
    expect(siteLoadStep({ distanceKm: 10, altitudeKm: 1 }, false, null, 0)).toEqual({ action: "load", outSinceMs: null });
    expect(siteLoadStep(far, false, null, 0)).toEqual({ action: "idle", outSinceMs: null });
    const first = siteLoadStep(far, true, null, 1000);
    expect(first).toEqual({ action: "keep", outSinceMs: 1000 });
    expect(siteLoadStep(far, true, first.outSinceMs, 1000 + t.unloadDelayMs - 1).action).toBe("keep");
    expect(siteLoadStep(far, true, first.outSinceMs, 1000 + t.unloadDelayMs).action).toBe("unload");
    // Coming back in range resets the timer.
    expect(siteLoadStep({ distanceKm: 10, altitudeKm: 1 }, true, 1000, 5000)).toEqual({ action: "keep", outSinceMs: null });
  });

  it("estimates altitude above the ellipsoid", () => {
    const [x, y, z] = geodeticToEcefKm(45, 63, 400);
    expect(ecefAltitudeKm(x, y, z)).toBeCloseTo(400, 0);
    const [px, py, pz] = geodeticToEcefKm(90, 0, 0);
    expect(ecefAltitudeKm(px, py, pz)).toBeCloseTo(0, 3);
  });
});

describe("parseLaunchSiteIndex", () => {
  it("reads the credit and drops malformed entries", () => {
    const index = parseLaunchSiteIndex({
      attribution: "EOxCloudless … 2016",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      year: 2016,
      sites: [
        { id: "a", name: "A", lat: 1, lon: 2, bounds: { west: 1, south: 0, east: 3, north: 2 }, file: "a.jpg", source: "x", year: 2016 },
        { id: "b", name: "B", lat: 1, lon: 2, bounds: { west: 3, south: 0, east: 1, north: 2 }, file: "b.jpg" },
        { id: "c", name: "C", lat: 1, lon: 2, bounds: { west: 1, south: 0, east: 3, north: 2 }, file: "../c.jpg" },
      ],
    });
    expect(index.sites.map((s) => s.id)).toEqual(["a"]);
    expect(index.credit).toEqual({
      year: 2016,
      attribution: "EOxCloudless … 2016",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("treats an empty or missing index as no sites", () => {
    expect(parseLaunchSiteIndex({ sites: [] }).sites).toEqual([]);
    expect(parseLaunchSiteIndex(null).sites).toEqual([]);
  });
});

describe("LaunchSiteImageryLayer", () => {
  const bounds = launchSiteBounds(STARBASE.lat, STARBASE.lon, 80);
  const index = {
    attribution: "credit",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    year: 2016,
    sites: [{ id: "starbase", name: "スターベース", ...STARBASE, bounds, file: "starbase.jpg", source: "EOxCloudless 2016", year: 2016 }],
  };
  const localAt = (lat: number, lon: number, heightKm: number) => new THREE.Vector3(...ecefToEarthLocal(...geodeticToEcefKm(lat, lon, heightKm)));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function makeLayer() {
    const credits: (LaunchSiteImageryCredit | null)[] = [];
    const fetchJson = mock(async () => index);
    const release = mock(() => {});
    const loadImage = mock(async () => ({ image: { width: 4, height: 4 } as unknown as TexImageSource, flipY: false, release }));
    const layer = new LaunchSiteImageryLayer({
      brightEarth: false,
      nightLift: 0.07,
      anisotropy: 1,
      halfResolution: false,
      initTexture: () => {},
      onCreditChange: (c) => credits.push(c),
      fetchJson,
      loadImage,
    });
    return { layer, credits, fetchJson, loadImage, release };
  }

  it("requests nothing while the camera is far away (default whole-globe view)", async () => {
    const { layer, fetchJson, loadImage } = makeLayer();
    layer.update(new THREE.Vector3(0, 0, 3), 0);
    await flush();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(loadImage).not.toHaveBeenCalled();
    expect(layer.group.children.length).toBe(0);
  });

  it("loads near the pad, reports the credit, unloads after leaving, clears on dispose", async () => {
    const { layer, credits, fetchJson, loadImage, release } = makeLayer();
    const pad = localAt(STARBASE.lat, STARBASE.lon, 0.05);
    layer.update(pad, 0);
    await flush();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    layer.update(pad, 16);
    await flush();
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(layer.group.children.length).toBe(1);
    expect(layer.isVisible()).toBe(true);
    expect(credits.at(-1)?.year).toBe(2016);

    // Far away (other side of the globe): kept until the delay has passed.
    const away = localAt(-STARBASE.lat, STARBASE.lon + 180, 20000);
    layer.update(away, 1000);
    expect(layer.group.children.length).toBe(1);
    layer.update(away, 1000 + LAUNCH_SITE_LOAD_THRESHOLDS.unloadDelayMs);
    expect(layer.group.children.length).toBe(0);
    expect(credits.at(-1)).toBeNull();

    // Back again, then dispose: the credit is cleared.
    layer.update(pad, 30_000);
    await flush();
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(layer.isVisible()).toBe(true);
    layer.dispose();
    expect(credits.at(-1)).toBeNull();
    expect(layer.group.children.length).toBe(0);
  });

  it("does not retry a failed image every frame", async () => {
    const fetchJson = mock(async () => index);
    const loadImage = mock(async () => {
      throw new Error("404");
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const layer = new LaunchSiteImageryLayer({
        brightEarth: true,
        nightLift: 0,
        anisotropy: 1,
        halfResolution: false,
        initTexture: () => {},
        fetchJson,
        loadImage,
      });
      const pad = localAt(STARBASE.lat, STARBASE.lon, 1);
      layer.update(pad, 0);
      await flush();
      for (let i = 1; i < 5; i++) {
        layer.update(pad, i * 16);
        await flush();
      }
      expect(loadImage).toHaveBeenCalledTimes(1);
      layer.dispose();
    } finally {
      console.warn = warn;
    }
  });
});
