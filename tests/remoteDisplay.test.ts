import { describe, it, expect } from "bun:test";
import { validateRemoteDisplay } from "../src/lib/remoteDisplay";

describe("validateRemoteDisplay", () => {
  it("accepts and drops the retired showDerivedSatelliteInfo flag", () => {
    expect(validateRemoteDisplay({ showDerivedSatelliteInfo: true, showGraticule: false })).toEqual({
      showGraticule: false,
    });
  });

  it("still type-checks the retired flag", () => {
    expect(() => validateRemoteDisplay({ showDerivedSatelliteInfo: "yes" })).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => validateRemoteDisplay({ nope: true })).toThrow("Unknown display field");
  });

  it("rewrites legacy earth texture paths to mode ids", () => {
    expect(validateRemoteDisplay({ earthTexture: "./assets/earth02.webp" })).toEqual({ earthTexture: "natural-earth" });
    expect(() => validateRemoteDisplay({ earthTexture: "./assets/earth/day-natural-4k.webp" })).toThrow("Unknown earthTexture");
  });

  it("accepts the border and cloud toggles", () => {
    expect(validateRemoteDisplay({ showCountryBorders: true, showClouds: false })).toEqual({ showCountryBorders: true, showClouds: false });
  });

  it("accepts and drops the retired groundConeMinElevationDeg (cones follow each station)", () => {
    expect(validateRemoteDisplay({ groundConeMinElevationDeg: 30, showGraticule: true })).toEqual({ showGraticule: true });
    expect(() => validateRemoteDisplay({ groundConeMinElevationDeg: 120 })).toThrow("0–85");
  });
});
