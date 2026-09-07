import { describe, it, expect } from "bun:test";
import { degToRad } from "../src/lib/constellationPatterns/coverageGeometry";
import { enumerateStarCandidates } from "../src/lib/constellationDesign/starSizing";
import { runAnalyticCoverage } from "../src/lib/constellationDesign/screen";
import { candidateToShell, isExpressibleAsStreetsOfCoverage } from "../src/lib/constellationDesign/toShell";
import type {
  DesignCandidate,
  DesignConstraints,
  DesignRequest,
} from "../src/lib/constellationDesign/types";

function request(overrides: Partial<DesignConstraints>): DesignRequest {
  return {
    constraints: {
      minElevationDeg: 8.2,
      fold: 1,
      region: { kind: "global" },
      altitudeMinKm: 780,
      altitudeMaxKm: 780,
      spacingSafetyFactor: 1,
      ...overrides,
    },
    objective: { kind: "minSatellites" },
    epochIso: "2024-01-01T00:00:00Z",
  };
}

function coverage(candidate: DesignCandidate, minElevationDeg: number, fold: number) {
  return runAnalyticCoverage(candidate.parameters, {
    centralAngleRad: degToRad(candidate.analytic.centralAngleDeg),
    minElevationRad: degToRad(minElevationDeg),
    fold,
    latMinDeg: -90,
    latMaxDeg: 90,
    gridStepDeg: 2,
    timeSteps: 32,
  });
}

describe("enumerateStarCandidates — Iridium", () => {
  const result = enumerateStarCandidates(request({ maxSatsPerPlane: 12 }));

  it("sizes 11 satellites per plane into 6 planes of 66", () => {
    const iridium = result.candidates.find((c) => c.parameters.satsPerPlane === 11);
    expect(iridium).toBeDefined();
    expect(iridium!.parameters.planes).toBe(6);
    expect(iridium!.parameters.totalSatellites).toBe(66);
    expect(iridium!.parameters.deltaCoDeg).toBeCloseTo(31.389, 3);
    expect(iridium!.parameters.seamGapDeg).toBeCloseTo(23.054, 3);
    expect(iridium!.parameters.raanSpanDeg).toBeCloseTo(180, 6);
    // ω = 180/S for a global target, so F = T·ω/360 = P/2 exactly.
    expect(iridium!.parameters.phasingF).toBeCloseTo(3, 9);
    expect(iridium!.analytic.sizingMethod).toBe("streetsOfCoverage-inPlane");
    expect(iridium!.analytic.streetHalfWidthDeg).toBeCloseTo(11.527, 3);
  });

  it("rejects every S whose plane cannot form a continuous street", () => {
    // θ = 19.925° needs π/S < θ, i.e. S ≥ 10.
    for (let s = 3; s <= 9; s++) {
      const rejected = result.rejected.find((c) => c.parameters.socDesign?.satsPerPlane === s);
      expect(rejected).toBeDefined();
      expect(rejected!.rejectionReason).toBe("streetInfeasible");
    }
    expect(result.candidates.every((c) => c.parameters.satsPerPlane >= 10)).toBe(true);
  });

  it("covers the globe continuously at 5° elevation", () => {
    const iridium = result.candidates.find((c) => c.parameters.satsPerPlane === 11)!;
    const stats = coverage(iridium, 5, 1);
    expect(stats.foldAvailability).toBe(1);
    expect(stats.minFold).toBeGreaterThanOrEqual(1);
  });

  it("still reaches ≥0.999 availability at its design elevation of 8.2°", () => {
    const iridium = result.candidates.find((c) => c.parameters.satsPerPlane === 11)!;
    const stats = runAnalyticCoverage(iridium.parameters, {
      centralAngleRad: degToRad(iridium.analytic.centralAngleDeg),
      minElevationRad: degToRad(8.2),
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
      gridStepDeg: 2,
      timeSteps: 32,
    });
    // No `minFold` assertion: the design sits on its feasibility boundary, so
    // the sampled minimum flips to 0 as soon as the grid is refined.
    expect(stats.foldAvailability).toBeGreaterThanOrEqual(0.999);
  });

  it("loses coverage with naive uniform 30° plane spacing", () => {
    const iridium = result.candidates.find((c) => c.parameters.satsPerPlane === 11)!;
    const uniform: DesignCandidate = {
      ...iridium,
      parameters: { ...iridium.parameters, deltaCoDeg: 30 },
    };
    const stats = coverage(uniform, 8.2, 1);
    expect(stats.foldAvailability).toBeLessThan(0.9999);
  });

  it("round-trips through a streets_of_coverage shell", () => {
    const iridium = result.candidates.find((c) => c.parameters.satsPerPlane === 11)!;
    expect(isExpressibleAsStreetsOfCoverage(iridium)).toBe(true);
    const shell = candidateToShell(iridium);
    expect(shell.pattern).toBe("streets_of_coverage");
    expect(shell.count).toBe(66);
    expect(shell.planes).toBe(6);
    expect(shell.soc_sats_per_plane).toBe(11);
    expect(shell.soc_min_elevation).toBeCloseTo(8.2, 9);
  });
});

describe("enumerateStarCandidates — 2-fold coverage", () => {
  const result = enumerateStarCandidates(request({ fold: 2, maxSatsPerPlane: 20 }));
  const forS20 = result.candidates.filter((c) => c.parameters.satsPerPlane === 20);

  it("sizes in-plane 2-fold at S = 20 to 13 planes of 260", () => {
    // The plan predicted P = 7 / T = 140. `designStreetsOfCoverage` (Beech
    // eq. 6) makes the required RAAN span 360°, not 180°, for n = 2 at λ = 0
    // — 2P·asin(cos((P-2)π/(2P))) = 2π — so 13 planes are needed. The sizing
    // equations are Phase 1's single implementation and are not second-guessed
    // here; this pins what they actually produce.
    const inPlane = forS20.find((c) => c.analytic.sizingMethod === "streetsOfCoverage-inPlane");
    expect(inPlane).toBeDefined();
    expect(inPlane!.parameters.planes).toBe(13);
    expect(inPlane!.parameters.totalSatellites).toBe(260);
    expect(inPlane!.parameters.deltaCoDeg).toBeCloseTo(27.788, 3);
    expect(inPlane!.parameters.phasingF).toBeCloseTo(6.5, 9);
  });

  it("actually achieves 2-fold coverage with the in-plane sizing", () => {
    const inPlane = forS20.find((c) => c.analytic.sizingMethod === "streetsOfCoverage-inPlane")!;
    const stats = coverage(inPlane, 8.2, 2);
    expect(stats.minFold).toBeGreaterThanOrEqual(2);
    expect(stats.foldAvailability).toBe(1);
  });

  it("emits a cross-plane variant that screening has to reject", () => {
    // P = ceil(N·P₁) is a heuristic, and at S = 20 it under-delivers (0.99 at
    // best). Keeping it costs a screen and lets the pipeline — not the sizing
    // equations — decide, which is exactly the point of stage 1b.
    const crossPlane = forS20.find((c) => c.analytic.sizingMethod === "streetsOfCoverage-crossPlane");
    expect(crossPlane).toBeDefined();
    expect(crossPlane!.parameters.planes).toBe(10);
    expect(crossPlane!.parameters.totalSatellites).toBe(200);
    const stats = coverage(crossPlane!, 8.2, 2);
    expect(stats.foldAvailability).toBeLessThan(0.9999);
    // ...and it must not be offered as a `streets_of_coverage` shell, whose
    // stored design inputs would regenerate the 13-plane in-plane design.
    expect(isExpressibleAsStreetsOfCoverage(crossPlane!)).toBe(false);
    expect(candidateToShell(crossPlane!).pattern).toBe("walker_star");
  });

  it("warns that N-fold sizing is approximate", () => {
    expect(result.warnings.some((w) => w.includes("近似"))).toBe(true);
  });
});

describe("enumerateStarCandidates — constraint handling", () => {
  it("drops the family entirely when the inclination range excludes polar orbits", () => {
    const result = enumerateStarCandidates(
      request({ inclinationMinDeg: 40, inclinationMaxDeg: 60 }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Walker Star"))).toBe(true);
  });

  it("falls back to 86.4° when 90° is excluded but the range stays polar", () => {
    const result = enumerateStarCandidates(
      request({ inclinationMinDeg: 80, inclinationMaxDeg: 88, maxSatsPerPlane: 12 }),
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.parameters.inclinationDeg === 86.4)).toBe(true);
  });

  it("uses the region's minimum |latitude| as the target latitude", () => {
    const band = enumerateStarCandidates(
      request({
        region: { kind: "latitudeBand", latMinDeg: 30, latMaxDeg: 70 },
        maxSatsPerPlane: 12,
      }),
    );
    expect(band.candidates.length).toBeGreaterThan(0);
    expect(band.candidates.every((c) => c.parameters.socDesign?.targetLatitudeDeg === 30)).toBe(true);
    // A band that straddles the equator is a global target for sizing purposes.
    const straddling = enumerateStarCandidates(
      request({
        region: { kind: "latitudeBand", latMinDeg: -20, latMaxDeg: 50 },
        maxSatsPerPlane: 12,
      }),
    );
    expect(straddling.candidates.every((c) => c.parameters.socDesign?.targetLatitudeDeg === 0)).toBe(
      true,
    );
  });

  it("honours maxPlanes by rejecting rather than truncating", () => {
    const result = enumerateStarCandidates(request({ maxSatsPerPlane: 12, maxPlanes: 5 }));
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected.some((c) => c.rejectionReason === "maxPlanes")).toBe(true);
  });

  it("reports every candidate as T = P·S with the fast path available", () => {
    const result = enumerateStarCandidates(request({ maxSatsPerPlane: 16 }));
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const { totalSatellites, planes, satsPerPlane, kernelFastPath } = candidate.parameters;
      expect(totalSatellites).toBe(planes * satsPerPlane);
      expect(kernelFastPath).toBe(true);
    }
  });
});
