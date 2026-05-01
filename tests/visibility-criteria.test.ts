import { describe, expect, it } from "bun:test";
import {
  parseConstellationConfig,
  parseGroundStationsToml,
} from "../src/lib/tomlParsers";
import { passesVisibilityCriteria } from "../src/lib/visibility";

describe("visibility criteria", () => {
  it("parses ground station visibility fields", () => {
    const stations = parseGroundStationsToml(`
[[groundstations]]
name = "Tokyo"
latitudeDeg = 35.6895
longitudeDeg = 139.6917
heightKm = 0
minElevationDeg = 15
visibilityMode = "and"
maxOffNadirDeg = 25
`);

    expect(stations).toHaveLength(1);
    expect(stations[0]).toEqual({
      name: "Tokyo",
      latitudeDeg: 35.6895,
      longitudeDeg: 139.6917,
      heightKm: 0,
      minElevationDeg: 15,
      visibilityMode: "and",
      maxOffNadirDeg: 25,
    });
  });

  it("parses raw constellation shell config without expansion", () => {
    const config = parseConstellationConfig(`
[constellation]
name = "Demo"
epoch = 2026-04-20T00:00:00Z

[[constellation.shells]]
count = 96
planes = 8
apogee_altitude = 600
inclination = 43
`);

    expect(config.epoch.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    expect(config.shells).toHaveLength(1);
    expect(config.shells[0]).toEqual({
      name: undefined,
      count: 96,
      planes: 8,
      phasing: undefined,
      apogee_altitude: 600,
      eccentricity: undefined,
      inclination: 43,
      raan_range: undefined,
      raan_start: undefined,
      argp: undefined,
      mean_anomaly_0: undefined,
    });
  });

  it("supports elevation-only criteria", () => {
    expect(
      passesVisibilityCriteria(Math.PI / 6, Math.PI / 3, {
        minElevationDeg: 20,
        visibilityMode: "elevation_only",
      }),
    ).toBe(true);
    expect(
      passesVisibilityCriteria(Math.PI / 12, Math.PI / 6, {
        minElevationDeg: 20,
        visibilityMode: "elevation_only",
      }),
    ).toBe(false);
  });

  it("supports off-nadir-only criteria", () => {
    expect(
      passesVisibilityCriteria(Math.PI / 18, Math.PI / 9, {
        maxOffNadirDeg: 25,
        visibilityMode: "off_nadir_only",
      }),
    ).toBe(true);
    expect(
      passesVisibilityCriteria(Math.PI / 3, Math.PI / 4, {
        maxOffNadirDeg: 25,
        visibilityMode: "off_nadir_only",
      }),
    ).toBe(false);
  });

  it("supports combined elevation and off-nadir criteria", () => {
    expect(
      passesVisibilityCriteria(Math.PI / 6, Math.PI / 12, {
        minElevationDeg: 20,
        maxOffNadirDeg: 20,
        visibilityMode: "and",
      }),
    ).toBe(true);
    expect(
      passesVisibilityCriteria(Math.PI / 12, Math.PI / 12, {
        minElevationDeg: 20,
        maxOffNadirDeg: 20,
        visibilityMode: "and",
      }),
    ).toBe(false);
    expect(
      passesVisibilityCriteria(Math.PI / 6, Math.PI / 4, {
        minElevationDeg: 20,
        maxOffNadirDeg: 20,
        visibilityMode: "and",
      }),
    ).toBe(false);
  });
});
