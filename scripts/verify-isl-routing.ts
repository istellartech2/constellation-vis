/**
 * ISL routing regression check — isl-routing.md §3.2 scenario 2 (Iridium-like
 * Walker order-of-magnitude check). Run with: bun run scripts/verify-isl-routing.ts
 *
 * 66 satellites (6 planes x 11), 780 km altitude, 86.4 deg inclination, routing
 * Tokyo <-> New York. Checks that the resulting path delay sits between the
 * great-circle lower bound (~36.2 ms) and 2x that bound, and that the hop
 * count is in the few-to-tens range expected for this constellation size.
 */
import * as satellite from "satellite.js";
import { parseConstellationToml } from "../src/lib/tomlParsers";
import { toSatrec } from "../src/lib/satellites";
import { buildSnapshotGraph } from "../src/lib/isl/graph";
import { findShortestPath } from "../src/lib/isl/shortestPath";
import type { IslEndpoint, IslLinkModel } from "../src/lib/isl/types";

const SPEED_OF_LIGHT_KM_PER_S = 299792.458;
const EARTH_RADIUS_KM = 6378.137;

const constellationToml = `
[constellation]
name = "iridium-like"
epoch = 2024-01-01T00:00:00Z

[[constellation.shells]]
name = "iridium-like"
count = 66
planes = 6
phasing = 1
apogee_altitude = 780
eccentricity = 0.0
inclination = 86.4
`;

const TOKYO: IslEndpoint = {
  kind: "adhoc",
  name: "Tokyo",
  latitudeDeg: 35.68,
  longitudeDeg: 139.65,
  heightKm: 0,
  minElevationDeg: 10,
};
const NEW_YORK: IslEndpoint = {
  kind: "adhoc",
  name: "New York",
  latitudeDeg: 40.71,
  longitudeDeg: -74.01,
  heightKm: 0,
  minElevationDeg: 10,
};

/** Great-circle distance [km] between two geodetic points (haversine, spherical Earth). */
function greatCircleDistanceKm(a: IslEndpoint, b: IslEndpoint): number {
  const lat1 = (a.latitudeDeg * Math.PI) / 180;
  const lat2 = (b.latitudeDeg * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitudeDeg - a.longitudeDeg) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function computeAt(satRecs: satellite.SatRec[], simDate: Date) {
  const participantIndices = satRecs.map((_, i) => i);
  const satEciPositions = satRecs.map((rec) => {
    const pv = satellite.propagate(rec, simDate);
    return pv?.position ?? { x: 0, y: 0, z: 0 };
  });

  const linkModel: IslLinkModel = { mode: "dynamic", maxRangeKm: 5000, losMarginKm: 80 };
  const graph = buildSnapshotGraph({
    satEciPositions,
    participantIndices,
    endpointA: TOKYO,
    endpointB: NEW_YORK,
    simDate,
    linkModel,
    hopPenaltyMs: 2,
  });
  return findShortestPath(graph, simDate.getTime(), graph.candidateEdgeCount, 0);
}

function main() {
  const epoch = new Date("2024-01-01T00:00:00.000Z");
  const satRecs = parseConstellationToml(constellationToml).map((s) => toSatrec(s));

  // Reachability between two fixed ground points depends on the exact
  // satellite geometry at a given instant (topology changes on a
  // seconds-to-minutes timescale, §1.3.1) — scan a 10-minute window and
  // verify at the first reachable instant found.
  let simDate: Date | null = null;
  let result: ReturnType<typeof computeAt> | null = null;
  for (let t = 0; t <= 600; t += 10) {
    const candidateDate = new Date(epoch.getTime() + t * 1000);
    const candidateResult = computeAt(satRecs, candidateDate);
    if (candidateResult.reachable) {
      simDate = candidateDate;
      result = candidateResult;
      break;
    }
  }

  if (!simDate || !result) {
    console.error("FAILED: no reachable instant found in the 10-minute scan window.");
    process.exit(1);
  }

  console.log(`evaluated at: ${simDate.toISOString()} (first reachable instant in a 10-min scan)`);

  const greatCircleKm = greatCircleDistanceKm(TOKYO, NEW_YORK);
  const lowerBoundMs = (greatCircleKm / SPEED_OF_LIGHT_KM_PER_S) * 1000;
  const upperBoundMs = lowerBoundMs * 2;

  console.log(`great-circle distance: ${greatCircleKm.toFixed(1)} km`);
  console.log(`lower bound (great-circle / c): ${lowerBoundMs.toFixed(2)} ms`);
  console.log(`upper bound (2x lower bound):   ${upperBoundMs.toFixed(2)} ms`);
  console.log(`reachable: ${result.reachable}`);

  const failures: string[] = [];
  if (!result.reachable) {
    failures.push("path not reachable (expected Tokyo <-> New York to be routable via this constellation)");
  } else {
    console.log(`total delay: ${result.totalDelayMs.toFixed(2)} ms`);
    console.log(`hop count:   ${result.hopCount}`);
    console.log(`total dist:  ${result.totalDistanceKm.toFixed(1)} km`);

    if (result.totalDelayMs < lowerBoundMs) {
      failures.push(
        `total delay ${result.totalDelayMs.toFixed(2)} ms is below the physical lower bound ${lowerBoundMs.toFixed(2)} ms`,
      );
    }
    if (result.totalDelayMs > upperBoundMs) {
      failures.push(
        `total delay ${result.totalDelayMs.toFixed(2)} ms exceeds the 2x lower-bound target ${upperBoundMs.toFixed(2)} ms`,
      );
    }
    if (result.hopCount < 1 || result.hopCount > 30) {
      failures.push(`hop count ${result.hopCount} is outside the expected few-to-tens order of magnitude`);
    }
  }

  if (failures.length > 0) {
    console.error("\nFAILED:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("\nOK: scenario 2 (isl-routing.md §3.2) checks passed.");
}

main();
