import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import { buildSnapshotGraph } from "../src/lib/isl/graph";
import { applyStabilityPenalties } from "../src/lib/isl/stability";
import type { IslEndpoint, IslLinkModel } from "../src/lib/isl/types";
import type { Vec3 } from "../src/lib/isl/geometry";

describe("applyStabilityPenalties (§1.5.2, Phase 4)", () => {
  const simDate = new Date("2024-01-01T00:00:00.000Z");
  const endpointA: IslEndpoint = {
    kind: "adhoc",
    name: "A",
    latitudeDeg: 0,
    longitudeDeg: 0,
    heightKm: 0,
    minElevationDeg: 90, // GSL unreachable on purpose; this test is ISL-only
  };
  const endpointB: IslEndpoint = { ...endpointA, name: "B" };
  const linkModel: IslLinkModel = { mode: "dynamic", maxRangeKm: 5000, losMarginKm: 80 };

  it("is a no-op when weightMs <= 0", () => {
    const positions: Vec3[] = [
      { x: 7000, y: 0, z: 0 },
      { x: 7000, y: 500, z: 0 },
    ];
    const graph = buildSnapshotGraph({
      satEciPositions: positions,
      participantIndices: [0, 1],
      endpointA,
      endpointB,
      simDate,
      linkModel,
      hopPenaltyMs: 2,
    });
    const originalCost = graph.adjacency.get(0)![0].costMs;

    const result = applyStabilityPenalties(graph, {
      predictSatPosition: (i) => positions[i],
      gmstAt: () => 0,
      endpointA,
      endpointB,
      maxRangeKm: linkModel.maxRangeKm,
      losMarginKm: linkModel.losMarginKm,
      horizonS: 300,
      stepS: 10,
      thresholdS: 60,
      weightMs: 0,
    });

    expect(result).toBe(graph); // same reference: true no-op, not just equal cost
    expect(result.adjacency.get(0)![0].costMs).toBeCloseTo(originalCost, 9);
  });

  it("adds a large penalty to a link that breaks almost immediately", () => {
    // Two satellites moving directly apart at 1000 km/s along x — the ISL
    // link (maxRangeKm=5000) breaks well within the sampling horizon.
    const v = 1000; // km/s, deliberately fast so it breaks fast and deterministically
    const basePositions: Vec3[] = [
      { x: 7000, y: 0, z: 0 },
      { x: 7000, y: 100, z: 0 }, // 100 km apart at t=0
    ];
    const graph = buildSnapshotGraph({
      satEciPositions: basePositions,
      participantIndices: [0, 1],
      endpointA,
      endpointB,
      simDate,
      linkModel,
      hopPenaltyMs: 2,
    });
    const originalCost = graph.adjacency.get(0)!.find((e) => e.to === 1)!.costMs;

    const result = applyStabilityPenalties(graph, {
      predictSatPosition: (i, dt) => ({
        x: 7000,
        y: (i === 0 ? 0 : 100) + (i === 0 ? -1 : 1) * v * dt,
        z: 0,
      }),
      gmstAt: () => 0,
      endpointA,
      endpointB,
      maxRangeKm: linkModel.maxRangeKm,
      losMarginKm: linkModel.losMarginKm,
      horizonS: 300,
      stepS: 10,
      thresholdS: 60,
      weightMs: 20,
    });

    const penalizedCost = result.adjacency.get(0)!.find((e) => e.to === 1)!.costMs;
    // Separation grows linearly as 100 + 2*v*t km; breaks (exceeds
    // maxRangeKm=5000) at t = (5000-100)/(2*v) = 2.45 s, well under the
    // threshold tau_min=60 s, so a large (but not the full w_tau=20 ms cap,
    // since remaining isn't exactly 0) penalty applies: 20*(1 - 2.45/60).
    const expectedRemainingS = (linkModel.maxRangeKm - 100) / (2 * v);
    const expectedPenaltyMs = 20 * (1 - expectedRemainingS / 60);
    expect(penalizedCost - originalCost).toBeCloseTo(expectedPenaltyMs, 1);
    expect(penalizedCost - originalCost).toBeGreaterThan(15); // large relative to the 20 ms cap
  });

  it("adds no penalty to a link that stays well within range for the whole horizon", () => {
    const positions: Vec3[] = [
      { x: 7000, y: 0, z: 0 },
      { x: 7000, y: 100, z: 0 }, // static, always 100 km apart
    ];
    const graph = buildSnapshotGraph({
      satEciPositions: positions,
      participantIndices: [0, 1],
      endpointA,
      endpointB,
      simDate,
      linkModel,
      hopPenaltyMs: 2,
    });
    const originalCost = graph.adjacency.get(0)!.find((e) => e.to === 1)!.costMs;

    const result = applyStabilityPenalties(graph, {
      predictSatPosition: (i) => positions[i], // never moves -> link never breaks
      gmstAt: (dt) => satellite.gstime(new Date(simDate.getTime() + dt * 1000)),
      endpointA,
      endpointB,
      maxRangeKm: linkModel.maxRangeKm,
      losMarginKm: linkModel.losMarginKm,
      horizonS: 300,
      stepS: 10,
      thresholdS: 60,
      weightMs: 20,
    });

    const penalizedCost = result.adjacency.get(0)!.find((e) => e.to === 1)!.costMs;
    expect(penalizedCost).toBeCloseTo(originalCost, 6);
  });
});
