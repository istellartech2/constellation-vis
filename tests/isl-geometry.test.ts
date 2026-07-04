import { describe, expect, it } from "bun:test";
import {
  EARTH_RADIUS_EQUATOR_KM,
  elevationRad,
  hasLineOfSight,
  linkDistanceKm,
  remainingLinkTime,
} from "../src/lib/isl/geometry";

const R_E = EARTH_RADIUS_EQUATOR_KM;
const LEO_ALT_KM = 550;
const LEO_R_KM = R_E + LEO_ALT_KM;
const GEO_R_KM = 42164;

function leoAtAngleDeg(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: LEO_R_KM * Math.cos(rad), y: LEO_R_KM * Math.sin(rad), z: 0 };
}

function geoAtAngleDeg(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: GEO_R_KM * Math.cos(rad), y: GEO_R_KM * Math.sin(rad), z: 0 };
}

describe("isl geometry", () => {
  describe("hasLineOfSight", () => {
    it("holds for nearby LEO satellites on the same orbital plane (10 deg apart)", () => {
      const a = leoAtAngleDeg(0);
      const b = leoAtAngleDeg(10);
      expect(hasLineOfSight(a, b, 80)).toBe(true);
    });

    it("fails for antipodal LEO satellites (Earth occlusion)", () => {
      const a = leoAtAngleDeg(0);
      const b = leoAtAngleDeg(180);
      expect(hasLineOfSight(a, b, 80)).toBe(false);
    });

    it("flips across the grazing-margin boundary", () => {
      const marginKm = 80;
      const limit = R_E + marginKm;
      // Place two points symmetric about the x-axis such that the segment's
      // closest approach to the origin is exactly `dist`.
      const halfChordAtLimit = (dist: number) => {
        // For points at (x0, +-h, 0) with x0 chosen so midpoint distance = dist,
        // use points at (dist, +-H, 0) with large H so the segment's closest
        // point to the origin is (dist, 0, 0) at t=0.5.
        return { a: { x: dist, y: -1000, z: 0 }, b: { x: dist, y: 1000, z: 0 } };
      };

      const inside = halfChordAtLimit(limit - 1);
      const outside = halfChordAtLimit(limit + 1);
      expect(hasLineOfSight(inside.a, inside.b, marginKm)).toBe(false);
      expect(hasLineOfSight(outside.a, outside.b, marginKm)).toBe(true);
    });

    it("uses the clamped segment, not the infinite line", () => {
      // Two close points on the same side, far from Earth; the infinite line
      // through them would cross the Earth on the opposite side, but the
      // segment itself never approaches the origin.
      const a = { x: LEO_R_KM, y: 0, z: 0 };
      const b = { x: LEO_R_KM, y: 50, z: 0 };
      expect(hasLineOfSight(a, b, 80)).toBe(true);
    });

    it("holds for GEO-GEO satellites 90 deg apart", () => {
      const a = geoAtAngleDeg(0);
      const b = geoAtAngleDeg(90);
      expect(hasLineOfSight(a, b, 80)).toBe(true);
    });

    it("fails for GEO-GEO satellites 165 deg apart (beyond geometric limit)", () => {
      const a = geoAtAngleDeg(0);
      const b = geoAtAngleDeg(165);
      expect(hasLineOfSight(a, b, 80)).toBe(false);
    });
  });

  describe("linkDistanceKm / max range", () => {
    it("is on the correct side of d_max +- epsilon", () => {
      const dMax = 5000;
      const a = { x: 0, y: 0, z: 0 };
      const insideB = { x: dMax - 1, y: 0, z: 0 };
      const outsideB = { x: dMax + 1, y: 0, z: 0 };
      expect(linkDistanceKm(a, insideB)).toBeLessThan(dMax);
      expect(linkDistanceKm(a, outsideB)).toBeGreaterThan(dMax);
    });
  });

  describe("elevationRad", () => {
    it("returns ~90 deg for a satellite directly overhead", () => {
      // Observer at the ECF equator, longitude 0 (height 0). Satellite directly
      // above along +x at LEO altitude.
      const observer = { longitude: 0, latitude: 0, height: 0 };
      const satEcf = { x: LEO_R_KM, y: 0, z: 0 };
      const elevDeg = (elevationRad(observer, satEcf) * 180) / Math.PI;
      expect(elevDeg).toBeCloseTo(90, 0);
    });

    it("returns a low/negative elevation for a satellite near the horizon", () => {
      const observer = { longitude: 0, latitude: 0, height: 0 };
      // Satellite far around the Earth from the observer, still same altitude.
      const satEcf = leoAtAngleDeg(80);
      const elevDeg = (elevationRad(observer, satEcf) * 180) / Math.PI;
      expect(elevDeg).toBeLessThan(10);
    });
  });

  describe("remainingLinkTime", () => {
    it("returns 0 when the edge doesn't even exist at t=0", () => {
      const tau = remainingLinkTime(() => false, 300, 10);
      expect(tau).toBe(0);
    });

    it("returns the full horizon when the edge never breaks", () => {
      const tau = remainingLinkTime(() => true, 300, 10);
      expect(tau).toBe(300);
    });

    it("binary-searches to the exact breaking instant within the bracketing step", () => {
      const breaksAt = 137.4; // deliberately not a multiple of the 10 s step
      const tau = remainingLinkTime((dt) => dt < breaksAt, 300, 10);
      expect(tau).toBeGreaterThanOrEqual(130); // coarse sample just before the break
      expect(tau).toBeLessThanOrEqual(breaksAt);
      expect(tau).toBeCloseTo(breaksAt, 3); // refined by binary search to ~1e-4 s
    });

    it("returns the horizon (not a bracketed refinement) when the edge is still holding exactly at the horizon", () => {
      const tau = remainingLinkTime((dt) => dt <= 300, 300, 10);
      expect(tau).toBe(300);
    });
  });
});
