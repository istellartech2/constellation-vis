import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import { buildSnapshotGraph } from "../src/lib/isl/graph";
import { findShortestPath } from "../src/lib/isl/shortestPath";
import {
  endpointANodeId,
  endpointBNodeId,
  type IslEndpoint,
  type IslLinkModel,
  type IslShellRange,
} from "../src/lib/isl/types";

const GEO_R_KM = 42164;
const EARTH_RADIUS_EQUATOR_KM = 6378.137;

describe("isl graph", () => {
  it("builds GSL/ISL edges with expected costs for a deterministic GEO layout", () => {
    const simDate = new Date("2024-01-01T00:00:00.000Z");
    const gmst = satellite.gstime(simDate);

    const endpointA: IslEndpoint = {
      kind: "adhoc",
      name: "A",
      latitudeDeg: 0,
      longitudeDeg: 0,
      heightKm: 0,
      minElevationDeg: 0,
    };
    const endpointB: IslEndpoint = {
      kind: "adhoc",
      name: "B",
      latitudeDeg: 0,
      longitudeDeg: 90,
      heightKm: 0,
      minElevationDeg: 0,
    };

    // Place satellites directly overhead each endpoint using the same
    // geodeticToEcf -> ecfToEci transform the graph builder applies to stations,
    // just scaled out to GEO radius.
    const overheadEci = (endpoint: IslEndpoint, radiusKm: number) => {
      const observer = {
        longitude: satellite.degreesToRadians(endpoint.longitudeDeg),
        latitude: satellite.degreesToRadians(endpoint.latitudeDeg),
        height: endpoint.heightKm,
      };
      const stationEcf = satellite.geodeticToEcf(observer);
      const norm = Math.sqrt(stationEcf.x ** 2 + stationEcf.y ** 2 + stationEcf.z ** 2);
      const scale = radiusKm / norm;
      const satEcf = { x: stationEcf.x * scale, y: stationEcf.y * scale, z: stationEcf.z * scale };
      return satellite.ecfToEci(satEcf, gmst);
    };

    const sat0 = overheadEci(endpointA, GEO_R_KM);
    const sat1 = overheadEci(endpointB, GEO_R_KM);

    const linkModel: IslLinkModel = { mode: "dynamic", maxRangeKm: 100000, losMarginKm: 80 };

    const graph = buildSnapshotGraph({
      satEciPositions: [sat0, sat1],
      participantIndices: [0, 1],
      endpointA,
      endpointB,
      simDate,
      linkModel,
      hopPenaltyMs: 2,
    });

    const nodeA = endpointANodeId(2);
    const nodeB = endpointBNodeId(2);
    expect(nodeA).toBe(2);
    expect(nodeB).toBe(3);

    // GSL A-sat0 exists (directly overhead => ~90 deg elevation); A-sat1 does not
    // (90 deg longitude separation exceeds the ~81.3 deg GEO horizon limit).
    const aEdges = graph.adjacency.get(nodeA) ?? [];
    expect(aEdges.some((e) => e.to === 0 && e.kind === "gsl")).toBe(true);
    expect(aEdges.some((e) => e.to === 1)).toBe(false);

    // GSL B-sat1 exists.
    const bEdges = graph.adjacency.get(nodeB) ?? [];
    expect(bEdges.some((e) => e.to === 1 && e.kind === "gsl")).toBe(true);

    // ISL sat0-sat1 exists (90 deg apart at GEO, well within the LoS limit).
    const sat0Edges = graph.adjacency.get(0) ?? [];
    const islEdge = sat0Edges.find((e) => e.to === 1 && e.kind === "isl");
    expect(islEdge).toBeDefined();

    // Expected ISL chord length: 2 * R_geo * sin(45 deg).
    const expectedChordKm = 2 * GEO_R_KM * Math.sin(Math.PI / 4);
    expect(islEdge!.distanceKm).toBeCloseTo(expectedChordKm, 0);

    const expectedDelayMs = (expectedChordKm / 299792.458) * 1000 + 2;
    expect(islEdge!.costMs).toBeCloseTo(expectedDelayMs, 3);
  });

  it("GEO 2-satellite relay total delay matches the hand-calculated ~437.6 ms within 0.5%", () => {
    const simDate = new Date("2024-01-01T00:00:00.000Z");
    const gmst = satellite.gstime(simDate);

    const endpointA: IslEndpoint = {
      kind: "adhoc",
      name: "A",
      latitudeDeg: 0,
      longitudeDeg: 0,
      heightKm: 0,
      minElevationDeg: 0,
    };
    const endpointB: IslEndpoint = {
      kind: "adhoc",
      name: "B",
      latitudeDeg: 0,
      longitudeDeg: 90,
      heightKm: 0,
      minElevationDeg: 0,
    };

    const overheadEci = (endpoint: IslEndpoint, radiusKm: number) => {
      const observer = {
        longitude: satellite.degreesToRadians(endpoint.longitudeDeg),
        latitude: satellite.degreesToRadians(endpoint.latitudeDeg),
        height: endpoint.heightKm,
      };
      const stationEcf = satellite.geodeticToEcf(observer);
      const norm = Math.sqrt(stationEcf.x ** 2 + stationEcf.y ** 2 + stationEcf.z ** 2);
      const scale = radiusKm / norm;
      const satEcf = { x: stationEcf.x * scale, y: stationEcf.y * scale, z: stationEcf.z * scale };
      return satellite.ecfToEci(satEcf, gmst);
    };

    const sat0 = overheadEci(endpointA, GEO_R_KM);
    const sat1 = overheadEci(endpointB, GEO_R_KM);
    const linkModel: IslLinkModel = { mode: "dynamic", maxRangeKm: 100000, losMarginKm: 80 };
    const hopPenaltyMs = 2;

    const graph = buildSnapshotGraph({
      satEciPositions: [sat0, sat1],
      participantIndices: [0, 1],
      endpointA,
      endpointB,
      simDate,
      linkModel,
      hopPenaltyMs,
    });
    const result = findShortestPath(graph, simDate.getTime(), 0);

    expect(result.reachable).toBe(true);
    expect(result.hopCount).toBe(2);
    expect(result.edges).toHaveLength(3);

    // GSL x2 (~119.4 ms each) + ISL (~198.9 ms) ~= 437.6 ms,
    // excluding the 3 hop-penalty edges added on top by the cost model.
    const totalWithoutHopPenalty = result.totalDelayMs - result.edges.length * hopPenaltyMs;
    const expectedMs = 437.6;
    expect(Math.abs(totalWithoutHopPenalty - expectedMs) / expectedMs).toBeLessThan(0.005);
  });

  it("excludes GSL links beyond maxRangeKm even when elevation is still positive (bug fix)", () => {
    // Without a range cap, a low-elevation LEO satellite can be geometrically
    // "visible" (positive elevation) from thousands of km away, producing
    // implausible long, grazing GSL links whose satellite-side endpoint is far
    // from the ground point. Regression test for applying maxRangeKm to GSL too.
    const simDate = new Date("2024-01-01T00:00:00.000Z");
    const gmst = satellite.gstime(simDate);
    const LEO_R_KM = EARTH_RADIUS_EQUATOR_KM + 550;

    const endpointA: IslEndpoint = {
      kind: "adhoc",
      name: "A",
      latitudeDeg: 0,
      longitudeDeg: 0,
      heightKm: 0,
      minElevationDeg: 0,
    };
    const endpointB: IslEndpoint = {
      kind: "adhoc",
      name: "B",
      latitudeDeg: 0,
      longitudeDeg: 90,
      heightKm: 0,
      minElevationDeg: 0,
    };

    // Satellite ~20 deg away along the equator from endpoint A: elevation is
    // still positive (~3 deg) but slant range is ~2,373 km.
    const farSatEcf = {
      x: LEO_R_KM * Math.cos((20 * Math.PI) / 180),
      y: LEO_R_KM * Math.sin((20 * Math.PI) / 180),
      z: 0,
    };
    const farSatEci = satellite.ecfToEci(farSatEcf, gmst);

    const buildWithMaxRange = (maxRangeKm: number) =>
      buildSnapshotGraph({
        satEciPositions: [farSatEci],
        participantIndices: [0],
        endpointA,
        endpointB,
        simDate,
        linkModel: { mode: "dynamic", maxRangeKm, losMarginKm: 80 },
        hopPenaltyMs: 2,
      });

    const nodeA = endpointANodeId(1);

    const withoutCap = buildWithMaxRange(100000);
    expect((withoutCap.adjacency.get(nodeA) ?? []).some((e) => e.to === 0)).toBe(true);

    const withCap = buildWithMaxRange(2000);
    expect((withCap.adjacency.get(nodeA) ?? []).some((e) => e.to === 0)).toBe(false);
  });

  describe("shell-aware ISL candidate resolution", () => {
    // Positions far along a line, spaced 100 km apart: LoS is always clear and
    // distances are simply |i-j|*100 km — isolates the shell/mode/range-merge
    // logic in resolveIslEdges from LoS/orbital geometry (already covered
    // elsewhere).
    const linePositions = (n: number) =>
      Array.from({ length: n }, (_, idx) => ({ x: 1_000_000 + idx * 100, y: 0, z: 0 }));

    const endpointA: IslEndpoint = {
      kind: "adhoc",
      name: "A",
      latitudeDeg: 0,
      longitudeDeg: 0,
      heightKm: 0,
      minElevationDeg: 90, // unreachable GSL on purpose; this test is ISL-only
    };
    const endpointB: IslEndpoint = { ...endpointA, name: "B" };
    const simDate = new Date("2024-01-01T00:00:00.000Z");

    it("restricts a gridPattern shell to its structural neighbors, not the full dynamic mesh", () => {
      const positions = linePositions(6);
      const shell0: IslShellRange = { key: "0", startIndex: 0, count: 6, planes: 2 };

      const graph = buildSnapshotGraph({
        satEciPositions: positions,
        participantIndices: positions.map((_, i) => i),
        endpointA,
        endpointB,
        simDate,
        linkModel: { mode: "dynamic", maxRangeKm: 5000, losMarginKm: 80 },
        hopPenaltyMs: 2,
        shellRanges: [shell0],
        shellLinkModels: { "0": { mode: "gridPattern", maxRangeKm: 1000 } },
      });

      const hasEdge = (a: number, b: number) =>
        (graph.adjacency.get(a) ?? []).some((e) => e.to === b);

      // Structural (+Grid) neighbors: within each 3-satellite plane every pair
      // is a front/back neighbor (a 3-node ring), plus same-slot cross-plane.
      expect(hasEdge(0, 1)).toBe(true);
      expect(hasEdge(0, 3)).toBe(true); // same slot, adjacent (only) plane
      // Not a structural neighbor even though well within maxRangeKm=1000
      // (distance 400 km): slot 0 of plane 0 vs slot 1 of plane 1.
      expect(hasEdge(0, 4)).toBe(false);
    });

    it("keeps a dynamic shell fully meshed within its own maxRangeKm override", () => {
      const positions = linePositions(4);
      const shell1: IslShellRange = { key: "1", startIndex: 0, count: 4, planes: 1 };

      const graph = buildSnapshotGraph({
        satEciPositions: positions,
        participantIndices: positions.map((_, i) => i),
        endpointA,
        endpointB,
        simDate,
        linkModel: { mode: "dynamic", maxRangeKm: 50, losMarginKm: 80 }, // global default too small
        hopPenaltyMs: 2,
        shellRanges: [shell1],
        shellLinkModels: { "1": { mode: "dynamic", maxRangeKm: 1000 } },
      });

      const hasEdge = (a: number, b: number) =>
        (graph.adjacency.get(a) ?? []).some((e) => e.to === b);

      // All 6 pairs among the 4 satellites (max separation 300 km) should be
      // present under the shell's own 1000 km override, even though the
      // global default (50 km) would have excluded everything.
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          expect(hasEdge(a, b)).toBe(true);
        }
      }
    });

    it("merges cross-shell range as the larger of the two shells' overrides", () => {
      // Shell 0: satellites 0-2 (300 km apart), override maxRangeKm=1000.
      // Shell 1: satellites 3-5 (300 km apart), override maxRangeKm=150.
      // Cross-shell pair (2, 3) is 100 km apart -> within BOTH ranges (not a
      // useful discriminator), so use pair (0, 5): 500 km apart. Global
      // default is tiny, so only the merge rule can explain inclusion.
      const positions = linePositions(6);
      const shell0: IslShellRange = { key: "0", startIndex: 0, count: 3, planes: 1 };
      const shell1: IslShellRange = { key: "1", startIndex: 3, count: 3, planes: 1 };

      const graph = buildSnapshotGraph({
        satEciPositions: positions,
        participantIndices: positions.map((_, i) => i),
        endpointA,
        endpointB,
        simDate,
        linkModel: { mode: "dynamic", maxRangeKm: 10, losMarginKm: 80 },
        hopPenaltyMs: 2,
        shellRanges: [shell0, shell1],
        shellLinkModels: {
          "0": { mode: "dynamic", maxRangeKm: 1000 },
          "1": { mode: "dynamic", maxRangeKm: 150 },
        },
      });

      const hasEdge = (a: number, b: number) =>
        (graph.adjacency.get(a) ?? []).some((e) => e.to === b);

      // (0, 5): 500 km, within shell 0's 1000 km override (the larger of the two) -> included.
      expect(hasEdge(0, 5)).toBe(true);
      // (3, 5): both satellites in shell 1 only -> governed by shell 1's own
      // 150 km override (not the cross-shell merge rule), 200 km apart -> excluded.
      expect(hasEdge(3, 5)).toBe(false);
    });
  });

  it("derives the ground endpoint ECI position correctly via gmst (equator, lon 0)", () => {
    const simDate = new Date("2024-01-01T00:00:00.000Z");
    const gmst = satellite.gstime(simDate);

    const observer = { longitude: 0, latitude: 0, height: 0 };
    const stationEcf = satellite.geodeticToEcf(observer);
    const stationEci = satellite.ecfToEci(stationEcf, gmst);

    expect(stationEcf.x).toBeCloseTo(EARTH_RADIUS_EQUATOR_KM, 3);
    expect(stationEcf.y).toBeCloseTo(0, 6);
    expect(stationEcf.z).toBeCloseTo(0, 6);

    expect(stationEci.x).toBeCloseTo(EARTH_RADIUS_EQUATOR_KM * Math.cos(gmst), 3);
    expect(stationEci.y).toBeCloseTo(EARTH_RADIUS_EQUATOR_KM * Math.sin(gmst), 3);
    expect(stationEci.z).toBeCloseTo(0, 6);
  });
});
