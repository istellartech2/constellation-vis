/**
 * Domain tests for `src/lib/constellationPatterns/`.
 *
 * The byte-identity contract for pre-existing TOML lives in
 * `constellationPatternsBaseline.test.ts`; this file covers the new patterns,
 * their published reference numbers, and the cross-pattern invariants the
 * emitter and the ISL layer rely on.
 */
import { describe, expect, it } from "bun:test";
import {
  PATTERN_IDS,
  PATTERN_REGISTRY,
  admissibleShifts,
  capAreaLowerBoundCount,
  computeShellDerived,
  designStreetsOfCoverage,
  earthCentralAngleDeg,
  flowerMaxSatellites,
  flowerOrbit,
  flowerParams,
  generateShell,
  isNecklaceAdmissible,
  latticeMeanAnomalyDeg,
  latticeParams,
  latticeWalkerF,
  necklaceSymmetry,
  planFlower,
  planLatticeFlower,
  planNecklaceFlower,
  planStreetsOfCoverage,
  planWalkerDelta,
  planWalkerStar,
  resolvePattern,
  streetHalfWidthRad,
  validateShell,
  type PatternId,
  type PatternShellInput,
  type PlanePlan,
} from "../src/lib/constellationPatterns";
import {
  buildConstellation,
  generateShellRanges,
  parseConstellationConfig,
  parseConstellationToml,
} from "../src/lib/tomlParsers";
import {
  parseConstellationConfig as parseEditorConfig,
  serializeConstellationConfig,
} from "../src/lib/constellationSerializer";
import { PATTERN_DEFAULTS, createNewShell } from "../src/lib/constellationTypes";
import { gridPatternIslCandidates } from "../src/lib/isl/candidates";
import type { Vec3 } from "../src/lib/isl/geometry";

const EPOCH = new Date("2025-05-20T00:00:00Z");
const DEG = Math.PI / 180;

function flatMeanAnomalies(plans: readonly PlanePlan[]): number[] {
  return plans.flatMap((p) => p.meanAnomaliesDeg);
}

/** Mean anomalies of one plane, folded into [0,360) and sorted. */
function sortedPlaneAnomalies(plan: PlanePlan): number[] {
  return plan.meanAnomaliesDeg.map((m) => ((m % 360) + 360) % 360).sort((a, b) => a - b);
}

describe("pattern resolution", () => {
  it("treats a missing pattern as walker_delta", () => {
    expect(resolvePattern({}).id).toBe("walker_delta");
    expect(resolvePattern({ pattern: undefined }).id).toBe("walker_delta");
  });

  it("falls back to walker_delta for an unknown pattern but reports a validation error", () => {
    const shell: PatternShellInput = { pattern: "walker_octagon", count: 4, planes: 2 };
    expect(resolvePattern(shell).id).toBe("walker_delta");
    const errors = validateShell(shell, 0);
    expect(errors.map((e) => e.field)).toContain("shell.0.pattern");
  });

  it("omits `pattern` when serializing a walker_delta shell", () => {
    const toml = serializeConstellationConfig({
      epoch: EPOCH,
      shells: [{ ...createNewShell("walker_delta"), id: "s1" }],
    });
    expect(toml).not.toContain("pattern =");
    expect(toml).toContain("count =");
    expect(toml).toContain("planes =");
  });

  it("writes `pattern` for every non-default pattern", () => {
    for (const pattern of PATTERN_IDS) {
      if (pattern === "walker_delta") continue;
      const toml = serializeConstellationConfig({
        epoch: EPOCH,
        shells: [{ ...createNewShell(pattern), id: "s1" }],
      });
      expect(toml).toContain(`pattern = "${pattern}"`);
    }
  });

  it("rejects a non-finite numeric field", () => {
    const errors = validateShell({ count: 4, planes: 2, inclination: Number.NaN }, 1);
    expect(errors).toContainEqual({
      field: "shell.1.inclination",
      message: "inclination には数値を入力してください",
    });
  });
});

describe("walker_star", () => {
  const starShell: PatternShellInput = {
    pattern: "walker_star",
    count: 66,
    planes: 6,
    apogee_altitude: 780,
    inclination: 86.4,
  };

  it("without raan_spacing is element-for-element identical to a delta with raan_range 180 and F = P/2", () => {
    const star = planWalkerStar(starShell);
    const delta = planWalkerDelta({
      count: 66,
      planes: 6,
      phasing: 3, // P/2
      raan_range: 180,
      apogee_altitude: 780,
      inclination: 86.4,
    });
    // Exact equality: the star core reuses the delta RAAN expression verbatim
    // whenever raan_spacing is absent, so no tolerance is needed.
    expect(star.plans).toEqual(delta.plans);
    expect(star.orbit).toEqual(delta.orbit);
  });

  it("defaults raan_range to 180 and inclination to 90", () => {
    const plan = planWalkerStar({ pattern: "walker_star", count: 12, planes: 6 });
    expect(plan.orbit.inclinationDeg).toBe(90);
    expect(plan.plans.map((p) => p.raanDeg)).toEqual([0, 30, 60, 90, 120, 150]);
  });

  it("reproduces the Iridium seam geometry from an explicit raan_spacing", () => {
    const plan = planWalkerStar({
      ...starShell,
      raan_range: 180,
      raan_spacing: 31.389,
      phasing: 3,
    });

    const raans = plan.plans.map((p) => p.raanDeg);
    expect(raans).toHaveLength(6);
    raans.forEach((raan, p) => expect(raan).toBeCloseTo(p * 31.389, 9));

    const seam = 180 - 5 * 31.389;
    expect(seam).toBeCloseTo(23.055, 3);

    // Inter-plane mean-anomaly offset = (360/T)·F = (360/66)·3.
    const offset = plan.plans[1].meanAnomaliesDeg[0] - plan.plans[0].meanAnomaliesDeg[0];
    expect(offset).toBeCloseTo(16.3636, 4);
  });

  it("flags a raan_spacing that leaves no seam", () => {
    const errors = validateShell(
      { ...starShell, raan_range: 180, raan_spacing: 40 },
      0,
    );
    expect(errors.some((e) => e.field === "shell.0.raan_spacing")).toBe(true);
  });

  it("warns (but does not block) when the inclination is far from polar", () => {
    const errors = validateShell({ ...starShell, inclination: 53 }, 0);
    const warning = errors.find((e) => e.field === "shell.0.inclination");
    expect(warning?.severity).toBe("warning");
  });

  it("reports wrapPlanes = false so the +Grid ring stays open at the seam", () => {
    expect(planWalkerStar(starShell).wrapPlanes).toBe(false);
    expect(planWalkerDelta({ count: 66, planes: 6 }).wrapPlanes).toBe(true);
  });
});

describe("gridPatternIslCandidates with seam and uneven planes", () => {
  /** Collinear far-from-Earth points: every structural neighbour survives LoS/range. */
  function linePositions(n: number): Vec3[] {
    return Array.from({ length: n }, (_, i) => ({ x: 1_000_000 + i, y: 0, z: 0 }));
  }

  it("omits the last-plane → plane-0 link when wrapPlanes is false", () => {
    const planes = 6;
    const perPlane = 11;
    const positions = linePositions(planes * perPlane);
    const shell = { startIndex: 0, count: planes * perPlane, planes, wrapPlanes: false };

    const edges = gridPatternIslCandidates(positions, shell, 100000, 500);
    const crossSeam = edges.filter((e) => {
      const pi = Math.floor(e.i / perPlane);
      const pj = Math.floor(e.j / perPlane);
      return (pi === 0 && pj === planes - 1) || (pi === planes - 1 && pj === 0);
    });
    expect(crossSeam).toHaveLength(0);

    // The in-plane ring still closes: plane 0 slot 0 <-> plane 0 slot 10.
    expect(edges.some((e) => e.i === 0 && e.j === perPlane - 1)).toBe(true);

    // Wrapping enabled, the same shell does produce the seam links.
    const wrapped = gridPatternIslCandidates(
      positions,
      { startIndex: 0, count: planes * perPlane, planes },
      100000,
      500,
    );
    expect(wrapped.length).toBeGreaterThan(edges.length);
  });

  it("uses explicit planeSizes instead of the greedy ceil layout", () => {
    // 7 satellites in 3 planes: greedy gives [3,3,1], the real layout is [2,2,3].
    const positions = linePositions(7);
    const shell = { startIndex: 0, count: 7, planes: 3, planeSizes: [2, 2, 3] };
    const edges = gridPatternIslCandidates(positions, shell, 100000, 500);

    // Plane boundaries at 0..1 | 2..3 | 4..6 — so 1<->2 must NOT be an in-plane
    // link, while 4<->6 (ring closure of the 3-satellite plane) must exist.
    expect(edges.some((e) => e.i === 4 && e.j === 6)).toBe(true);
    const greedy = gridPatternIslCandidates(
      positions,
      { startIndex: 0, count: 7, planes: 3 },
      100000,
      500,
    );
    expect(edges).not.toEqual(greedy);
  });
});

describe("coverageGeometry", () => {
  it("reproduces the θ(h, ε) reference values", () => {
    expect(earthCentralAngleDeg(550, 25)).toBeCloseTo(8.450822, 5);
    expect(earthCentralAngleDeg(780, 8.2)).toBeCloseTo(19.924742, 5);
    expect(earthCentralAngleDeg(20200, 5)).toBeCloseTo(71.168718, 5);
  });

  it("keeps θ + ε + η = 90°", () => {
    const theta = earthCentralAngleDeg(780, 8.2);
    const eta = 90 - 8.2 - theta;
    expect(theta + 8.2 + eta).toBeCloseTo(90, 12);
  });

  it("returns null for a street that cannot close", () => {
    const theta = earthCentralAngleDeg(780, 8.2) * DEG;
    expect(streetHalfWidthRad(theta, 11, 1)).not.toBeNull();
    // 4 satellites per plane: half-spacing 45° > θ = 19.9°.
    expect(streetHalfWidthRad(theta, 4, 1)).toBeNull();
  });

  it("computes the global cap-area lower bound", () => {
    const theta = earthCentralAngleDeg(550, 25) * DEG;
    expect(capAreaLowerBoundCount(1, theta, 1)).toBe(185);
  });

  it("throws for a non-positive altitude", () => {
    expect(() => earthCentralAngleDeg(0, 10)).toThrow();
  });
});

describe("streets_of_coverage", () => {
  const IRIDIUM = {
    altitudeKm: 780,
    minElevationDeg: 8.2,
    fold: 1,
    targetLatitudeDeg: 0,
    satsPerPlane: 11,
  };

  it("reproduces the Iridium design", () => {
    const design = designStreetsOfCoverage(IRIDIUM);
    expect(design.feasible).toBe(true);
    expect(design.thetaDeg).toBeCloseTo(19.925, 3);
    expect(design.c1Deg).toBeCloseTo(11.527, 3);
    expect(design.planes).toBe(6);
    expect(design.count).toBe(66);
    expect(design.deltaCoDeg).toBeCloseTo(31.389, 3);
    expect(design.deltaSeamDeg).toBeCloseTo(23.054, 3);
    expect(design.omegaDeg).toBeCloseTo(16.3636, 4);
    expect(design.spanDeg).toBeCloseTo(180, 9);
  });

  it("satisfies the plane-count inequality at P and violates it at P−1", () => {
    const design = designStreetsOfCoverage(IRIDIUM);
    const theta = design.thetaDeg;
    const cn = design.cnDeg;
    const seam = design.c1Deg + design.cnDeg;
    // requiredSpan(P) = 2P·asin[cos λ·cos((P−n)π/(2P))]; λ = 0 → n·180°.
    const required = (p: number) =>
      (2 * p * Math.asin(Math.cos(((p - 1) * Math.PI) / (2 * p)))) / DEG;
    const achievable = (p: number) => (p - 1) * (theta + cn) + seam;

    expect(achievable(design.planes)).toBeGreaterThanOrEqual(required(design.planes));
    expect(achievable(design.planes - 1)).toBeLessThan(required(design.planes - 1));
  });

  it("delegates to the star core, keeping Δco and ω", () => {
    const plan = planStreetsOfCoverage({
      pattern: "streets_of_coverage",
      apogee_altitude: 780,
      inclination: 86.4,
      soc_min_elevation: 8.2,
      soc_sats_per_plane: 11,
      soc_coverage_fold: 1,
      soc_target_latitude: 0,
    });
    expect(plan.plans).toHaveLength(6);
    expect(plan.wrapPlanes).toBe(false);
    plan.plans.forEach((p, i) => expect(p.raanDeg).toBeCloseTo(i * 31.389251, 5));
    expect(plan.plans[0].meanAnomaliesDeg).toHaveLength(11);
    expect(plan.plans[1].meanAnomaliesDeg[0] - plan.plans[0].meanAnomaliesDeg[0]).toBeCloseTo(
      16.3636,
      4,
    );
  });

  it("warns and falls back to the stored size when the design is infeasible", () => {
    const shell: PatternShellInput = {
      pattern: "streets_of_coverage",
      count: 12,
      planes: 3,
      apogee_altitude: 300,
      inclination: 86.4,
      soc_min_elevation: 40,
      soc_sats_per_plane: 4,
    };
    const design = designStreetsOfCoverage({
      altitudeKm: 300,
      minElevationDeg: 40,
      satsPerPlane: 4,
    });
    expect(design.feasible).toBe(false);
    expect(design.warnings.map((w) => w.code)).toContain("infeasible_coverage");

    let plan;
    expect(() => {
      plan = planStreetsOfCoverage(shell);
    }).not.toThrow();
    expect(plan!.plans).toHaveLength(3);
    expect(flatMeanAnomalies(plan!.plans)).toHaveLength(12);
    expect(plan!.warnings.map((w) => w.code)).toContain("infeasible_coverage");
  });

  it("marks n-fold sizing as an approximation", () => {
    const design = designStreetsOfCoverage({
      altitudeKm: 780,
      minElevationDeg: 8.2,
      fold: 2,
      satsPerPlane: 20,
    });
    expect(design.warnings.map((w) => w.code)).toContain("fold_approximation");
  });
});

describe("flower", () => {
  const FLOWER_15_1: PatternShellInput = {
    pattern: "flower",
    count: 8,
    planes: 8,
    flower_np: 15,
    flower_nd: 1,
    flower_fn: 1,
    flower_fd: 8,
    flower_fh: 0,
    inclination: 45,
    eccentricity: 0,
  };

  it("solves the compatible semi-major axis from (i, e, Np, Nd)", () => {
    expect(planFlower(FLOWER_15_1).orbit.semiMajorAxisKm).toBeCloseTo(6866.79, 3);

    expect(
      planFlower({ ...FLOWER_15_1, flower_np: 14, inclination: 86.4 }).orbit.semiMajorAxisKm,
    ).toBeCloseTo(7244.286, 3);

    const eccentric = {
      ...FLOWER_15_1,
      flower_np: 31,
      flower_nd: 2,
      flower_fh: 0,
      inclination: 63.4,
      eccentricity: 1e-3,
    };
    const solved = flowerOrbit(eccentric);
    expect(solved.orbit.semiMajorAxisKm).toBeCloseTo(6732.05, 3);
    expect(solved.solvedApogeeAltitudeKm).toBeCloseTo(360.645, 3);
  });

  it("keeps the phasing invariant Np·Ω_k + Nd·M_k constant (mod 360)", () => {
    // `plan()` intentionally does not enforce Ns_max, so this fixture (Ns = 49
    // over a 7-plane lattice) exercises the phase law itself; the colocation
    // limit is a separate validation test below.
    const wide: PatternShellInput = {
      pattern: "flower",
      count: 49,
      planes: 7,
      flower_np: 14,
      flower_nd: 1,
      flower_fn: 1,
      flower_fd: 7,
      flower_fh: 0,
      inclination: 45,
    };
    for (const shell of [
      wide,
      {
        pattern: "flower",
        count: 16,
        planes: 8,
        flower_np: 31,
        flower_nd: 2,
        flower_fn: 1,
        flower_fd: 8,
        flower_fh: 1,
        inclination: 63.4,
      } satisfies PatternShellInput,
    ]) {
      const params = flowerParams(shell);
      const plan = planFlower(shell);
      const invariants = plan.plans.flatMap((plane) =>
        plane.meanAnomaliesDeg.map(
          (ma) => (((params.np * plane.raanDeg + params.nd * ma) % 360) + 360) % 360,
        ),
      );
      for (const value of invariants) {
        expect(Math.min(value, 360 - value)).toBeCloseTo(0, 6);
      }
    }
  });

  it("computes Ns_max and rejects a colocated design", () => {
    const wide: PatternShellInput = {
      pattern: "flower",
      count: 49,
      planes: 7,
      flower_np: 14,
      flower_nd: 1,
      flower_fn: 1,
      flower_fd: 7,
      flower_fh: 0,
      inclination: 45,
    };
    expect(flowerMaxSatellites(flowerParams(wide))).toBe(7);
    const errors = validateShell(wide, 0);
    expect(errors.some((e) => e.field === "shell.0.count" && e.message.includes("Ns_max"))).toBe(
      true,
    );
    // Generation still succeeds, but flags the co-located slots.
    expect(planFlower(wide).warnings.map((w) => w.code)).toContain("fc_duplicate_slots");
  });

  it("rejects non-coprime (Np, Nd) and (Fn, Fd) and an out-of-range Fh", () => {
    const base: PatternShellInput = {
      pattern: "flower",
      count: 4,
      planes: 4,
      flower_np: 14,
      flower_nd: 2,
      flower_fn: 2,
      flower_fd: 4,
      flower_fh: 5,
      inclination: 45,
    };
    const fields = validateShell(base, 0).map((e) => e.field);
    expect(fields).toContain("shell.0.flower_np");
    expect(fields).toContain("shell.0.flower_fn");
    expect(fields).toContain("shell.0.flower_fh");
  });

  it("emits plane-major with monotone RAAN and reports uneven planes", () => {
    const plan = planFlower(FLOWER_15_1);
    const raans = plan.plans.map((p) => p.raanDeg);
    expect(raans).toEqual([...raans].sort((a, b) => a - b));
    expect(plan.plans.map((p) => p.meanAnomaliesDeg.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

    // Ns = 5 over Fd = 4 planes: two satellites in plane 0, one elsewhere.
    const uneven = planFlower({ ...FLOWER_15_1, count: 5, planes: 4, flower_fd: 4, flower_nd: 3 });
    expect(uneven.warnings.map((w) => w.code)).toContain("uneven_planes");
    expect(uneven.plans.map((p) => p.meanAnomaliesDeg.length).reduce((a, b) => a + b)).toBe(5);
  });

  it("warns on an apogee-altitude mismatch and generates from the solved value", () => {
    const shell = { ...FLOWER_15_1, apogee_altitude: 700 };
    const plan = planFlower(shell);
    expect(plan.warnings.map((w) => w.code)).toContain("derived_mismatch");
    expect(plan.orbit.semiMajorAxisKm).toBeCloseTo(6866.79, 3);

    const derived = computeShellDerived(shell);
    expect(derived.pattern).toBe("flower");
    if (derived.pattern !== "flower") return;
    expect(derived.apogeeAltitudeMismatchKm).toBeGreaterThan(1);
    expect(derived.solvedApogeeAltitudeKm).toBeCloseTo(488.653, 3);
  });
});

describe("lattice_flower (2D-LFC)", () => {
  const CASES: [number, number, number][] = [
    [4, 5, 1],
    [4, 5, 3],
    [8, 6, 2],
    [6, 9, 3],
  ];

  it("is element-wise identical to the equivalent Walker Delta", () => {
    for (const [no, nso, nc] of CASES) {
      const shell: PatternShellInput = {
        pattern: "lattice_flower",
        planes: no,
        count: no * nso,
        lfc_nc: nc,
        apogee_altitude: 1200,
        inclination: 87.9,
      };
      const lfc = planLatticeFlower(shell);
      const walker = planWalkerDelta({
        planes: no,
        count: no * nso,
        phasing: latticeWalkerF(no, nc),
        raan_range: 360,
        apogee_altitude: 1200,
        inclination: 87.9,
      });
      expect(lfc.plans).toEqual(walker.plans);
    }
  });

  it("matches lattice eq. (2) up to the documented whole-slot relabelling", () => {
    const [no, nso, nc] = [8, 6, 2];
    const shell: PatternShellInput = {
      pattern: "lattice_flower",
      planes: no,
      count: no * nso,
      lfc_nc: nc,
    };
    const params = latticeParams(shell);
    const plan = planLatticeFlower(shell);

    // Walker slot j of plane i equals lattice slot (j + i): F = No − Nc shifts
    // the plane by exactly one in-plane slot per plane index.
    for (const [i, j] of [
      [0, 0],
      [1, 0],
      [3, 4],
      [7, 5],
    ]) {
      const generated = plan.plans[i].meanAnomaliesDeg[j];
      const expected = latticeMeanAnomalyDeg(params, i, j + i);
      const diff = Math.abs(
        (((generated - expected) % 360) + 360) % 360,
      );
      expect(Math.min(diff, 360 - diff)).toBeCloseTo(0, 9);
      expect(plan.plans[i].raanDeg).toBeCloseTo((360 * i) / no, 9);
    }

    // Per plane the *sets* agree exactly.
    plan.plans.forEach((plane, i) => {
      const generated = sortedPlaneAnomalies(plane);
      const eq2 = Array.from({ length: nso }, (_, j) => latticeMeanAnomalyDeg(params, i, j))
        .map((m) => ((m % 360) + 360) % 360)
        .sort((a, b) => a - b);
      generated.forEach((value, k) => expect(value).toBeCloseTo(eq2[k], 9));
    });
  });

  it("rejects Nc outside 0..No−1 and reports the warning code", () => {
    const shell: PatternShellInput = {
      pattern: "lattice_flower",
      planes: 6,
      count: 36,
      lfc_nc: 6,
    };
    expect(validateShell(shell, 2).some((e) => e.field === "shell.2.lfc_nc")).toBe(true);
    expect(planLatticeFlower(shell).warnings.map((w) => w.code)).toContain("nc_out_of_range");
  });
});

describe("necklace_flower", () => {
  const NECKLACE: PatternShellInput = {
    pattern: "necklace_flower",
    planes: 6,
    count: 18,
    nec_pearls: 9,
    lfc_nc: 3,
    nec_necklace: [1, 4, 6],
    nec_shift: 2,
    apogee_altitude: 1200,
    inclination: 87.9,
  };

  it("computes Sym(G), admissibility and the resulting size", () => {
    expect(necklaceSymmetry([1, 4, 6], 9)).toBe(9);
    expect(isNecklaceAdmissible({ no: 6, nso: 9, nc: 3, necklace: [1, 4, 6], shift: 2 })).toBe(
      true,
    );

    const plan = planNecklaceFlower(NECKLACE);
    expect(plan.warnings).toEqual([]);
    expect(plan.plans).toHaveLength(6);
    expect(plan.plans.map((p) => p.meanAnomaliesDeg.length)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(flatMeanAnomalies(plan.plans)).toHaveLength(18);

    const derived = computeShellDerived(NECKLACE);
    expect(derived.pattern).toBe("necklace_flower");
    if (derived.pattern !== "necklace_flower") return;
    expect(derived.symmetry).toBe(9);
    expect(derived.admissible).toBe(true);
    expect(derived.totalSats).toBe(18);
    expect(derived.occupied).toBe(3);
  });

  it("rejects a non-admissible shift and lists the admissible ones", () => {
    // A necklace with Sym(G) = 3 ({1,4,7} on 9 slots) needs 3 | (k·6 − Nc).
    const params = { no: 6, nso: 9, nc: 3, necklace: [1, 4, 7], shift: 1 };
    expect(necklaceSymmetry([1, 4, 7], 9)).toBe(3);
    expect(isNecklaceAdmissible(params)).toBe(true);
    expect(isNecklaceAdmissible({ ...params, nc: 1 })).toBe(false);
    expect(admissibleShifts({ ...params, nc: 1 })).toEqual([]);

    const shell: PatternShellInput = {
      ...NECKLACE,
      lfc_nc: 1,
      nec_necklace: [1, 4, 7],
      nec_shift: 1,
    };
    const errors = validateShell(shell, 0);
    expect(errors.some((e) => e.field === "shell.0.nec_shift")).toBe(true);
    expect(planNecklaceFlower(shell).warnings.map((w) => w.code)).toContain(
      "necklace_not_admissible",
    );
  });

  it("reduces to the plain 2D-LFC for a full necklace", () => {
    const no = 6;
    const nso = 9;
    const nc = 3;
    const full = planNecklaceFlower({
      pattern: "necklace_flower",
      planes: no,
      nec_pearls: nso,
      lfc_nc: nc,
      nec_necklace: Array.from({ length: nso }, (_, i) => i + 1),
      nec_shift: 1,
      apogee_altitude: 1200,
      inclination: 87.9,
    });
    const lfc = planLatticeFlower({
      pattern: "lattice_flower",
      planes: no,
      count: no * nso,
      lfc_nc: nc,
      apogee_altitude: 1200,
      inclination: 87.9,
    });

    expect(full.plans).toHaveLength(lfc.plans.length);
    full.plans.forEach((plane, i) => {
      expect(plane.raanDeg).toBeCloseTo(lfc.plans[i].raanDeg, 9);
      // Same satellite *set* per plane; the necklace emits in pearl order, the
      // lattice in Walker slot order.
      const a = sortedPlaneAnomalies(plane);
      const b = sortedPlaneAnomalies(lfc.plans[i]);
      a.forEach((value, k) => expect(value).toBeCloseTo(b[k], 9));
    });
  });
});

describe("cross-pattern invariants", () => {
  for (const pattern of PATTERN_IDS) {
    it(`holds for ${pattern} with its PATTERN_DEFAULTS`, () => {
      const shell: PatternShellInput = { pattern, ...PATTERN_DEFAULTS[pattern] };
      const generated = generateShell(shell, EPOCH, 1);

      expect(generated.warnings.filter((w) => w.code !== "fold_approximation")).toEqual([]);
      expect(generated.planeSizes).toHaveLength(generated.planes);
      expect(generated.planeSizes.reduce((a, b) => a + b, 0)).toBe(generated.specs.length);
      expect(generated.satellites).toHaveLength(generated.specs.length);
      expect(generated.derived.pattern).toBe(pattern);

      // RAAN must be constant inside each plane block, and satnums contiguous.
      let index = 0;
      generated.planeSizes.forEach((size) => {
        const block = generated.specs.slice(index, index + size);
        const raans = new Set(
          block.map((s) => (s.type === "elements" ? s.elements.raanDeg : Number.NaN)),
        );
        expect(raans.size).toBeLessThanOrEqual(1);
        index += size;
      });
      generated.specs.forEach((spec, i) => {
        expect(spec.type).toBe("elements");
        if (spec.type !== "elements") return;
        expect(spec.elements.satnum).toBe(1 + i);
        expect(spec.elements.raanDeg).toBeGreaterThanOrEqual(0);
        expect(spec.elements.raanDeg).toBeLessThan(360);
        expect(spec.elements.meanAnomalyDeg).toBeGreaterThanOrEqual(0);
        expect(spec.elements.meanAnomalyDeg).toBeLessThan(360);
      });
    });
  }

  it("has a registry entry per PatternId, each declaring its own fields", () => {
    for (const pattern of PATTERN_IDS) {
      const generator = PATTERN_REGISTRY[pattern];
      expect(generator.id).toBe(pattern);
      expect(generator.fields).toContain("count");
      expect(generator.fields).toContain("planes");
    }
  });
});

describe("multi-shell TOML round trips", () => {
  const MIXED = `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "delta"
count = 12
planes = 3
apogee_altitude = 550
inclination = 53

[[constellation.shells]]
name = "iridium"
pattern = "streets_of_coverage"
count = 66
planes = 6
apogee_altitude = 780
inclination = 86.4
soc_min_elevation = 8.2
soc_sats_per_plane = 11

[[constellation.shells]]
name = "necklace"
pattern = "necklace_flower"
count = 18
planes = 6
apogee_altitude = 1200
inclination = 87.9
lfc_nc = 3
nec_pearls = 9
nec_necklace = [1, 4, 6]
nec_shift = 2
`;

  it("chains startIndex / count / planes across mixed patterns with a base offset", () => {
    const satellites = parseConstellationToml(MIXED);
    expect(satellites).toHaveLength(12 + 66 + 18);

    const ranges = generateShellRanges(parseConstellationConfig(MIXED), 7);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({ key: "0", name: "delta", startIndex: 7, count: 12, planes: 3 });
    expect(ranges[1]).toMatchObject({
      key: "1",
      name: "iridium",
      startIndex: 19,
      count: 66,
      planes: 6,
      wrapPlanes: false,
    });
    expect(ranges[2]).toMatchObject({
      key: "2",
      name: "necklace",
      startIndex: 85,
      count: 18,
      planes: 6,
    });
    // Uniform shells must not carry planeSizes (it would rewrite
    // src/lib/satellites.generated.ts for every existing constellation).
    expect(ranges[0].planeSizes).toBeUndefined();
    expect(ranges[0].wrapPlanes).toBeUndefined();
  });

  it("parses nec_necklace through both parsers and round-trips it", () => {
    expect(parseConstellationConfig(MIXED).shells[2]?.nec_necklace).toEqual([1, 4, 6]);

    const editorConfig = parseEditorConfig(MIXED);
    expect(editorConfig.shells[2]?.nec_necklace).toEqual([1, 4, 6]);
    expect(editorConfig.shells[2]?.pattern).toBe("necklace_flower");

    const reserialized = serializeConstellationConfig(editorConfig);
    expect(reserialized).toContain("nec_necklace = [1, 4, 6]");
    expect(parseEditorConfig(reserialized).shells[2]?.nec_necklace).toEqual([1, 4, 6]);

    // ...and the runtime path generates the same satellites from the rewrite.
    expect(parseConstellationToml(reserialized)).toHaveLength(12 + 66 + 18);
  });

  it("always serializes count and planes, using derived values", () => {
    const derivedPatterns: PatternId[] = [
      "streets_of_coverage",
      "flower",
      "lattice_flower",
      "necklace_flower",
    ];
    for (const pattern of derivedPatterns) {
      const shell = createNewShell(pattern);
      // Corrupt the stored size: the serializer must write the derived one.
      const toml = serializeConstellationConfig({
        epoch: EPOCH,
        shells: [{ ...shell, count: 1, planes: 1 }],
      });
      const expected = computeShellDerived({ ...shell, count: 1, planes: 1 });
      expect(toml).toContain(`count = ${expected.totalSats}`);
      expect(toml).toContain(`planes = ${expected.planes}`);
    }
  });

  it("round-trips a fractional phasing without clipping it", () => {
    // The registry deliberately gives `phasing` no `decimals`, so it is written
    // raw — `formatNumber(_, 4)` would save 1/3 as 0.3333.
    const shell = { ...createNewShell("walker_delta"), phasing: 1 / 3 };
    const toml = serializeConstellationConfig({ epoch: EPOCH, shells: [shell] });
    expect(toml).toContain(`phasing = ${1 / 3}`);
    expect(parseEditorConfig(toml).shells[0]?.phasing).toBe(1 / 3);
    expect(parseConstellationConfig(toml).shells[0]?.phasing).toBe(1 / 3);
  });

  it("keeps every walker_star RAAN inside [raan_start, raan_start + 180)", () => {
    const shell = { ...createNewShell("walker_star"), raan_start: 20 };
    const toml = serializeConstellationConfig({ epoch: EPOCH, shells: [shell] });
    const satellites = parseConstellationToml(toml);
    expect(satellites).toHaveLength(66);
    for (const sat of satellites) {
      expect(sat.type).toBe("elements");
      if (sat.type !== "elements") continue;
      expect(sat.elements.raanDeg).toBeGreaterThanOrEqual(20);
      expect(sat.elements.raanDeg).toBeLessThan(200);
    }
  });
});

describe("review regressions (post Phase 1-3)", () => {
  it("streets_of_coverage with altitude 0 never throws on the generation or serializer path", () => {
    const toml = `[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
pattern = "streets_of_coverage"
count = 66
planes = 6
inclination = 86.4
soc_sats_per_plane = 11
`;
    expect(() => buildConstellation(toml, 0)).not.toThrow();
    const built = buildConstellation(toml, 0);
    // Infeasible design → stored planes/count fallback, still 66 satellites.
    expect(built.satellites.length).toBe(66);
    const shell = { ...createNewShell("streets_of_coverage"), apogee_altitude: 0 };
    expect(() => serializeConstellationConfig({ epoch: new Date(0), shells: [shell] })).not.toThrow();
    expect(() => computeShellDerived(shell)).not.toThrow();
  });

  it("streets_of_coverage n=2 that fills 360° reports a full-circle layout and keeps the wrap link", () => {
    const shell = {
      ...createNewShell("streets_of_coverage"),
      apogee_altitude: 780,
      inclination: 90,
      soc_min_elevation: 8.2,
      soc_coverage_fold: 2,
      soc_sats_per_plane: 24,
    };
    const generated = generateShell(shell, new Date(0), 1);
    expect(generated.wrapPlanes).toBe(true);
    expect(generated.warnings.map((w) => w.code)).toContain("full_circle_layout");
  });

  it("walker_star raan_spacing survives serialize → parse even when it equals raan_range/planes", () => {
    const shell = {
      ...createNewShell("walker_star"),
      count: 12,
      planes: 6,
      phasing: 1,
      apogee_altitude: 550,
      inclination: 53,
      raan_range: 300,
      raan_spacing: 30,
    };
    const toml = serializeConstellationConfig({ epoch: new Date(0), shells: [shell] });
    expect(toml).toContain("raan_spacing = 30");
    const built = buildConstellation(toml, 0);
    const raans = built.satellites
      .map((s) => (s.type === "elements" ? s.elements.raanDeg : Number.NaN))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
    expect(raans).toEqual([0, 30, 60, 90, 120, 150]);
  });

  it("explicit planeSizes in an ISL range are clamped to the shell's count", () => {
    const positions: Vec3[] = Array.from({ length: 20 }, (_, i) => [7000 + i, 0, 0] as Vec3);
    const valid = positions.map(() => true);
    const edges = gridPatternIslCandidates(positions, valid, [
      { key: "0", startIndex: 0, count: 7, planes: 3, planeSizes: [5, 5, 5] },
    ] as never);
    for (const e of edges as Array<{ a?: number; b?: number; from?: number; to?: number } | [number, number]>) {
      const pair = Array.isArray(e) ? e : [e.a ?? e.from ?? 0, e.b ?? e.to ?? 0];
      expect(Math.max(...pair)).toBeLessThan(7);
    }
  });
});
