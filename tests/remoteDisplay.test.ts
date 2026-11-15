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

describe("validateRemoteDisplay: attitude fields", () => {
  it("accepts the attitude object, filling missing angles", () => {
    expect(validateRemoteDisplay({ satelliteAttitude: { mode: "sun" } })).toEqual({
      satelliteAttitude: { mode: "sun", inertialRaDeg: 0, inertialDecDeg: 0 },
    });
    expect(validateRemoteDisplay({ satelliteAttitude: { mode: "station", stationName: "Tokyo", inertialRaDeg: 10, inertialDecDeg: -5 } })).toEqual({
      satelliteAttitude: { mode: "station", stationName: "Tokyo", inertialRaDeg: 10, inertialDecDeg: -5 },
    });
  });

  it("accepts an undefined stationName (in-memory snapshots) and drops it", () => {
    expect(validateRemoteDisplay({ satelliteAttitude: { mode: "lvlh", stationName: undefined, inertialRaDeg: 0, inertialDecDeg: 0 } })).toEqual({
      satelliteAttitude: { mode: "lvlh", inertialRaDeg: 0, inertialDecDeg: 0 },
    });
  });

  it("accepts the 運用スケジュール fields", () => {
    expect(validateRemoteDisplay({ satelliteAttitude: { mode: "sun", eclipseMode: "lvlh", trackStationDuringPass: true, stationName: "Tokyo", maxSlewRateDegS: 0.5 } })).toEqual({
      satelliteAttitude: { mode: "sun", stationName: "Tokyo", inertialRaDeg: 0, inertialDecDeg: 0, eclipseMode: "lvlh", trackStationDuringPass: true, maxSlewRateDegS: 0.5 },
    });
    expect(() => validateRemoteDisplay({ satelliteAttitude: { mode: "sun", maxSlewRateDegS: 100 } })).toThrow("maxSlewRateDegS");
  });

  it("rejects bad attitude objects", () => {
    expect(() => validateRemoteDisplay({ satelliteAttitude: null })).toThrow("must be an object");
    expect(() => validateRemoteDisplay({ satelliteAttitude: [] })).toThrow("must be an object");
    expect(() => validateRemoteDisplay({ satelliteAttitude: { mode: "spin" } })).toThrow("satelliteAttitude.mode");
    expect(() => validateRemoteDisplay({ satelliteAttitude: { mode: "inertial", inertialDecDeg: 95 } })).toThrow("inertialDecDeg");
    expect(() => validateRemoteDisplay({ satelliteAttitude: { mode: "station", stationName: 3 } })).toThrow("stationName");
    expect(() => validateRemoteDisplay({ satelliteAttitude: { mode: "lvlh", extra: 1 } })).toThrow("Unknown satelliteAttitude field");
  });

  it("checks the solar array enum and the body overlay toggles", () => {
    expect(validateRemoteDisplay({ solarArrayType: "singleAxis", showBodyAxes: true, showBodySunDirection: false })).toEqual({
      solarArrayType: "singleAxis", showBodyAxes: true, showBodySunDirection: false,
    });
    expect(() => validateRemoteDisplay({ solarArrayType: "dual" })).toThrow("solarArrayType must be one of fixed, singleAxis");
    expect(() => validateRemoteDisplay({ showBodyAxes: 1 })).toThrow("showBodyAxes must be boolean");
    expect(validateRemoteDisplay({ stationAccessUseSatelliteFov: true })).toEqual({ stationAccessUseSatelliteFov: true });
    expect(() => validateRemoteDisplay({ stationAccessUseSatelliteFov: "on" })).toThrow("stationAccessUseSatelliteFov must be boolean");
  });

  it("accepts the 近接 satellite model strings", () => {
    expect(validateRemoteDisplay({ satelliteModel: "satellite-bus" })).toEqual({ satelliteModel: "satellite-bus" });
    expect(validateRemoteDisplay({ satelliteModel: "library:abc123" })).toEqual({ satelliteModel: "library:abc123" });
    expect(() => validateRemoteDisplay({ satelliteModel: "starship-v3-ship" })).toThrow("satelliteModel must be one of");
    expect(() => validateRemoteDisplay({ satelliteModel: "library:../x" })).toThrow("satelliteModel");
  });
});
