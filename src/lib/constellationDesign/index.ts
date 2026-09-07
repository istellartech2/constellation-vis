/**
 * Public surface of the mission-driven constellation design engine.
 *
 * The Phase 3/4 editor UI imports from here. The Worker deliberately imports
 * `enumerate.ts` directly instead, so `toShell.ts`'s `crypto.randomUUID` and the
 * editor shell types stay out of the Worker bundle.
 */

export type {
  AnalyticMetrics,
  CandidateParameters,
  DesignCandidate,
  DesignConstraints,
  DesignDiagnostics,
  DesignObjective,
  DesignRequest,
  DesignResult,
  PatternFamily,
  RejectionReason,
  ScreenMetrics,
  SizingMethod,
  TargetRegion,
  VerifiedLatitudeRow,
  VerifiedMetrics,
} from "./types";
export {
  DEFAULT_CONTINUOUS_THRESHOLD,
  DEFAULT_DESIGN_CONSTRAINTS,
  DEFAULT_DESIGN_TOP_K,
  DEFAULT_MAX_PLANES,
  DEFAULT_MAX_SATS_PER_PLANE,
  DEFAULT_SCREEN_BUDGET_PER_CELL,
  DEFAULT_SCREEN_BUDGET_TOTAL,
  DEFAULT_SPACING_SAFETY_FACTOR,
  DEFAULT_TOP_K,
  SCREEN_THRESHOLD_MARGIN,
  regionLatitudeBounds,
  regionMaxAbsLatitudeDeg,
  regionMinAbsLatitudeDeg,
} from "./types";

export type { DesignHooks, DesignProgress } from "./enumerate";
export {
  assertSupportedRequest,
  continuousThresholdOf,
  enumerateAnalytic,
  rankCandidates,
  runDesign,
  screenThresholdOf,
} from "./enumerate";

export type { CandidateToShellOptions, RelaxationSuggestion } from "./toShell";
export {
  candidateToShell,
  isExpressibleAsStreetsOfCoverage,
  relaxationSuggestions,
} from "./toShell";

export type { StarSizingResult } from "./starSizing";
export { enumerateStarCandidates } from "./starSizing";

export type { DeltaSearchHooks, DeltaSearchResult, DeltaShape, ScreenBudget } from "./deltaSizing";
export {
  createScreenBudget,
  deltaPhasingCandidates,
  deltaShapesForT,
  enumerateDeltaCandidates,
  snapToComposite,
} from "./deltaSizing";

export type { AltitudeSample, InclinationRange } from "./searchGrid";
export {
  altitudeSamplesForInclination,
  baseAltitudeSetKm,
  deltaInclinationSetDeg,
  resolveAltitudeStepKm,
  resolveInclinationRange,
  starInclinationDeg,
} from "./searchGrid";

export type { CandidateGeometry } from "./geometry";
export { candidateGeometry, candidateSatelliteSpecs, planeRaanDeg } from "./geometry";

export type {
  CoverageLatitudeRow,
  CoverageOptions,
  CoverageStats,
  GapPointSet,
  GapStats,
  KernelSample,
  KernelSampler,
  RegionGrid,
} from "./coverageKernel";
export {
  accumulateCoverage,
  accumulateGaps,
  buildGapPointSet,
  buildRegionGrid,
  createKernelSample,
} from "./coverageKernel";

export type { AnalyticSampler, ScreenOptions } from "./screen";
export { createAnalyticSampler, runAnalyticCoverage, screenCandidate } from "./screen";

export type { Sgp4Sampler, VerifyFidelitySettings, VerifyOptions } from "./verify";
export {
  createSgp4Sampler,
  createSgp4SamplerFromSpecs,
  resolveVerifyFidelity,
  verifyCandidate,
} from "./verify";
