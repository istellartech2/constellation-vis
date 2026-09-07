/**
 * Plain, structured-cloneable data types for the mission-driven constellation
 * design engine (Phase 2 of docs/constellation-design.md).
 *
 * Everything in this module must survive `postMessage` — no `Date`, no class
 * instances, no functions. The Worker boundary (`src/workers/constellationDesignWorker.ts`)
 * passes `DesignRequest` in and `DesignResult`/`DesignCandidate` out verbatim.
 */

/**
 * Constellation families the optimizer enumerates. Flower/Lattice-Flower/
 * Necklace patterns are deliberately excluded: the coverage kernel's fast path
 * assumes `T = P·S` and `e = 0`, which those families break.
 */
export type PatternFamily = "walkerDelta" | "walkerStar";

/** Coverage target. `latitudeBand` bounds are geodetic degrees, latMin < latMax. */
export interface TargetRegion {
  kind: "global" | "latitudeBand";
  latMinDeg?: number;
  latMaxDeg?: number;
}

export interface DesignConstraints {
  /** Minimum elevation angle at the ground point, degrees. */
  minElevationDeg: number;
  /** Required simultaneous satellite count (N-fold coverage). */
  fold: 1 | 2 | 3 | 4;
  region: TargetRegion;
  altitudeMinKm: number;
  altitudeMaxKm: number;
  /** Defaults to `max(25, (altMax - altMin) / 20)`, capped to 24 altitude values. */
  altitudeStepKm?: number;
  inclinationMinDeg?: number;
  inclinationMaxDeg?: number;
  maxPlanes?: number;
  maxSatsPerPlane?: number;
  families?: PatternFamily[];
  rgt?: {
    enabled: boolean;
    minRepeatDays?: number;
    maxRepeatDays?: number;
    maxRepeatOrbits?: number;
  };
  /** Availability a candidate must reach to count as "continuous". Default 0.9999. */
  continuousThreshold?: number;
  /** Multiplies the Streets-of-Coverage plane spacing. Default 0.98. */
  spacingSafetyFactor?: number;
  /**
   * Reserved hook for future inter-satellite-link constraints. Typed `never` so
   * TypeScript callers cannot set it; `runDesign` throws if a runtime payload
   * (e.g. a stale Worker message) carries it, rather than silently ignoring it.
   */
  isl?: never;
}

export type DesignObjective =
  | { kind: "minSatellites" }
  | { kind: "paretoCountVsAltitude" }
  | { kind: "fixedBudget"; satelliteBudget: number };

export interface DesignRequest {
  constraints: DesignConstraints;
  objective: DesignObjective;
  /** Epoch used to build satrecs for stage-2 verification. ISO-8601 UTC. */
  epochIso: string;
  /** How many ranked candidates get numerically verified. Default 8. */
  topK?: number;
  /** `"high"` trades ~10x runtime for a 1° grid and a full-period time window. */
  fidelity?: "standard" | "high";
}

/** Everything needed to instantiate (and re-instantiate) one candidate. */
export interface CandidateParameters {
  family: PatternFamily;
  /** `T` in Walker notation. Always `planes * satsPerPlane`. */
  totalSatellites: number;
  /** `P` in Walker notation. */
  planes: number;
  /** `S` in Walker notation. */
  satsPerPlane: number;
  /** `F` in Walker notation, 0 ≤ F ≤ P-1. */
  phasingF: number;
  altitudeKm: number;
  inclinationDeg: number;
  /** Walker Star only: total RAAN span actually occupied, `(P-1)·Δco + Δseam`. */
  raanSpanDeg?: number;
  /** Walker Star only: RAAN gap across the counter-rotating seam. */
  seamGapDeg?: number;
  /** Walker Star only: RAAN spacing between co-rotating adjacent planes. */
  deltaCoDeg?: number;
  /** Walker Star only: the Streets-of-Coverage sizing inputs, kept for the shell. */
  socDesign?: {
    minElevationDeg: number;
    fold: number;
    targetLatitudeDeg: number;
    satsPerPlane: number;
  };
  repeatOrbits?: number;
  repeatDays?: number;
  /**
   * True when the coverage point set is invariant under `Δt = T_orb / S`, which
   * lets the kernel sample a `T_orb/S` window instead of a whole orbit. Requires
   * a circular orbit, uniform in-plane spacing and `T = P·S`.
   */
  kernelFastPath: boolean;
}

export type SizingMethod =
  | "streetsOfCoverage-inPlane"
  | "streetsOfCoverage-crossPlane"
  | "enumerated";

/** Closed-form metrics; no propagation involved. */
export interface AnalyticMetrics {
  /** Earth central angle θ at `minElevationDeg`, degrees. */
  centralAngleDeg: number;
  footprintRadiusKm: number;
  /** Streets-of-Coverage half street width, degrees (Star candidates only). */
  streetHalfWidthDeg?: number;
  /** Spherical-cap area lower bound on `T` for the requested region and fold. */
  capAreaLowerBoundCount: number;
  slantRangeAtEpsilonKm: number;
  latencyAtEpsilonMs: number;
  latencyNadirMs: number;
  orbitalPeriodSec: number;
  sizingMethod: SizingMethod;
}

/** Stage-1b coarse numeric screening (5° grid, 8 steps, spherical predicate). */
export interface ScreenMetrics {
  minFold: number;
  meanFold: number;
  foldAvailability: number;
  /** Number of predicate evaluations, for cost accounting. */
  testCount: number;
}

export interface VerifiedLatitudeRow {
  latitudeDeg: number;
  meanFold: number;
  foldAvailability: number;
  minFold: number;
}

/** Stage-2 SGP4 verification. */
export interface VerifiedMetrics {
  minFold: number;
  meanFold: number;
  foldAvailability: number;
  worstLatitudeDeg: number;
  maxGapSec: number;
  meanGapSec: number;
  gapCount: number;
  perLatitude: VerifiedLatitudeRow[];
  gridStepDeg: number;
  timeSteps: number;
  windowSec: number;
  ditherApplied: boolean;
  predicate: "spherical" | "ellipsoid";
  /**
   * Always `true`: `minFold` is the minimum over the sampled (point, time) grid,
   * so it is a lower bound that gets worse as the grid is refined. Use
   * `foldAvailability` for feasibility decisions, never `minFold`.
   */
  minFoldIsResolutionSensitive: true;
}

export type RejectionReason =
  | "reachability"
  | "capAreaBound"
  | "maxPlanes"
  | "maxSatsPerPlane"
  | "inclinationRange"
  | "streetInfeasible"
  | "belowThreshold";

export interface DesignCandidate {
  /** Stable identity, e.g. `wd-T192-P16-F8-h550-i87.5`. Used for dedupe and React keys. */
  key: string;
  parameters: CandidateParameters;
  analytic: AnalyticMetrics;
  screen?: ScreenMetrics;
  verified?: VerifiedMetrics;
  feasible: boolean;
  rejectionReason?: RejectionReason;
}

export interface DesignDiagnostics {
  /**
   * Candidate *objects* produced: every analytic Star candidate, the best
   * Delta candidate kept per (altitude, inclination) cell, and every rejected
   * one. Normally much smaller than `screenedCount`, because the Delta search
   * screens many (P, F) shapes per cell and keeps one.
   */
  generatedCount: number;
  /** Candidates a hard prefilter (P1/P2/P3, street infeasibility) discarded. */
  prefilteredCount: number;
  /** Coarse-screen *evaluations*, not candidates — the search's real cost driver. */
  screenedCount: number;
  verifiedCount: number;
  screenMs: number;
  verifyMs: number;
  warnings: string[];
}

export interface DesignResult {
  request: DesignRequest;
  /** Closed-form candidates only (Star sizing), returned immediately. */
  analyticCandidates: DesignCandidate[];
  /** Ranked, screened and (for the top-K) verified candidates. */
  candidates: DesignCandidate[];
  best?: DesignCandidate;
  diagnostics: DesignDiagnostics;
}

/** Availability threshold used when the request does not override it. */
export const DEFAULT_CONTINUOUS_THRESHOLD = 0.9999;

/**
 * The coarse screen uses the *spherical* predicate, which is pessimistic at LEO
 * relative to the WGS-84 elevation predicate used for verification, so the
 * screening gate is relaxed by this much to avoid discarding candidates that
 * would verify.
 */
export const SCREEN_THRESHOLD_MARGIN = 0.002;

/**
 * Streets-of-Coverage plane-spacing safety factor used when unspecified.
 *
 * The plan called for 0.98. It is 1 here, deliberately: `streetsOfCoverage.ts`
 * re-derives a shell's plane count from `designStreetsOfCoverage` with the
 * factor at its own default of 1, so a candidate sized with 0.98 would turn into
 * a *different* constellation the moment the user added it as a
 * `streets_of_coverage` shell (Iridium: P = 7/T = 77 sized, P = 6/T = 66 built).
 * Margin is what stage-2 verification is for. `candidateToShell` still handles a
 * user-supplied factor < 1 by emitting an explicit `walker_star` shell instead.
 */
export const DEFAULT_SPACING_SAFETY_FACTOR = 1;

/** Fallback for `DesignRequest.topK`. */
export const DEFAULT_TOP_K = 8;

/** What the mission wizard puts in its form by default (fewer verifications than `DEFAULT_TOP_K`). */
export const DEFAULT_DESIGN_TOP_K = 5;

/** Hard caps applied when the constraints leave `maxPlanes`/`maxSatsPerPlane` open. */
export const DEFAULT_MAX_PLANES = 60;
export const DEFAULT_MAX_SATS_PER_PLANE = 60;

/**
 * Screening budgets. One coarse screen measures ~0.3 ms here (5° grid, 8 steps,
 * a few hundred satellites), so 20 000 is about 6 s of screening — the point at
 * which a progress bar stops being enough. An unbounded divisor/phasing walk
 * would run for many minutes. When a budget binds, the engine records a
 * `diagnostics.warnings` entry instead of silently returning a worse answer.
 */
export const DEFAULT_SCREEN_BUDGET_TOTAL = 20000;
export const DEFAULT_SCREEN_BUDGET_PER_CELL = 400;

/** Comm-payload defaults for the mission wizard. */
export const DEFAULT_DESIGN_CONSTRAINTS: DesignConstraints = {
  minElevationDeg: 25,
  fold: 1,
  region: { kind: "global" },
  altitudeMinKm: 500,
  altitudeMaxKm: 1500,
  altitudeStepKm: 50,
  continuousThreshold: DEFAULT_CONTINUOUS_THRESHOLD,
  spacingSafetyFactor: DEFAULT_SPACING_SAFETY_FACTOR,
};

/** Resolved region bounds in geodetic degrees. */
export function regionLatitudeBounds(region: TargetRegion): { latMinDeg: number; latMaxDeg: number } {
  if (region.kind === "global") return { latMinDeg: -90, latMaxDeg: 90 };
  const lo = region.latMinDeg ?? -90;
  const hi = region.latMaxDeg ?? 90;
  return { latMinDeg: Math.min(lo, hi), latMaxDeg: Math.max(lo, hi) };
}

/**
 * Largest |latitude| the region contains — the latitude a Walker Delta's
 * inclination has to reach (prefilter P1).
 */
export function regionMaxAbsLatitudeDeg(region: TargetRegion): number {
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(region);
  return Math.max(Math.abs(latMinDeg), Math.abs(latMaxDeg));
}

/**
 * Smallest |latitude| the region contains — the Streets-of-Coverage target
 * latitude λ_n (0 for a global region or any band straddling the equator).
 */
export function regionMinAbsLatitudeDeg(region: TargetRegion): number {
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(region);
  if (latMinDeg <= 0 && latMaxDeg >= 0) return 0;
  return Math.min(Math.abs(latMinDeg), Math.abs(latMaxDeg));
}
