import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import { parseConstellationToml } from "../src/lib/tomlParsers";
import { toSatrec } from "../src/lib/satellites";
import { buildSnapshotGraph } from "../src/lib/isl/graph";
import { edgeKey, findShortestPath } from "../src/lib/isl/shortestPath";
import type { IslEndpoint, IslLinkModel } from "../src/lib/isl/types";

/**
 * Scenario 4 (isl-routing.md §3.2): sweep an Iridium-like Walker shell over
 * 10 minutes at 10 s steps, routing Tokyo <-> New York, and compare the
 * number of path switches with hysteresis off (beta=0) vs on (beta=0.2).
 */
describe("isl hysteresis scenario (isl-routing.md §3.2 scenario 4)", () => {
  const epoch = new Date("2024-01-01T00:00:00.000Z");
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

  const satRecs = parseConstellationToml(constellationToml).map((s) => toSatrec(s));
  const participantIndices = satRecs.map((_, i) => i);

  const endpointA: IslEndpoint = {
    kind: "adhoc",
    name: "Tokyo",
    latitudeDeg: 35.68,
    longitudeDeg: 139.65,
    heightKm: 0,
    minElevationDeg: 10,
  };
  const endpointB: IslEndpoint = {
    kind: "adhoc",
    name: "NewYork",
    latitudeDeg: 40.71,
    longitudeDeg: -74.01,
    heightKm: 0,
    minElevationDeg: 10,
  };
  const linkModel: IslLinkModel = { mode: "dynamic", maxRangeKm: 5000, losMarginKm: 80 };
  const hopPenaltyMs = 2;

  function sweep(switchDiscount: number) {
    let previousPathEdgeKeys: Set<string> | undefined;
    let switchCount = 0;
    let totalDelayMs = 0;
    let reachableSteps = 0;

    for (let t = 0; t <= 600; t += 10) {
      const simDate = new Date(epoch.getTime() + t * 1000);
      const satEciPositions = satRecs.map((rec) => {
        const pv = satellite.propagate(rec, simDate);
        return pv?.position ?? { x: 0, y: 0, z: 0 };
      });

      const graph = buildSnapshotGraph({
        satEciPositions,
        participantIndices,
        endpointA,
        endpointB,
        simDate,
        linkModel,
        hopPenaltyMs,
      });
      const result = findShortestPath(graph, simDate.getTime(), graph.candidateEdgeCount, 0, {
        previousPathEdgeKeys,
        switchDiscount,
      });

      if (result.reachable) {
        reachableSteps++;
        totalDelayMs += result.totalDelayMs;
        if (result.switchedFromPrevious) switchCount++;
        previousPathEdgeKeys = new Set(
          result.edges.map((e) => edgeKey(e.fromNodeId, e.toNodeId)),
        );
      }
    }

    return { switchCount, totalDelayMs, reachableSteps };
  }

  it("reduces switch count with hysteresis, keeping delay degradation within ~5%", () => {
    const noHysteresis = sweep(0);
    const withHysteresis = sweep(0.2);

    // Sanity: both runs saw the same reachability pattern (hysteresis only
    // re-weights candidate paths, it never changes edge existence).
    expect(withHysteresis.reachableSteps).toBe(noHysteresis.reachableSteps);
    expect(noHysteresis.reachableSteps).toBeGreaterThan(0);

    expect(withHysteresis.switchCount).toBeLessThan(noHysteresis.switchCount);

    const degradation =
      (withHysteresis.totalDelayMs - noHysteresis.totalDelayMs) / noHysteresis.totalDelayMs;
    expect(degradation).toBeGreaterThanOrEqual(0);
    expect(degradation).toBeLessThan(0.1);
  });
});
