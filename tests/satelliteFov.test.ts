/**
 * Satellite-FOV visibility criterion (`src/lib/visibility.ts`).
 *
 * The risky part is the reference frame: the sensor model is built in LVLH
 * from ECI state vectors, while the station lives in ECF. At zero tilt the
 * boresight is nadir, which is frame-symmetric — a frame or sign bug would go
 * unnoticed. Every test below therefore uses a *non-zero* tilt, where getting
 * the frame or the sign wrong flips the answer.
 */
import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import {
  calculateStationAccessData,
  computeFovBoresightEcf,
  withinSatelliteFov,
} from "../src/lib/visibility";
import type { GroundStation } from "../src/lib/groundStations";
import type { SatelliteSpec } from "../src/lib/satellites";

const RE = 6378.137;

/** Equatorial prograde state: over longitude 0 (at gmst = 0), heading +Y. */
const POSITION = { x: 7000, y: 0, z: 0 };
const VELOCITY = { x: 0, y: 7.546, z: 0 };

/**
 * Station on the equator, `phiDeg` of geocentric arc ahead of the satellite
 * (+ = along the velocity direction). phi = 2 deg puts it ~19.6 deg off nadir.
 */
function stationAhead(phiDeg: number) {
  const phi = (phiDeg * Math.PI) / 180;
  return { x: RE * Math.cos(phi), y: RE * Math.sin(phi), z: 0 };
}

/** Station on the meridian, `phiDeg` toward +Z (the orbit normal here). */
function stationNorth(phiDeg: number) {
  const phi = (phiDeg * Math.PI) / 180;
  return { x: RE * Math.cos(phi), y: 0, z: RE * Math.sin(phi) };
}

function boresight(alongTrackDeg: number, crossTrackDeg: number, gmst = 0) {
  const b = computeFovBoresightEcf(POSITION, VELOCITY, gmst, {
    halfAngleDeg: 15,
    alongTrackDeg,
    crossTrackDeg,
  });
  if (!b) throw new Error("degenerate boresight");
  return b;
}

describe("computeFovBoresightEcf", () => {
  it("points at nadir with no tilt", () => {
    const b = boresight(0, 0);
    expect(b.x).toBeCloseTo(-1, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.z).toBeCloseTo(0, 6);
  });

  it("tilts toward the velocity direction for a positive along-track angle", () => {
    const b = boresight(20, 0);
    expect(b.x).toBeCloseTo(-Math.cos((20 * Math.PI) / 180), 6);
    expect(b.y).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
    expect(b.z).toBeCloseTo(0, 6);
  });

  it("tilts toward the orbit normal for a positive cross-track angle", () => {
    const b = boresight(0, 20);
    expect(b.x).toBeCloseTo(-Math.cos((20 * Math.PI) / 180), 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.z).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
  });

  it("rotates with gmst, so the boresight stays fixed relative to the ground", () => {
    const gmst = Math.PI / 2;
    const b = boresight(20, 0, gmst);
    const expected = satellite.eciToEcf(
      {
        x: -Math.cos((20 * Math.PI) / 180),
        y: Math.sin((20 * Math.PI) / 180),
        z: 0,
      },
      gmst,
    );
    expect(b.x).toBeCloseTo(expected.x, 6);
    expect(b.y).toBeCloseTo(expected.y, 6);
    expect(b.z).toBeCloseTo(expected.z, 6);
  });
});

describe("withinSatelliteFov", () => {
  const station = stationAhead(2); // ~19.6 deg off nadir, ahead of the satellite

  it("excludes a station outside the nadir-pointing cone", () => {
    expect(withinSatelliteFov(POSITION, station, boresight(0, 0), 15)).toBe(false);
  });

  it("includes it once the boresight is tilted forward onto it", () => {
    expect(withinSatelliteFov(POSITION, station, boresight(20, 0), 15)).toBe(true);
  });

  it("excludes it when the boresight is tilted the other way (sign check)", () => {
    expect(withinSatelliteFov(POSITION, station, boresight(-20, 0), 15)).toBe(false);
  });

  it("distinguishes the cross-track sign the same way", () => {
    const north = stationNorth(2);
    expect(withinSatelliteFov(POSITION, north, boresight(0, 20), 15)).toBe(true);
    expect(withinSatelliteFov(POSITION, north, boresight(0, -20), 15)).toBe(false);
    // An along-track tilt does not help a cross-track offset.
    expect(withinSatelliteFov(POSITION, north, boresight(20, 0), 15)).toBe(false);
  });

  it("with zero tilt it is exactly a nadir off-nadir limit", () => {
    // phi = 2 deg is 19.63 deg off nadir, so 20 deg passes and 19 deg does not.
    expect(withinSatelliteFov(POSITION, station, boresight(0, 0), 20)).toBe(true);
    expect(withinSatelliteFov(POSITION, station, boresight(0, 0), 19)).toBe(false);
  });
});

describe("calculateStationAccessData with a FOV", () => {
  const sats: SatelliteSpec[] = [
    {
      type: "elements",
      elements: {
        satnum: 1,
        epoch: new Date("2025-05-20T00:00:00Z"),
        semiMajorAxisKm: 6928.137,
        eccentricity: 0,
        inclinationDeg: 53,
        raanDeg: 0,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
      },
    },
  ];
  const stations: GroundStation[] = [
    {
      name: "Tokyo",
      latitudeDeg: 35.6895,
      longitudeDeg: 139.6917,
      heightKm: 0,
      minElevationDeg: 5,
    },
  ];
  const start = new Date("2025-05-20T00:00:00Z");

  const total = (fovHalfAngle?: number) =>
    calculateStationAccessData(
      sats,
      stations,
      start,
      24,
      30,
      fovHalfAngle === undefined
        ? undefined
        : { halfAngleDeg: fovHalfAngle, alongTrackDeg: 0, crossTrackDeg: 0 },
    ).reduce((sum, sample) => sum + sample.stations[0].visibleCount, 0);

  it("narrowing the cone monotonically removes contacts", () => {
    const baseline = total();
    expect(baseline).toBeGreaterThan(0);
    expect(total(60)).toBeLessThan(baseline);
    expect(total(30)).toBeLessThanOrEqual(total(60));
    expect(total(10)).toBeLessThanOrEqual(total(30));
  });

  it("a cone wide enough to reach the horizon changes nothing", () => {
    // At 550 km the Earth's angular radius seen from the satellite is ~66 deg,
    // so an 89 deg half-angle cone can never be the binding constraint.
    expect(total(89)).toBe(total());
  });

  it("a pencil beam removes every contact at this sampling rate", () => {
    expect(total(1)).toBe(0);
  });
});
