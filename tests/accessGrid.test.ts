import { describe, expect, it } from "bun:test";
import { parseConstellationToml } from "../src/lib/config";
import { calculateStationAccessData } from "../src/lib/visibility";
import { computeAccessGrid, gridStationCounts, gridToSamples } from "../src/lib/accessGrid";
import type { GroundStation } from "../src/lib/groundStations";

const sats = parseConstellationToml(`[constellation]
name = "T"
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "t"
count = 40
planes = 4
phasing = 1
apogee_altitude = 550
eccentricity = 0.001
inclination = 53.0
raan_range = 360.0
`);
const start = new Date("2025-05-20T00:00:00Z");
const stations: GroundStation[] = [
  { name: "Tokyo", latitudeDeg: 35.7, longitudeDeg: 139.7, heightKm: 0, minElevationDeg: 10 },
  { name: "Neg", latitudeDeg: 0, longitudeDeg: -60, heightKm: 0.2, minElevationDeg: -2 },
  { name: "And", latitudeDeg: -33.9, longitudeDeg: 151.2, heightKm: 0.1, minElevationDeg: 25, visibilityMode: "and", maxOffNadirDeg: 50 },
  { name: "Off", latitudeDeg: 64, longitudeDeg: -20, heightKm: 0, visibilityMode: "off_nadir_only", maxOffNadirDeg: 40 },
];

function referenceCounts(fov?: Parameters<typeof calculateStationAccessData>[5], stepSeconds = 10) {
  return calculateStationAccessData(sats, stations, start, 3, stepSeconds, fov);
}

describe("computeAccessGrid", () => {
  for (const [label, fov] of [
    ["station criteria only", undefined],
    ["with tilted satellite FOV", { halfAngleDeg: 40, alongTrackDeg: 10, crossTrackDeg: -5 }],
  ] as const) {
    it(`matches calculateStationAccessData (${label}, interpolated 10 s steps)`, () => {
      const ref = referenceCounts(fov);
      const grid = computeAccessGrid(sats, stations, start, { durationHours: 3, stepSeconds: 10, fov });
      expect(grid.stepCount).toBe(ref.length);
      let mismatched = 0;
      ref.forEach((sample, i) =>
        sample.stations.forEach((entry, gi) => {
          if (entry.visibleCount !== grid.counts[i * grid.stationCount + gi]) mismatched++;
        }),
      );
      // Hermite interpolation is sub-metre; allow a grazing-threshold flip or two.
      expect(mismatched).toBeLessThanOrEqual(2);
    });
  }

  it("matches exactly when the step is at the knot spacing (direct propagation)", () => {
    const ref = referenceCounts(undefined, 60);
    const grid = computeAccessGrid(sats, stations, start, { durationHours: 3, stepSeconds: 60 });
    ref.forEach((sample, i) =>
      sample.stations.forEach((entry, gi) => expect(grid.counts[i * grid.stationCount + gi]).toBe(entry.visibleCount)),
    );
  });

  it("latitude-band pruning loses no visible station (181 latitudes, mixed elevation masks)", () => {
    const probes: GroundStation[] = [];
    for (let lat = -90; lat <= 90; lat++) {
      probes.push({
        name: `${lat}`,
        latitudeDeg: lat,
        longitudeDeg: (lat * 7) % 360 - 180,
        heightKm: (lat + 90) % 3,
        minElevationDeg: [30, 0, -5, 60][(lat + 90) % 4],
      });
    }
    const ref = calculateStationAccessData(sats, probes, start, 3, 60);
    const grid = computeAccessGrid(sats, probes, start, { durationHours: 3, stepSeconds: 60 });
    let mismatched = 0;
    ref.forEach((sample, i) =>
      sample.stations.forEach((entry, gi) => {
        if (entry.visibleCount !== grid.counts[i * grid.stationCount + gi]) mismatched++;
      }),
    );
    expect(mismatched).toBe(0);
  });

  it("reports progress up to 1 and exposes per-station and averaged views", () => {
    const fractions: number[] = [];
    const grid = computeAccessGrid(sats, stations, start, {
      durationHours: 1,
      stepSeconds: 10,
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions.at(-1)).toBe(1);
    const tokyo = gridStationCounts(grid, 0);
    expect(tokyo.length).toBe(grid.stepCount);
    const averaged = gridToSamples(grid, stations.map((s) => s.name), 6);
    expect(averaged.length).toBe(Math.ceil(grid.stepCount / 6));
    const firstMean = Array.from(tokyo.slice(0, 6)).reduce((a, b) => a + b, 0) / 6;
    expect(averaged[0].stations[0].visibleCount).toBeCloseTo(firstMean, 10);
  });
});
