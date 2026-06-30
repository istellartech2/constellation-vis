import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates the Japanese sea-lane KML deliverables under public/kml/.
 *
 * These files are loaded through the in-app KML overlay feature. The tests run
 * in Bun (no DOM), so coordinates are extracted with a small regex rather than
 * the browser-only DOMParser used by src/lib/kml.ts. The end-to-end parse and
 * render pipeline is verified separately in the browser preview.
 */

interface Coord {
  lon: number;
  lat: number;
  alt: number;
}

function parseKmlFile(name: string): {
  raw: string;
  lineStringCount: number;
  color: string | null;
  width: number | null;
  coords: Coord[];
} {
  const raw = readFileSync(join(import.meta.dir, "..", "public", "kml", name), "utf-8");

  const lineStringCount = (raw.match(/<LineString>/g) ?? []).length;
  const color = raw.match(/<color>([0-9a-fA-F]{8})<\/color>/)?.[1] ?? null;
  const width = raw.match(/<width>([\d.]+)<\/width>/) ? Number(raw.match(/<width>([\d.]+)<\/width>/)![1]) : null;

  const coordBlock = raw.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1] ?? "";
  const coords: Coord[] = coordBlock
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const [lon, lat, alt = "0"] = token.split(",");
      return { lon: Number(lon), lat: Number(lat), alt: Number(alt) };
    });

  return { raw, lineStringCount, color, width, coords };
}

const HORMUZ = { lon: 56.3, lat: 26.6 };
const TOKYO_BAY = { lon: 139.8, lat: 35.0 };

// Each route must pass through its named strait (approximate gateway coords).
const ROUTES = [
  { file: "sealane_malacca.kml", strait: { lon: 101.3, lat: 2.7 }, points: 45 },
  { file: "sealane_sunda.kml", strait: { lon: 105.5, lat: -6.0 }, points: 43 },
  { file: "sealane_lombok.kml", strait: { lon: 115.7, lat: -8.5 }, points: 41 },
];

function near(a: { lon: number; lat: number }, b: { lon: number; lat: number }, tol = 0.01): boolean {
  return Math.abs(a.lon - b.lon) <= tol && Math.abs(a.lat - b.lat) <= tol;
}

function distanceDeg(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return Math.hypot(a.lon - b.lon, a.lat - b.lat);
}

describe("Japanese sea-lane KML files", () => {
  for (const route of ROUTES) {
    describe(route.file, () => {
      const kml = parseKmlFile(route.file);

      it("declares a single pale-red, width-5 LineString", () => {
        expect(kml.lineStringCount).toBe(1);
        // KML color is aabbggrr: 800000ff == 50%-opacity (pale) red.
        expect(kml.color).toBe("800000ff");
        expect(kml.width).toBe(5);
      });

      it("has the expected number of waypoints", () => {
        expect(kml.coords.length).toBe(route.points);
      });

      it("uses valid longitude/latitude for every waypoint", () => {
        for (const c of kml.coords) {
          expect(Number.isFinite(c.lon)).toBe(true);
          expect(Number.isFinite(c.lat)).toBe(true);
          expect(c.lon).toBeGreaterThanOrEqual(-180);
          expect(c.lon).toBeLessThanOrEqual(180);
          expect(c.lat).toBeGreaterThanOrEqual(-90);
          expect(c.lat).toBeLessThanOrEqual(90);
        }
      });

      it("starts at the Strait of Hormuz and ends at Tokyo Bay", () => {
        expect(near(kml.coords[0], HORMUZ)).toBe(true);
        expect(near(kml.coords[kml.coords.length - 1], TOKYO_BAY)).toBe(true);
      });

      it("passes through its named strait", () => {
        const closest = Math.min(...kml.coords.map((c) => distanceDeg(c, route.strait)));
        // Within ~0.5° (~55 km) of the strait gateway.
        expect(closest).toBeLessThanOrEqual(0.5);
      });
    });
  }
});
