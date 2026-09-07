import { describe, it, expect } from "bun:test";
import { degToRad } from "../src/lib/constellationPatterns/coverageGeometry";
import { buildConstellation } from "../src/lib/tomlParsers";
import { serializeConstellationConfig } from "../src/lib/constellationSerializer";
import { solveAltitudeFromInclinationAndRatio } from "../src/lib/rgt";
import { accumulateCoverage, buildRegionGrid } from "../src/lib/constellationDesign/coverageKernel";
import {
  createScreenBudget,
  deltaPhasingCandidates,
  deltaShapesForT,
  enumerateDeltaCandidates,
  snapToComposite,
} from "../src/lib/constellationDesign/deltaSizing";
import {
  enumerateAnalytic,
  runDesign,
  screenThresholdOf,
} from "../src/lib/constellationDesign/enumerate";
import { candidateSatelliteSpecs } from "../src/lib/constellationDesign/geometry";
import { screenCandidate } from "../src/lib/constellationDesign/screen";
import { altitudeSamplesForInclination } from "../src/lib/constellationDesign/searchGrid";
import { enumerateStarCandidates } from "../src/lib/constellationDesign/starSizing";
import { candidateToShell } from "../src/lib/constellationDesign/toShell";
import { createSgp4SamplerFromSpecs, resolveVerifyFidelity } from "../src/lib/constellationDesign/verify";
import { regionLatitudeBounds } from "../src/lib/constellationDesign/types";
import type {
  DesignConstraints,
  DesignObjective,
  DesignRequest,
} from "../src/lib/constellationDesign/types";

const EPOCH_ISO = "2024-03-20T00:00:00Z";

function makeRequest(
  constraints: Partial<DesignConstraints>,
  objective: DesignObjective = { kind: "minSatellites" },
  extra: Partial<DesignRequest> = {},
): DesignRequest {
  return {
    constraints: {
      minElevationDeg: 25,
      fold: 1,
      region: { kind: "global" },
      altitudeMinKm: 1200,
      altitudeMaxKm: 1200,
      spacingSafetyFactor: 1,
      ...constraints,
    },
    objective,
    epochIso: EPOCH_ISO,
    topK: 1,
    ...extra,
  };
}

/** Smallest Star `T` that clears the coarse screen at one altitude. */
function minScreenedStarT(altitudeKm: number, minElevationDeg: number): number | null {
  const request = makeRequest({
    minElevationDeg,
    altitudeMinKm: altitudeKm,
    altitudeMaxKm: altitudeKm,
    maxSatsPerPlane: 30,
  });
  const threshold = screenThresholdOf(request);
  const candidates = enumerateStarCandidates(request)
    .candidates.slice()
    .sort((a, b) => a.parameters.totalSatellites - b.parameters.totalSatellites);
  for (const candidate of candidates) {
    const screen = screenCandidate(candidate.parameters, {
      centralAngleRad: degToRad(candidate.analytic.centralAngleDeg),
      minElevationRad: degToRad(minElevationDeg),
      fold: 1,
      latMinDeg: -90,
      latMaxDeg: 90,
    });
    if (screen.foldAvailability >= threshold) return candidate.parameters.totalSatellites;
  }
  return null;
}

describe("shape and phasing enumeration (prefilter P3)", () => {
  it("returns every factorization within the caps, P nearest √T first", () => {
    const shapes = deltaShapesForT(144, 60, 60);
    for (const shape of shapes) {
      expect(shape.planes * shape.satsPerPlane).toBe(144);
      expect(shape.planes).toBeLessThanOrEqual(60);
      expect(shape.satsPerPlane).toBeLessThanOrEqual(60);
    }
    expect(shapes[0].planes).toBe(12);
    // 144 = 1·144 and 2·72 both exceed the per-plane cap of 60.
    expect(shapes.some((s) => s.satsPerPlane > 60)).toBe(false);
    expect(deltaShapesForT(97, 60, 60)).toHaveLength(0);
  });

  it("puts the half-plane stagger first and stays inside [0, P)", () => {
    expect(deltaPhasingCandidates(4)[0]).toBe(2);
    expect(deltaPhasingCandidates(4).slice().sort()).toEqual([0, 1, 2, 3]);
    for (const planes of [3, 6, 7, 12, 37]) {
      for (const f of deltaPhasingCandidates(planes)) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(planes);
      }
      expect(new Set(deltaPhasingCandidates(planes)).size).toBe(
        deltaPhasingCandidates(planes).length,
      );
    }
  });

  it("snaps a prime probe onto the most composite neighbour", () => {
    // 97 is prime and has no valid shape at all. Within +3, 100 (7 shapes)
    // beats 98 (4 shapes), so the probe lands there.
    expect(snapToComposite(97, 200, 60, 60)).toBe(100);
    expect(deltaShapesForT(100, 60, 60).length).toBeGreaterThan(
      deltaShapesForT(98, 60, 60).length,
    );
    // ...but never past the ceiling it is given.
    expect(snapToComposite(97, 97, 60, 60)).toBe(97);
    expect(snapToComposite(97, 98, 60, 60)).toBe(98);
  });
});

describe("prefilter P1 — reachability", () => {
  it("rejects every Walker Delta cell when the inclination cannot reach the region", () => {
    const request = makeRequest({
      altitudeMinKm: 500,
      altitudeMaxKm: 1500,
      inclinationMaxDeg: 53,
      families: ["walkerDelta"],
    });
    const warnings: string[] = [];
    return enumerateDeltaCandidates(request, {
      screen: () => {
        throw new Error("screening must not be reached when P1 rejects the whole grid");
      },
      screenThreshold: 0.9979,
      budget: createScreenBudget(),
      warnings,
    }).then((result) => {
      expect(result.candidates).toHaveLength(0);
      expect(result.rejected.length).toBeGreaterThan(0);
      expect(result.rejected.every((c) => c.rejectionReason === "reachability")).toBe(true);
      expect(warnings.some((w) => w.includes("傾斜角"))).toBe(true);
    });
  });

  it("rejects individual (altitude, inclination) cells that cannot reach a band", async () => {
    const request = makeRequest({
      region: { kind: "latitudeBand", latMinDeg: 60, latMaxDeg: 80 },
      minElevationDeg: 25,
      // A wide altitude span is what makes per-cell P1 bite: the inclination
      // grid is built from θ at the *highest* altitude, so its lowest
      // inclinations cannot reach 80° at the lowest altitude.
      altitudeMinKm: 400,
      altitudeMaxKm: 1400,
      altitudeStepKm: 500,
      inclinationMinDeg: 50,
      inclinationMaxDeg: 90,
      families: ["walkerDelta"],
      maxSatsPerPlane: 20,
      maxPlanes: 20,
    });
    const result = await enumerateDeltaCandidates(request, {
      screen: (parameters, analytic) =>
        screenCandidate(parameters, {
          centralAngleRad: degToRad(analytic.centralAngleDeg),
          minElevationRad: degToRad(25),
          fold: 1,
          latMinDeg: 60,
          latMaxDeg: 80,
        }),
      screenThreshold: 0.9979,
      budget: createScreenBudget(600, 60),
      warnings: [],
    });
    // Every surviving cell must satisfy P1: i + θ ≥ 80°.
    for (const candidate of result.candidates) {
      expect(candidate.parameters.inclinationDeg + candidate.analytic.centralAngleDeg).toBeGreaterThanOrEqual(80 - 1e-9);
    }
    expect(result.rejected.some((c) => c.rejectionReason === "reachability")).toBe(true);
  });
});

describe("prefilters P2/P3 hold for every emitted candidate", () => {
  it("never proposes fewer satellites than the cap-area bound, and always T = P·S", async () => {
    const request = makeRequest({
      minElevationDeg: 25,
      altitudeMinKm: 1200,
      altitudeMaxKm: 1400,
      altitudeStepKm: 100,
      maxPlanes: 24,
      maxSatsPerPlane: 24,
      families: ["walkerDelta"],
    });
    const result = await enumerateDeltaCandidates(request, {
      screen: (parameters, analytic) =>
        screenCandidate(parameters, {
          centralAngleRad: degToRad(analytic.centralAngleDeg),
          minElevationRad: degToRad(25),
          fold: 1,
          latMinDeg: -90,
          latMaxDeg: 90,
        }),
      screenThreshold: screenThresholdOf(request),
      budget: createScreenBudget(1200, 80),
      warnings: [],
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const { parameters, analytic } of result.candidates) {
      expect(parameters.totalSatellites).toBeGreaterThanOrEqual(analytic.capAreaLowerBoundCount);
      expect(parameters.totalSatellites).toBe(parameters.planes * parameters.satsPerPlane);
      expect(parameters.planes).toBeLessThanOrEqual(24);
      expect(parameters.satsPerPlane).toBeLessThanOrEqual(24);
      expect(parameters.phasingF).toBeGreaterThanOrEqual(0);
      expect(parameters.phasingF).toBeLessThan(parameters.planes);
      expect(Number.isInteger(parameters.phasingF)).toBe(true);
    }
  });
});

describe("monotonicity in altitude", () => {
  it("never needs more satellites as the shell rises", () => {
    const minima = [550, 800, 1200, 1500].map((h) => minScreenedStarT(h, 10));
    expect(minima.every((t) => t !== null)).toBe(true);
    for (let i = 1; i < minima.length; i++) {
      expect(minima[i]!).toBeLessThanOrEqual(minima[i - 1]!);
    }
    // ...and the effect is real, not a flat line.
    expect(minima[minima.length - 1]!).toBeLessThan(minima[0]!);
  });
});

describe("RGT quantization", () => {
  it("replaces the altitude grid with solved repeat-ground-track altitudes", () => {
    const constraints: DesignConstraints = {
      minElevationDeg: 25,
      fold: 1,
      region: { kind: "global" },
      altitudeMinKm: 500,
      altitudeMaxKm: 900,
      altitudeStepKm: 50,
      rgt: { enabled: true, minRepeatDays: 1, maxRepeatDays: 5 },
    };
    const warnings: string[] = [];
    const at90 = altitudeSamplesForInclination(constraints, 90, warnings);
    const at53 = altitudeSamplesForInclination(constraints, 53, warnings);

    expect(at90.length).toBeGreaterThan(0);
    expect(warnings).toContain("RGT quantized altitudes per inclination");

    for (const sample of at90) {
      expect(sample.repeatOrbits).toBeGreaterThan(0);
      expect(sample.repeatDays).toBeGreaterThan(0);
      expect(sample.altitudeKm).toBeGreaterThanOrEqual(500 - 1e-6);
      expect(sample.altitudeKm).toBeLessThanOrEqual(900 + 1e-6);
      const solved = solveAltitudeFromInclinationAndRatio(
        sample.altitudeKm,
        90,
        sample.repeatOrbits!,
        sample.repeatDays!,
        0,
        { minRepeatDays: 1, maxRepeatDays: 5 },
      );
      expect(solved).not.toBeNull();
      expect(Math.abs(solved!.altitudeKm - sample.altitudeKm)).toBeLessThan(1e-3);
    }

    // The J2 nodal drift depends on inclination, so the closing altitudes must
    // differ — a shared altitude grid would mean the constraint did nothing.
    const shared = at90.filter((a) =>
      at53.some((b) => Math.abs(a.altitudeKm - b.altitudeKm) < 1e-3),
    );
    expect(shared).toHaveLength(0);
  });

  it("leaves the altitude grid alone when RGT is off", () => {
    const constraints: DesignConstraints = {
      minElevationDeg: 25,
      fold: 1,
      region: { kind: "global" },
      altitudeMinKm: 500,
      altitudeMaxKm: 700,
      altitudeStepKm: 100,
    };
    expect(altitudeSamplesForInclination(constraints, 90).map((s) => s.altitudeKm)).toEqual([
      500, 600, 700,
    ]);
  });
});

describe("objectives", () => {
  it("returns candidates for a prime satellite budget", async () => {
    const result = await runDesign(
      makeRequest(
        { minElevationDeg: 25, maxPlanes: 24, maxSatsPerPlane: 24 },
        { kind: "fixedBudget", satelliteBudget: 97 },
        { topK: 2 },
      ),
    );
    // `T ≤ budget`, not `T == budget`: 97 is prime and has no P·S factorization
    // inside the caps, so an equality filter would return nothing.
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.parameters.totalSatellites).toBeLessThanOrEqual(97);
      expect(candidate.verified).toBeDefined();
    }
  }, 30000);

  it("keeps at most one candidate per altitude for the Pareto objective", async () => {
    const result = await runDesign(
      makeRequest(
        {
          minElevationDeg: 25,
          altitudeMinKm: 1200,
          altitudeMaxKm: 1400,
          altitudeStepKm: 100,
          maxSatsPerPlane: 20,
          families: ["walkerStar"],
        },
        { kind: "paretoCountVsAltitude" },
      ),
    );
    const byAltitude = new Map<number, number>();
    for (const candidate of result.candidates) {
      const altitude = candidate.parameters.altitudeKm;
      expect(byAltitude.has(altitude)).toBe(false);
      byAltitude.set(altitude, candidate.parameters.totalSatellites);
    }
    expect(byAltitude.size).toBeGreaterThan(1);
    // The kept candidate must be the smallest feasible one at its altitude.
    for (const candidate of result.candidates) {
      const same = result.analyticCandidates.filter(
        (c) =>
          c.parameters.altitudeKm === candidate.parameters.altitudeKm &&
          c.feasible &&
          c.analytic.sizingMethod === candidate.analytic.sizingMethod,
      );
      for (const other of same) {
        expect(other.parameters.totalSatellites).toBeGreaterThanOrEqual(
          candidate.parameters.totalSatellites,
        );
      }
    }
  }, 30000);

  it("throws for the reserved isl constraint hook", async () => {
    const request = makeRequest({});
    (request.constraints as unknown as Record<string, unknown>).isl = { maxRangeKm: 5000 };
    // `runDesign` is async, so the guard surfaces as a rejection.
    await expect(runDesign(request)).rejects.toThrow(/isl/);
    // ...while the synchronous analytic entry point throws directly.
    expect(() => enumerateAnalytic(request)).toThrow(/isl/);
  });

  it("throws for an unparseable epoch", async () => {
    const request = makeRequest({});
    request.epochIso = "not-a-date";
    await expect(runDesign(request)).rejects.toThrow(/epochIso/);
  });
});

/**
 * Serializes the shell, regenerates its satellites through the runtime TOML
 * path, and checks both the elements and the recomputed coverage against what
 * the optimizer reported.
 */
async function expectShellRoundTrip(request: DesignRequest): Promise<void> {
  const result = await runDesign(request);
  const best = result.best;
  expect(best).toBeDefined();
  expect(best!.verified).toBeDefined();

  const epoch = new Date(EPOCH_ISO);
  const shell = candidateToShell(best!, { request, name: "round trip" });
  const toml = serializeConstellationConfig({ epoch, shells: [shell] });
  const built = buildConstellation(toml, 0);

  expect(built.satellites).toHaveLength(best!.parameters.totalSatellites);
  expect(built.ranges[0].planes).toBe(best!.parameters.planes);

  // The serializer writes angles with fixed decimals, so element equality is
  // only exact to that quantization.
  const expected = candidateSatelliteSpecs(best!.parameters, epoch);
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i];
    const b = built.satellites[i];
    if (a.type !== "elements" || b.type !== "elements") throw new Error("expected elements");
    expect(b.elements.semiMajorAxisKm).toBeCloseTo(a.elements.semiMajorAxisKm, 2);
    expect(b.elements.inclinationDeg).toBeCloseTo(a.elements.inclinationDeg, 2);
    expect(b.elements.raanDeg).toBeCloseTo(a.elements.raanDeg, 2);
    expect(b.elements.meanAnomalyDeg).toBeCloseTo(a.elements.meanAnomalyDeg, 2);
    expect(b.elements.eccentricity).toBe(0);
  }

  // ...and coverage recomputed from the *built* satellites matches the metrics
  // the optimizer reported for the candidate.
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(request.constraints.region);
  const settings = resolveVerifyFidelity(best!.parameters, best!.analytic, {
    epoch,
    minElevationDeg: request.constraints.minElevationDeg,
    fold: request.constraints.fold,
    latMinDeg,
    latMaxDeg,
  });
  const sampler = createSgp4SamplerFromSpecs(built.satellites, epoch);
  const stats = accumulateCoverage(
    buildRegionGrid(latMinDeg, latMaxDeg, settings.gridStepDeg),
    sampler.sample,
    sampler.sampleAt,
    {
      centralAngleRad: degToRad(best!.analytic.centralAngleDeg),
      minElevationRad: degToRad(request.constraints.minElevationDeg),
      fold: request.constraints.fold,
      predicate: "ellipsoid",
      timeSteps: settings.timeSteps,
      windowSec: settings.windowSec,
      ditherLongitude: settings.ditherLongitude,
    },
  );
  expect(Math.abs(stats.foldAvailability - best!.verified!.foldAvailability)).toBeLessThan(1e-3);
  expect(Math.abs(stats.meanFold - best!.verified!.meanFold)).toBeLessThan(0.05);
}

describe("shell round trip", () => {
  it("regenerates a verified streets_of_coverage candidate through TOML", async () => {
    // Inclination is pinned to 86.4° rather than the natural 90° on purpose:
    // `tomlParsers.ts`'s `ALWAYS_PRESENT` forces `inclination: 0` for an
    // omitted key, and the serializer omits any value equal to the pattern
    // default (90° for star-like patterns), so a 90° star shell currently
    // reloads as equatorial. That is a Phase 1 parser defect reported
    // separately, not something this engine can compensate for.
    await expectShellRoundTrip(
      makeRequest(
        {
          minElevationDeg: 25,
          altitudeMinKm: 1200,
          altitudeMaxKm: 1200,
          maxSatsPerPlane: 20,
          inclinationMinDeg: 80,
          inclinationMaxDeg: 88,
          families: ["walkerStar"],
        },
        { kind: "minSatellites" },
        { topK: 1 },
      ),
    );
  }, 30000);

  it("regenerates a verified walker_delta candidate through TOML", async () => {
    await expectShellRoundTrip(
      makeRequest(
        {
          minElevationDeg: 25,
          region: { kind: "latitudeBand", latMinDeg: -40, latMaxDeg: 40 },
          altitudeMinKm: 1400,
          altitudeMaxKm: 1400,
          maxPlanes: 12,
          maxSatsPerPlane: 12,
          families: ["walkerDelta"],
        },
        { kind: "minSatellites" },
        { topK: 1 },
      ),
    );
  }, 30000);
});
