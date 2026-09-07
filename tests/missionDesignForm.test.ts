import { describe, it, expect } from "bun:test";
import {
  DEFAULT_DESIGN_CONSTRAINTS,
  DEFAULT_DESIGN_TOP_K,
  candidateToShell,
  enumerateAnalytic,
  relaxationSuggestions,
} from "../src/lib/constellationDesign";
import type { DesignCandidate } from "../src/lib/constellationDesign";
import {
  DEFAULT_MISSION_FORM,
  applyRelaxedConstraints,
  budgetSuggestion,
  candidateStatus,
  constraintsFromShell,
  designShellName,
  dominatedCandidateKeys,
  formToRequest,
  sortCandidatesForDisplay,
  validateMissionForm,
  type MissionDesignForm,
} from "../src/lib/missionDesignForm";

const EPOCH_ISO = "2024-03-20T00:00:00Z";

function form(overrides: Partial<MissionDesignForm> = {}): MissionDesignForm {
  return { ...DEFAULT_MISSION_FORM, ...overrides };
}

describe("formToRequest", () => {
  it("maps the default form onto DEFAULT_DESIGN_CONSTRAINTS", () => {
    const request = formToRequest(DEFAULT_MISSION_FORM, EPOCH_ISO);
    expect(request.constraints).toEqual(DEFAULT_DESIGN_CONSTRAINTS);
    expect(request.objective).toEqual({ kind: "minSatellites" });
    expect(request.epochIso).toBe(EPOCH_ISO);
    expect(request.topK).toBe(DEFAULT_DESIGN_TOP_K);
  });

  it("omits every optional constraint by default", () => {
    const { constraints } = formToRequest(DEFAULT_MISSION_FORM, EPOCH_ISO);
    expect("inclinationMinDeg" in constraints).toBe(false);
    expect("inclinationMaxDeg" in constraints).toBe(false);
    expect("families" in constraints).toBe(false);
    expect("rgt" in constraints).toBe(false);
  });

  it("maps a latitude band region and normalizes reversed bounds", () => {
    const request = formToRequest(
      form({ region: "latitudeBand", latMinDeg: 55, latMaxDeg: -35 }),
      EPOCH_ISO,
    );
    expect(request.constraints.region).toEqual({
      kind: "latitudeBand",
      latMinDeg: -35,
      latMaxDeg: 55,
    });
  });

  it("ignores latitude fields when the region is global", () => {
    const request = formToRequest(form({ latMinDeg: -10, latMaxDeg: 10 }), EPOCH_ISO);
    expect(request.constraints.region).toEqual({ kind: "global" });
  });

  it("maps the fixedBudget objective with its satellite budget", () => {
    const request = formToRequest(
      form({ objective: "fixedBudget", satelliteBudget: 47 }),
      EPOCH_ISO,
    );
    expect(request.objective).toEqual({ kind: "fixedBudget", satelliteBudget: 47 });
  });

  it("maps the pareto objective", () => {
    const request = formToRequest(form({ objective: "paretoCountVsAltitude" }), EPOCH_ISO);
    expect(request.objective).toEqual({ kind: "paretoCountVsAltitude" });
  });

  it("passes the RGT flag through as an enabled constraint", () => {
    const request = formToRequest(form({ rgt: true }), EPOCH_ISO);
    expect(request.constraints.rgt).toEqual({ enabled: true });
  });

  it("restricts the family when the form picks one", () => {
    expect(formToRequest(form({ family: "walkerDelta" }), EPOCH_ISO).constraints.families).toEqual([
      "walkerDelta",
    ]);
    expect(formToRequest(form({ family: "walkerStar" }), EPOCH_ISO).constraints.families).toEqual([
      "walkerStar",
    ]);
    expect(formToRequest(form({ family: "all" }), EPOCH_ISO).constraints.families).toBeUndefined();
  });

  it("emits an inclination range only when requested, normalized", () => {
    const request = formToRequest(
      form({ restrictInclination: true, inclinationMinDeg: 98, inclinationMaxDeg: 52 }),
      EPOCH_ISO,
    );
    expect(request.constraints.inclinationMinDeg).toBe(52);
    expect(request.constraints.inclinationMaxDeg).toBe(98);
  });

  it("normalizes a reversed altitude range and rounds topK / budget", () => {
    const request = formToRequest(
      form({
        altitudeMinKm: 1200,
        altitudeMaxKm: 600,
        topK: 4.6,
        objective: "fixedBudget",
        satelliteBudget: 48.4,
      }),
      EPOCH_ISO,
    );
    expect(request.constraints.altitudeMinKm).toBe(600);
    expect(request.constraints.altitudeMaxKm).toBe(1200);
    expect(request.topK).toBe(5);
    expect(request.objective).toEqual({ kind: "fixedBudget", satelliteBudget: 48 });
  });

  it("clamps the fold into the engine's 1..4 union", () => {
    expect(formToRequest(form({ fold: 9 }), EPOCH_ISO).constraints.fold).toBe(4);
    expect(formToRequest(form({ fold: 0 }), EPOCH_ISO).constraints.fold).toBe(1);
  });
});

describe("validateMissionForm", () => {
  it("accepts the defaults", () => {
    expect(validateMissionForm(DEFAULT_MISSION_FORM)).toEqual([]);
  });

  it("rejects blank (NaN) numeric inputs", () => {
    const errors = validateMissionForm(form({ minElevationDeg: NaN }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("最低仰角"))).toBe(true);
  });

  it("rejects an out-of-range elevation", () => {
    expect(validateMissionForm(form({ minElevationDeg: 75 })).length).toBeGreaterThan(0);
    expect(validateMissionForm(form({ minElevationDeg: -1 })).length).toBeGreaterThan(0);
  });

  it("rejects an inverted altitude range and out-of-range altitudes", () => {
    expect(
      validateMissionForm(form({ altitudeMinKm: 1500, altitudeMaxKm: 500 })).length,
    ).toBeGreaterThan(0);
    expect(validateMissionForm(form({ altitudeMaxKm: 5000 })).length).toBeGreaterThan(0);
  });

  it("rejects a degenerate latitude band only when the band is in use", () => {
    expect(validateMissionForm(form({ latMinDeg: 60, latMaxDeg: -60 }))).toEqual([]);
    expect(
      validateMissionForm(form({ region: "latitudeBand", latMinDeg: 60, latMaxDeg: -60 })).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a non-integer fold, budget and K", () => {
    expect(validateMissionForm(form({ fold: 1.5 })).length).toBeGreaterThan(0);
    expect(
      validateMissionForm(form({ objective: "fixedBudget", satelliteBudget: 0 })).length,
    ).toBeGreaterThan(0);
    expect(validateMissionForm(form({ topK: 21 })).length).toBeGreaterThan(0);
  });

  it("ignores the budget unless the objective needs it", () => {
    expect(validateMissionForm(form({ satelliteBudget: NaN }))).toEqual([]);
  });

  it("ignores the inclination range unless it is enabled", () => {
    expect(validateMissionForm(form({ inclinationMinDeg: NaN }))).toEqual([]);
    expect(
      validateMissionForm(form({ restrictInclination: true, inclinationMinDeg: NaN })).length,
    ).toBeGreaterThan(0);
  });
});

describe("applyRelaxedConstraints", () => {
  it("folds every relaxation suggestion back into the form", () => {
    const source = form({
      minElevationDeg: 60,
      fold: 4,
      altitudeMinKm: 300,
      altitudeMaxKm: 400,
      topK: 7,
      family: "walkerStar",
    });
    const constraints = formToRequest(source, EPOCH_ISO).constraints;
    for (const suggestion of relaxationSuggestions(constraints)) {
      const relaxed = applyRelaxedConstraints(source, suggestion.apply(constraints));
      // Fields the suggestions never touch survive.
      expect(relaxed.topK).toBe(7);
      expect(relaxed.family).toBe("walkerStar");
      expect(validateMissionForm(relaxed)).toEqual([]);
    }
  });

  it("imports the relaxed latitude band", () => {
    const constraints = formToRequest(DEFAULT_MISSION_FORM, EPOCH_ISO).constraints;
    const band = relaxationSuggestions(constraints).find((s) => s.label.includes("緯度"));
    expect(band).toBeDefined();
    const relaxed = applyRelaxedConstraints(DEFAULT_MISSION_FORM, band!.apply(constraints));
    expect(relaxed.region).toBe("latitudeBand");
    expect(relaxed.latMinDeg).toBe(-60);
    expect(relaxed.latMaxDeg).toBe(60);
  });
});

describe("constraintsFromShell", () => {
  it("falls back to the defaults for a shell without provenance", () => {
    expect(constraintsFromShell({ count: 24, planes: 3 })).toEqual(DEFAULT_MISSION_FORM);
  });

  it("ignores an unknown objective string", () => {
    expect(constraintsFromShell({ mission_objective: "somethingElse" }).objective).toBe(
      DEFAULT_MISSION_FORM.objective,
    );
  });

  it("round-trips a candidate's constraints through candidateToShell", () => {
    const source = form({
      objective: "minSatellites",
      minElevationDeg: 30,
      fold: 2,
      region: "latitudeBand",
      latMinDeg: -50,
      latMaxDeg: 50,
      altitudeMinKm: 700,
      altitudeMaxKm: 700,
    });
    const request = formToRequest(source, EPOCH_ISO);
    const candidate = enumerateAnalytic(request).analyticCandidates[0];
    expect(candidate).toBeDefined();

    const shell = candidateToShell(candidate, { request, name: "round trip" });
    expect(shell.mission_objective).toBe("minSatellites");

    const recovered = constraintsFromShell(shell);
    expect(recovered.objective).toBe("minSatellites");
    expect(recovered.minElevationDeg).toBe(30);
    expect(recovered.fold).toBe(2);
    expect(recovered.region).toBe("latitudeBand");
    expect(recovered.latMinDeg).toBe(-50);
    expect(recovered.latMaxDeg).toBe(50);
    expect(recovered.altitudeMinKm).toBe(700);
    expect(recovered.altitudeMaxKm).toBe(700);
  });

  it("recovers a global region without importing the stored ±90 bounds", () => {
    const request = formToRequest(form({ minElevationDeg: 20 }), EPOCH_ISO);
    const candidate = enumerateAnalytic(request).analyticCandidates[0];
    const shell = candidateToShell(candidate, { request });
    expect(shell.mission_lat_min).toBe(-90);

    const recovered = constraintsFromShell(shell);
    expect(recovered.region).toBe("global");
    expect(recovered.latMinDeg).toBe(DEFAULT_MISSION_FORM.latMinDeg);
    expect(recovered.latMaxDeg).toBe(DEFAULT_MISSION_FORM.latMaxDeg);
  });

  it("recovers the satellite budget from the shell count for fixedBudget", () => {
    const request = formToRequest(
      form({ objective: "fixedBudget", satelliteBudget: 300 }),
      EPOCH_ISO,
    );
    const candidate = enumerateAnalytic(request).analyticCandidates[0];
    const shell = candidateToShell(candidate, { request });
    const recovered = constraintsFromShell(shell);
    expect(recovered.objective).toBe("fixedBudget");
    expect(recovered.satelliteBudget).toBe(shell.count);
  });
});

describe("designShellName", () => {
  it("names a shell from the pattern the candidate turns into", () => {
    const request = formToRequest(DEFAULT_MISSION_FORM, EPOCH_ISO);
    const candidate = enumerateAnalytic(request).analyticCandidates[0];
    const shell = candidateToShell(candidate, { request });
    const name = designShellName(shell);
    expect(name.startsWith("設計案 ")).toBe(true);
    expect(name).toContain(String(shell.count));
    expect(name).toContain(String(shell.planes));
  });
});

/* -------------------------------------------------------------------------- */
/* Table presentation helpers                                                 */
/* -------------------------------------------------------------------------- */

function fakeCandidate(
  key: string,
  totalSatellites: number,
  altitudeKm: number,
  extra: Partial<DesignCandidate> = {},
): DesignCandidate {
  return {
    key,
    parameters: {
      family: "walkerDelta",
      totalSatellites,
      planes: 1,
      satsPerPlane: totalSatellites,
      phasingF: 0,
      altitudeKm,
      inclinationDeg: 53,
      kernelFastPath: true,
    },
    analytic: {
      centralAngleDeg: 10,
      footprintRadiusKm: 1000,
      capAreaLowerBoundCount: 10,
      slantRangeAtEpsilonKm: 1500,
      latencyAtEpsilonMs: 5,
      latencyNadirMs: 2,
      orbitalPeriodSec: 5700,
      sizingMethod: "enumerated",
    },
    feasible: true,
    ...extra,
  };
}

const screenMetrics = { minFold: 1, meanFold: 2, foldAvailability: 1, testCount: 10 };

describe("candidateStatus", () => {
  it("reports unverified rows and cancelled rows", () => {
    const c = fakeCandidate("a", 100, 500, { feasible: false });
    expect(candidateStatus(c, "enumerating")).toBe("unverified");
    expect(candidateStatus(c, "cancelled")).toBe("cancelled");
  });

  it("reports in-flight screened rows while verifying", () => {
    const c = fakeCandidate("a", 100, 500, { screen: screenMetrics });
    expect(candidateStatus(c, "verifying")).toBe("verifying");
    expect(candidateStatus(c, "done")).toBe("unverified");
  });

  it("flags a large screen-vs-verify gap", () => {
    const verified = {
      minFold: 0,
      meanFold: 2,
      foldAvailability: 0.9,
      worstLatitudeDeg: 0,
      maxGapSec: 60,
      meanGapSec: 30,
      gapCount: 1,
      perLatitude: [],
      gridStepDeg: 2,
      timeSteps: 32,
      windowSec: 600,
      ditherApplied: true,
      predicate: "ellipsoid" as const,
      minFoldIsResolutionSensitive: true as const,
    };
    const attention = fakeCandidate("a", 100, 500, { screen: screenMetrics, verified });
    expect(candidateStatus(attention, "done")).toBe("attention");

    const ng = fakeCandidate("b", 100, 500, { screen: screenMetrics, verified, feasible: false });
    expect(candidateStatus(ng, "done")).toBe("verifiedNg");

    const ok = fakeCandidate("c", 100, 500, {
      screen: screenMetrics,
      verified: { ...verified, foldAvailability: 1 },
    });
    expect(candidateStatus(ok, "done")).toBe("verifiedOk");
  });
});

describe("sortCandidatesForDisplay", () => {
  it("puts verified rows first, then screened, then analytic-only", () => {
    const analytic = fakeCandidate("analytic", 10, 500);
    const screened = fakeCandidate("screened", 500, 1500, { screen: screenMetrics });
    const verified = fakeCandidate("verified", 900, 1500, {
      screen: screenMetrics,
      verified: {
        minFold: 1,
        meanFold: 2,
        foldAvailability: 1,
        worstLatitudeDeg: 0,
        maxGapSec: 0,
        meanGapSec: 0,
        gapCount: 0,
        perLatitude: [],
        gridStepDeg: 2,
        timeSteps: 32,
        windowSec: 600,
        ditherApplied: true,
        predicate: "ellipsoid",
        minFoldIsResolutionSensitive: true,
      },
    });
    const order = sortCandidatesForDisplay([analytic, screened, verified], "minSatellites");
    expect(order.map((c) => c.key)).toEqual(["verified", "screened", "analytic"]);
  });

  it("orders by count then altitude inside the same rank", () => {
    const a = fakeCandidate("a", 100, 900);
    const b = fakeCandidate("b", 100, 600);
    const c = fakeCandidate("c", 80, 1500);
    expect(sortCandidatesForDisplay([a, b, c], "minSatellites").map((x) => x.key)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});

describe("dominatedCandidateKeys", () => {
  it("marks rows beaten on both count and altitude", () => {
    const good = fakeCandidate("good", 80, 600, { screen: screenMetrics });
    const worse = fakeCandidate("worse", 120, 900, { screen: screenMetrics });
    const tradeoff = fakeCandidate("tradeoff", 60, 1200, { screen: screenMetrics });
    const dominated = dominatedCandidateKeys([good, worse, tradeoff]);
    expect(dominated.has("worse")).toBe(true);
    expect(dominated.has("good")).toBe(false);
    expect(dominated.has("tradeoff")).toBe(false);
  });

  it("ignores rows that were never evaluated", () => {
    const good = fakeCandidate("good", 80, 600, { screen: screenMetrics });
    const raw = fakeCandidate("raw", 120, 900);
    expect(dominatedCandidateKeys([good, raw]).size).toBe(0);
  });
});

describe("sortCandidatesForDisplay — feasibility rank", () => {
  it("puts a verified feasible row ahead of a verified NG row with the same T and h", () => {
    const base = (key: string, feasible: boolean): DesignCandidate =>
      ({
        key,
        parameters: {
          family: "walkerDelta",
          totalSatellites: 84,
          planes: 7,
          satsPerPlane: 12,
          phasingF: 4,
          altitudeKm: 1500,
          inclinationDeg: 90,
          kernelFastPath: true,
        },
        analytic: {} as DesignCandidate["analytic"],
        verified: { foldAvailability: feasible ? 1 : 0.9986 } as DesignCandidate["verified"],
        feasible,
      }) as DesignCandidate;
    const sorted = sortCandidatesForDisplay([base("ng", false), base("ok", true)], "minSatellites");
    expect(sorted.map((c) => c.key)).toEqual(["ok", "ng"]);
  });
});

describe("budgetSuggestion", () => {
  const constraints = formToRequest(form({ objective: "fixedBudget", satelliteBudget: 48 }), EPOCH_ISO)
    .constraints;
  const star = (totalSatellites: number): DesignCandidate =>
    ({
      key: `star-${totalSatellites}`,
      parameters: {
        family: "walkerStar",
        totalSatellites,
        planes: 7,
        satsPerPlane: totalSatellites / 7,
        phasingF: 3,
        altitudeKm: 1500,
        inclinationDeg: 90,
        kernelFastPath: true,
      },
      analytic: {} as DesignCandidate["analytic"],
      feasible: true,
    }) as DesignCandidate;

  it("returns null for objectives other than fixedBudget", () => {
    expect(budgetSuggestion(form({ objective: "minSatellites" }), constraints, [star(84)])).toBeNull();
  });

  it("raises the budget to the smallest enumerated analytic candidate", () => {
    const s = budgetSuggestion(form({ objective: "fixedBudget", satelliteBudget: 48 }), constraints, [
      star(140),
      star(84),
    ]);
    expect(s).not.toBeNull();
    expect(s!.form.satelliteBudget).toBe(84);
    expect(s!.label).toContain("48 → 84");
  });

  it("falls back to the cap-area lower bound when nothing was enumerated", () => {
    const s = budgetSuggestion(form({ objective: "fixedBudget", satelliteBudget: 10 }), constraints, []);
    expect(s).not.toBeNull();
    expect(s!.form.satelliteBudget).toBeGreaterThan(10);
  });

  it("returns null when the budget already covers the smallest candidate", () => {
    expect(
      budgetSuggestion(form({ objective: "fixedBudget", satelliteBudget: 100 }), constraints, [star(84)]),
    ).toBeNull();
  });
});
