import {
  formatDurationMinutes,
  formatLatitude,
  formatLongitude,
  getSatelliteDerivedInfo,
  isInEarthShadow,
} from "./satelliteDerivedInfo";
import type { SatelliteSpec } from "./satellites";

const leoSpec: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 99901,
    epoch: new Date("2025-01-01T00:00:00Z"),
    semiMajorAxisKm: 6878.137,
    eccentricity: 0.001,
    inclinationDeg: 97.4,
    raanDeg: 15,
    argPerigeeDeg: 25,
    meanAnomalyDeg: 40,
  },
};

const ellipticalSpec: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 99902,
    epoch: new Date("2025-01-01T00:00:00Z"),
    semiMajorAxisKm: 26600,
    eccentricity: 0.72,
    inclinationDeg: 63.4,
    raanDeg: 90,
    argPerigeeDeg: 270,
    meanAnomalyDeg: 0,
  },
};

const eclipsingLeoSpec: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 99903,
    epoch: new Date("2025-01-01T00:00:00Z"),
    semiMajorAxisKm: 6778.137,
    eccentricity: 0.001,
    inclinationDeg: 51.6,
    raanDeg: 0,
    argPerigeeDeg: 0,
    meanAnomalyDeg: 0,
  },
};

describe("satelliteDerivedInfo", () => {
  it("computes stable derived values for a LEO satellite", () => {
    const result = getSatelliteDerivedInfo(leoSpec, new Date("2025-01-01T00:30:00Z"));

    expect(result.periodMinutes).toBeGreaterThan(90);
    expect(result.periodMinutes).toBeLessThan(100);
    expect(result.orbitsPerDay).toBeCloseTo(1440 / result.periodMinutes, 6);
    expect(result.perigeeAltitudeKm).toBeGreaterThan(480);
    expect(result.perigeeAltitudeKm).toBeLessThan(510);
    expect(result.apogeeAltitudeKm).toBeGreaterThan(result.perigeeAltitudeKm);
    expect(result.apogeeAltitudeKm).toBeLessThan(520);
    expect(result.currentAltitudeKm).not.toBeNull();
    expect(result.eciSpeedKmPerSec).not.toBeNull();
    expect(result.latitudeDeg).not.toBeNull();
    expect(result.longitudeDeg).not.toBeNull();
  });

  it("separates perigee and apogee for an elliptical orbit", () => {
    const result = getSatelliteDerivedInfo(ellipticalSpec, new Date("2025-01-01T00:00:00Z"));

    expect(result.apogeeAltitudeKm).toBeGreaterThan(result.perigeeAltitudeKm);
    expect(result.apogeeAltitudeKm - result.perigeeAltitudeKm).toBeGreaterThan(30000);
  });

  it("keeps eclipse stats in sane ranges", () => {
    const result = getSatelliteDerivedInfo(eclipsingLeoSpec, new Date("2025-01-01T00:30:00Z"));

    expect(result.eclipseMinutes).not.toBeNull();
    expect(result.eclipseRatio).not.toBeNull();
    expect(result.eclipseMinutes!).toBeGreaterThanOrEqual(0);
    expect(result.eclipseMinutes!).toBeLessThanOrEqual(result.periodMinutes + 1);
    expect(result.eclipseRatio!).toBeGreaterThanOrEqual(0);
    expect(result.eclipseRatio!).toBeLessThanOrEqual(1);
  });

  it("returns valid future lighting transition values when found", () => {
    const result = getSatelliteDerivedInfo(eclipsingLeoSpec, new Date("2025-01-01T00:30:00Z"));

    expect(result.timeToNextEclipseStartMinutes).not.toBeNull();
    expect(result.timeToNextSunlightReturnMinutes).not.toBeNull();
    expect(result.timeToNextEclipseStartMinutes!).toBeGreaterThan(10);
    expect(result.timeToNextSunlightReturnMinutes!).toBeGreaterThan(0);
    expect(result.timeToNextSunlightReturnMinutes!).toBeLessThan(result.timeToNextEclipseStartMinutes!);
  });

  it("keeps eclipse duration stable across nearby times", () => {
    const first = getSatelliteDerivedInfo(eclipsingLeoSpec, new Date("2025-01-01T00:20:00Z"));
    const second = getSatelliteDerivedInfo(eclipsingLeoSpec, new Date("2025-01-01T00:20:30Z"));

    expect(first.eclipseMinutes).not.toBeNull();
    expect(second.eclipseMinutes).not.toBeNull();
    expect(Math.abs(first.eclipseMinutes! - second.eclipseMinutes!)).toBeLessThan(0.1);
  });

  it("formats durations and geodetic coordinates for display", () => {
    expect(formatDurationMinutes(125)).toBe("2 h 5 min");
    expect(formatDurationMinutes(42)).toBe("42 min");
    expect(formatLatitude(35.68)).toBe("35.68° N");
    expect(formatLatitude(-12.3)).toBe("12.30° S");
    expect(formatLongitude(139.76)).toBe("139.76° E");
    expect(formatLongitude(-77.04)).toBe("77.04° W");
  });

  it("detects simple day/night geometry for idealized vectors", () => {
    expect(isInEarthShadow({ x: -7000, y: 0, z: 0 }, new Date("2025-03-20T00:00:00Z"))).toBe(true);
    expect(isInEarthShadow({ x: 7000, y: 0, z: 0 }, new Date("2025-03-20T00:00:00Z"))).toBe(false);
  });
});
