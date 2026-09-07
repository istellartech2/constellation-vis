/**
 * Public surface of the constellation pattern domain layer.
 *
 * Consumers: `tomlParsers.ts` (runtime/CLI/build generation),
 * `constellationSerializer.ts` (editor parse/serialize/validate),
 * `constellationTypes.ts` (editor shell type + per-pattern templates), and the
 * Phase 3 editor UI / Phase 4 mission-design engine.
 */

export type {
  DerivedRgt,
  GeneratedShell,
  PatternGenerator,
  PatternId,
  PatternShellInput,
  PlanePlan,
  SatelliteGeometry,
  ShellDerived,
  ShellDerivedCommon,
  ShellOrbit,
  ShellPlan,
  ShellWarning,
  ShellWarningCode,
  StreetsOfCoverageDesign,
  ValidationError,
} from "./types";
export {
  DEFAULT_PATTERN_ID,
  PATTERN_IDS,
  PATTERN_SHORT_LABELS,
  isPatternId,
  patternIdOf,
} from "./types";

export type { FieldKind, FieldSpec } from "./fields";
export {
  FIELD_REGISTRY,
  defaultFor,
  fieldKeysForPattern,
  fieldSpec,
  fieldsForPattern,
  intField,
  numberField,
} from "./fields";

export type { TomlScalar, TomlTableScan } from "./tomlTable";
export { parseTomlScalar, scanArrayTable } from "./tomlTable";

export type { AppliedShellFailures, ShellFailurePlan } from "./failure";
export {
  applyShellFailures,
  mulberry32,
  planShellFailures,
  resolveFailedCount,
  selectFailedIndices,
} from "./failure";

export type { EmittedShell } from "./emit";
export { emitShell, greedyPlaneSizes, normalizeAngleDeg, planGeometry, sameSizes } from "./emit";

export {
  EARTH_RADIUS_KM,
  MU_KM3_S2,
  gcd,
  orbitFromShell,
  periodMinFromSemiMajorAxis,
  semiMajorAxisFromApogeeAltitude,
} from "./orbit";

export type { GeneratedShellSpecs } from "./registry";
export {
  PATTERN_REGISTRY,
  generateShell,
  resolvePattern,
  shellPlanes,
  shellTotalSats,
  significantPlaneSizes,
  validateShell,
} from "./registry";

export { computeShellDerived } from "./derived";

export type { UniformLatticeSpec } from "./walkerDelta";
export {
  deriveWalkerDelta,
  lfcNcFromWalker,
  planWalkerDelta,
  uniformLattice,
  walkerNotation,
} from "./walkerDelta";

export type { StarCoreInput } from "./walkerStar";
export {
  deriveWalkerStar,
  planStarCore,
  planWalkerStar,
  starCoSpacingDeg,
  starCoreInput,
  starSeamDeg,
} from "./walkerStar";

export type { StreetsOfCoverageInput } from "./coverageGeometry";
export {
  SPEED_OF_LIGHT_KM_PER_SEC,
  bandAreaFraction,
  capAreaLowerBoundCount,
  coverageCapFraction,
  degToRad,
  designStreetsOfCoverage,
  earthCentralAngleDeg,
  earthCentralAngleRad,
  footprintRadiusKm,
  maxNadirAngleRad,
  nadirLatencyMs,
  oneWayLatencyMs,
  orbitalPeriodSec,
  radToDeg,
  slantRangeAtElevationKm,
  streetHalfWidthRad,
} from "./coverageGeometry";

export { deriveStreetsOfCoverage, planStreetsOfCoverage, socDesign } from "./streetsOfCoverage";

export type { FlowerOrbitSolution, FlowerParams } from "./flower";
export {
  deriveFlower,
  flowerMaxSatellites,
  flowerOrbit,
  flowerParams,
  flowerPlaneSizes,
  flowerSlots,
  planFlower,
} from "./flower";

export type { LatticeParams } from "./latticeFlower";
export {
  deriveLatticeFlower,
  latticeMeanAnomalyDeg,
  latticeParams,
  latticeWalkerF,
  planLatticeFlower,
} from "./latticeFlower";

export type { NecklaceParams } from "./necklaceFlower";
export {
  admissibleShifts,
  deriveNecklaceFlower,
  isNecklaceAdmissible,
  necklaceDeltaMDeg,
  necklaceParams,
  necklaceSymmetry,
  normalizeNecklace,
  planNecklaceFlower,
} from "./necklaceFlower";
