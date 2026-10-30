// Benchmark for the access analyses with a few hundred satellites.
// Usage: bun scripts/analysis/bench-access.ts [satCount] [--reference]
import { parseConstellationToml } from "../../src/lib/config";
import { calculateStationAccessData } from "../../src/lib/visibility";
import { computeAccessGrid } from "../../src/lib/accessGrid";
import type { GroundStation } from "../../src/lib/groundStations";

const satCount = Number(process.argv[2] ?? 300);
const planes = 15;
const toml = `[constellation]
name = "Bench"
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "bench"
count = ${satCount}
planes = ${planes}
phasing = 1
apogee_altitude = 550
eccentricity = 0.0001
inclination = 53.0
raan_range = 360.0
`;
const sats = parseConstellationToml(toml);
const start = new Date("2025-05-20T00:00:00Z");

const latStations: GroundStation[] = [];
for (let lat = -90; lat <= 90; lat++) {
  latStations.push({ name: `${lat}`, latitudeDeg: lat, longitudeDeg: 0, heightKm: 0, minElevationDeg: 30 });
}
const gs: GroundStation[] = [
  { name: "Tokyo", latitudeDeg: 35.7, longitudeDeg: 139.7, heightKm: 0, minElevationDeg: 10 },
  { name: "Sydney", latitudeDeg: -33.9, longitudeDeg: 151.2, heightKm: 0, minElevationDeg: 10 },
];

function time(label: string, fn: () => unknown) {
  const t0 = performance.now();
  fn();
  console.log(`${label}: ${((performance.now() - t0) / 1000).toFixed(2)} s`);
}

console.log(`${sats.length} satellites`);
const opts = { durationHours: 24, stepSeconds: 10 };
time("station access, computeAccessGrid (2 stations, 24 h, 10 s)", () => computeAccessGrid(sats, gs, start, opts));
time("global access, computeAccessGrid (181 latitudes, 24 h, 10 s)", () => computeAccessGrid(sats, latStations, start, opts));
if (process.argv.includes("--reference")) {
  // The original per-pair implementation, for comparison (slow: minutes for global).
  time("station access, calculateStationAccessData", () => calculateStationAccessData(sats, gs, start, 24, 10));
  time("global access, calculateStationAccessData", () => calculateStationAccessData(sats, latStations, start, 24, 10));
}
