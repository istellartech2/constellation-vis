import * as satellite from "satellite.js";
import { getSatelliteDerivedInfo } from "./satelliteDerivedInfo";
import {
  calculateAtmosphericDensity,
  calculateDetailedPerturbationRates,
  type AtmosphereModelInput,
  type OrbitalElements as PerturbationOrbitalElements,
} from "./perturbation";
import type { SatelliteSpec } from "./satellites";
import { toSatrec } from "./satellites";
export { buildSelectableSatellites, type SelectableSatellite } from "./analysisSatellites";

const EARTH_RADIUS_KM = 6378.137;
const G0 = 9.80665;
const DAYS_PER_YEAR = 365.25;

export type AtmospherePresetKey = "quiet" | "nominal" | "active" | "storm";

export type MaintenanceSweepParameter =
  | "ballisticCoefficient"
  | "f107"
  | "ap"
  | "specificImpulseSec"
  | "propellantMassKg"
  | "missionYears"
  | "meanAltitudeKm"
  | "eccentricity";

export type OrbitType = "circular" | "elliptical";

export interface MaintenanceAnalysisInput {
  orbitType: OrbitType;
  missionYears: number;
  meanAltitudeKm: number;
  eccentricity: number;
  inclinationDeg: number;
  dryMassKg: number;
  ballisticCoefficient: number;
  deorbitAltitudeKm: number;
  specificImpulseSec: number;
  propellantMassKg: number;
  propellantMarginPercent: number;
  timelineStepDays: number;
  atmosphereModel: "harris-priester";
  atmospherePreset: AtmospherePresetKey;
  f107: number;
  ap: number;
  sweepParameter: MaintenanceSweepParameter;
  sweepStart: number;
  sweepEnd: number;
  sweepSteps: number;
}

export interface MaintenanceTimelinePoint {
  timestamp: number;
  elapsedYears: number;
  altitudeKm: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  densityKgPerM3: number;
  densityReferenceAltitudeKm: number;
}

export interface MaintenanceAnnualBudgetPoint {
  yearIndex: number;
  label: string;
  altitudeLossKm: number;
  deltaV_mps: number;
  propellantKg: number;
}

export interface MaintenanceKpi {
  atmosphereModelLabel: string;
  f107: number;
  ap: number;
  initialAltitudeKm: number;
  initialPerigeeAltitudeKm: number;
  initialApogeeAltitudeKm: number;
  initialEccentricity: number;
  annualAltitudeLossKm: number;
  annualDeltaV_mps: number;
  missionDeltaV_mps: number;
  requiredPropellantKg: number;
  requiredPropellantWithMarginKg: number;
  availablePropellantKg: number;
  naturalLifetimeYears: number;
  naturalLifetimeReached: boolean;
  meanDensityKgPerM3: number;
  worstAnnualLossKm: number;
  ballisticCoefficient: number;
  designStatus: "nominal" | "warning" | "critical";
}

export interface MaintenanceScenarioComparison {
  key: AtmospherePresetKey;
  label: string;
  annualAltitudeLossKm: number;
  missionDeltaV_mps: number;
  requiredPropellantKg: number;
  naturalLifetimeYears: number;
  naturalLifetimeReached: boolean;
}

export interface MaintenanceSweepPoint {
  inputValue: number;
  annualDeltaV_mps: number;
  requiredPropellantKg: number;
  naturalLifetimeYears: number;
}

export interface MaintenanceAnalysisResult {
  satelliteLabel: string;
  analysisInput: MaintenanceAnalysisInput;
  timeline: MaintenanceTimelinePoint[];
  annualBudget: MaintenanceAnnualBudgetPoint[];
  scenarioComparisons: MaintenanceScenarioComparison[];
  sweep: MaintenanceSweepPoint[];
  currentScenarioLabel: string;
  worstScenario: MaintenanceScenarioComparison;
  kpi: MaintenanceKpi;
}

interface AtmosphereScenarioDefinition {
  key: AtmospherePresetKey;
  label: string;
  f107: number;
  ap: number;
  diurnalBulgeFactor: number;
}

const ATMOSPHERE_PRESETS: Record<AtmospherePresetKey, AtmosphereScenarioDefinition> = {
  quiet: {
    key: "quiet",
    label: "Quiet",
    f107: 70,
    ap: 4,
    diurnalBulgeFactor: 0.35,
  },
  nominal: {
    key: "nominal",
    label: "Nominal",
    f107: 150,
    ap: 15,
    diurnalBulgeFactor: 0.5,
  },
  active: {
    key: "active",
    label: "Active",
    f107: 220,
    ap: 40,
    diurnalBulgeFactor: 0.65,
  },
  storm: {
    key: "storm",
    label: "Storm",
    f107: 280,
    ap: 80,
    diurnalBulgeFactor: 0.8,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getAtmospherePresetDefaults(preset: AtmospherePresetKey): Pick<MaintenanceAnalysisInput, "f107" | "ap"> {
  const config = ATMOSPHERE_PRESETS[preset];
  return {
    f107: config.f107,
    ap: config.ap,
  };
}

function getSatelliteElements(spec: SatelliteSpec): PerturbationOrbitalElements {
  if (spec.type === "elements") {
    return {
      semiMajorAxisKm: spec.elements.semiMajorAxisKm,
      eccentricity: spec.elements.eccentricity,
      inclinationDeg: spec.elements.inclinationDeg,
      raanDeg: spec.elements.raanDeg,
      argPerigeeDeg: spec.elements.argPerigeeDeg,
      meanAnomalyDeg: spec.elements.meanAnomalyDeg,
    };
  }

  const rec = toSatrec(spec);
  return {
    semiMajorAxisKm: rec.a * EARTH_RADIUS_KM,
    eccentricity: rec.ecco,
    inclinationDeg: satellite.radiansToDegrees(rec.inclo),
    raanDeg: satellite.radiansToDegrees(rec.nodeo),
    argPerigeeDeg: satellite.radiansToDegrees(rec.argpo),
    meanAnomalyDeg: satellite.radiansToDegrees(rec.mo),
  };
}

function computeDefaultReferenceAltitudeKm(spec: SatelliteSpec, startTime: Date): number {
  const derived = getSatelliteDerivedInfo(spec, startTime);
  const altitude = derived.currentAltitudeKm ?? ((derived.perigeeAltitudeKm + derived.apogeeAltitudeKm) / 2);
  return Math.max(altitude, 200);
}

function createAtmosphereInput(input: MaintenanceAnalysisInput, preset?: AtmospherePresetKey): AtmosphereModelInput {
  const presetConfig = ATMOSPHERE_PRESETS[preset ?? input.atmospherePreset];
  return {
    model: "harris-priester",
    f107: input.f107,
    ap: input.ap,
    diurnalBulgeFactor: presetConfig.diurnalBulgeFactor,
    lowOrbitLimitKm: 1500,
  };
}

export function createDefaultMaintenanceInput(defaultAltitudeKm = 550): MaintenanceAnalysisInput {
  return {
    orbitType: "circular",
    missionYears: 3,
    meanAltitudeKm: defaultAltitudeKm,
    eccentricity: 0,
    inclinationDeg: 97.6,
    dryMassKg: 100,
    ballisticCoefficient: 0.022,
    deorbitAltitudeKm: 250,
    specificImpulseSec: 220,
    propellantMassKg: 6,
    propellantMarginPercent: 20,
    timelineStepDays: 15,
    atmosphereModel: "harris-priester",
    atmospherePreset: "nominal",
    f107: 150,
    ap: 15,
    sweepParameter: "ballisticCoefficient",
    sweepStart: 0.01,
    sweepEnd: 0.05,
    sweepSteps: 9,
  };
}

function normalizeInput(input: MaintenanceAnalysisInput): MaintenanceAnalysisInput {
  return {
    orbitType: input.orbitType,
    missionYears: clamp(input.missionYears, 0.5, 15),
    meanAltitudeKm: clamp(input.meanAltitudeKm, 180, 2000),
    eccentricity: input.orbitType === "circular" ? 0 : clamp(input.eccentricity, 0, 0.8),
    inclinationDeg: clamp(input.inclinationDeg, 0, 180),
    dryMassKg: clamp(input.dryMassKg, 1, 5000),
    ballisticCoefficient: clamp(input.ballisticCoefficient, 0.001, 0.2),
    deorbitAltitudeKm: clamp(input.deorbitAltitudeKm, 120, 500),
    specificImpulseSec: clamp(input.specificImpulseSec, 10, 5000),
    propellantMassKg: clamp(input.propellantMassKg, 0, 500),
    propellantMarginPercent: clamp(input.propellantMarginPercent, 0, 100),
    timelineStepDays: clamp(Math.round(input.timelineStepDays), 1, 90),
    atmosphereModel: "harris-priester",
    atmospherePreset: input.atmospherePreset,
    f107: clamp(input.f107, 50, 400),
    ap: clamp(input.ap, 0, 400),
    sweepParameter: input.sweepParameter,
    sweepStart: input.sweepStart,
    sweepEnd: input.sweepEnd,
    sweepSteps: clamp(Math.round(input.sweepSteps), 2, 25),
  };
}

function circularOrbitDeltaVForAltitudeRaise(currentAltitudeKm: number, targetAltitudeKm: number): number {
  const r1 = (EARTH_RADIUS_KM + currentAltitudeKm) * 1000;
  const r2 = (EARTH_RADIUS_KM + targetAltitudeKm) * 1000;
  if (r1 <= 0 || r2 <= 0 || r2 <= r1) return 0;
  const mu = 3.986004418e14;
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  return Math.abs(dv1) + Math.abs(dv2);
}

function requiredPropellantKg(deltaV_mps: number, dryMassKg: number, specificImpulseSec: number): number {
  if (deltaV_mps <= 0) return 0;
  const massRatio = Math.exp(deltaV_mps / (specificImpulseSec * G0));
  return dryMassKg * (massRatio - 1);
}

function computeDesignStatus(requiredWithMarginKg: number, availableKg: number): MaintenanceKpi["designStatus"] {
  if (requiredWithMarginKg > availableKg) return "critical";
  if (requiredWithMarginKg > availableKg * 0.85) return "warning";
  return "nominal";
}

function simulateNaturalDecay(
  spec: SatelliteSpec,
  startTime: Date,
  input: MaintenanceAnalysisInput,
  presetKey: AtmospherePresetKey,
  missionYears: number,
): MaintenanceTimelinePoint[] {
  const baseElements = getSatelliteElements(spec);
  let semiMajorAxisKm = EARTH_RADIUS_KM + input.meanAltitudeKm;
  let eccentricity = clamp(baseElements.eccentricity, 0, 0.8);
  const timeline: MaintenanceTimelinePoint[] = [];
  const totalSteps = Math.max(1, Math.ceil((missionYears * DAYS_PER_YEAR) / input.timelineStepDays));

  for (let step = 0; step <= totalSteps; step += 1) {
    const elapsedDays = step * input.timelineStepDays;
    const elapsedYears = elapsedDays / DAYS_PER_YEAR;
    const date = new Date(startTime.getTime() + elapsedDays * 86400000);
    const altitudeKm = semiMajorAxisKm - EARTH_RADIUS_KM;
    const perigeeAltitudeKm = semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM;
    const apogeeAltitudeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM;
    const atmosphereInput = createAtmosphereInput(input, presetKey);
    const densityReferenceAltitudeKm = Math.max(perigeeAltitudeKm, 120);
    const densityKgPerM3 = calculateAtmosphericDensity(densityReferenceAltitudeKm, atmosphereInput);

    timeline.push({
      timestamp: date.getTime(),
      elapsedYears,
      altitudeKm,
      perigeeAltitudeKm,
      apogeeAltitudeKm,
      semiMajorAxisKm,
      eccentricity,
      densityKgPerM3,
      densityReferenceAltitudeKm,
    });

    if (step === totalSteps || perigeeAltitudeKm <= input.deorbitAltitudeKm) continue;

    const rates = calculateDetailedPerturbationRates(
      {
        ...baseElements,
        semiMajorAxisKm,
        eccentricity,
      },
      input.ballisticCoefficient,
      atmosphereInput,
    );

    semiMajorAxisKm += rates.drag.da_dt * (input.timelineStepDays / DAYS_PER_YEAR);
    eccentricity = clamp(
      eccentricity + rates.drag.de_dt * (input.timelineStepDays / DAYS_PER_YEAR),
      0,
      0.8,
    );
    semiMajorAxisKm = Math.max(semiMajorAxisKm, EARTH_RADIUS_KM + input.deorbitAltitudeKm);
  }

  return timeline;
}

function estimateNaturalLifetimeYears(
  spec: SatelliteSpec,
  startTime: Date,
  input: MaintenanceAnalysisInput,
  presetKey: AtmospherePresetKey,
): { years: number; reached: boolean } {
  const maxYears = 30;
  const timeline = simulateNaturalDecay(spec, startTime, { ...input, timelineStepDays: 30 }, presetKey, maxYears);
  const hit = timeline.find((point) => point.perigeeAltitudeKm <= input.deorbitAltitudeKm + 1e-6);
  if (hit) {
    return { years: hit.elapsedYears, reached: true };
  }
  return { years: maxYears, reached: false };
}

function buildAnnualBudget(
  spec: SatelliteSpec,
  startTime: Date,
  input: MaintenanceAnalysisInput,
  presetKey: AtmospherePresetKey,
): MaintenanceAnnualBudgetPoint[] {
  const result: MaintenanceAnnualBudgetPoint[] = [];

  for (let yearIndex = 1; yearIndex <= Math.ceil(input.missionYears); yearIndex += 1) {
    const periodYears = Math.min(1, input.missionYears - (yearIndex - 1));
    if (periodYears <= 0) break;
    const yearStart = new Date(startTime.getTime() + (yearIndex - 1) * DAYS_PER_YEAR * 86400000);
    const timeline = simulateNaturalDecay(spec, yearStart, { ...input, timelineStepDays: 10 }, presetKey, periodYears);
    const initialAltitudeKm = timeline[0]?.altitudeKm ?? input.meanAltitudeKm;
    const finalAltitudeKm = timeline.at(-1)?.altitudeKm ?? initialAltitudeKm;
    const altitudeLossKm = Math.max(initialAltitudeKm - finalAltitudeKm, 0);
    const deltaV_mps = circularOrbitDeltaVForAltitudeRaise(finalAltitudeKm, input.meanAltitudeKm);
    const propellantKg = requiredPropellantKg(deltaV_mps, input.dryMassKg, input.specificImpulseSec);

    result.push({
      yearIndex,
      label: `Y${yearIndex}`,
      altitudeLossKm,
      deltaV_mps,
      propellantKg,
    });
  }

  return result;
}

function summarizeScenario(
  spec: SatelliteSpec,
  satelliteLabel: string,
  startTime: Date,
  input: MaintenanceAnalysisInput,
  presetKey: AtmospherePresetKey,
): Omit<MaintenanceAnalysisResult, "scenarioComparisons" | "sweep" | "worstScenario"> {
  const timeline = simulateNaturalDecay(spec, startTime, input, presetKey, input.missionYears);
  const annualBudget = buildAnnualBudget(spec, startTime, input, presetKey);
  const initialPoint = timeline[0];
  const annualAltitudeLossKm = annualBudget[0]?.altitudeLossKm ?? 0;
  const annualDeltaV_mps = annualBudget[0]?.deltaV_mps ?? 0;
  const missionDeltaV_mps = annualBudget.reduce((sum, point) => sum + point.deltaV_mps, 0);
  const requiredPropellant = annualBudget.reduce((sum, point) => sum + point.propellantKg, 0);
  const requiredPropellantWithMarginKg = requiredPropellant * (1 + input.propellantMarginPercent / 100);
  const naturalLifetime = estimateNaturalLifetimeYears(spec, startTime, input, presetKey);
  const meanDensityKgPerM3 = timeline.reduce((sum, point) => sum + point.densityKgPerM3, 0) / Math.max(timeline.length, 1);
  const worstAnnualLossKm = annualBudget.reduce((max, point) => Math.max(max, point.altitudeLossKm), 0);

  return {
    satelliteLabel,
    analysisInput: input,
    timeline,
    annualBudget,
    currentScenarioLabel: ATMOSPHERE_PRESETS[presetKey].label,
    kpi: {
      atmosphereModelLabel: "Harris-Priester",
      f107: input.f107,
      ap: input.ap,
      initialAltitudeKm: input.meanAltitudeKm,
      initialPerigeeAltitudeKm: initialPoint?.perigeeAltitudeKm ?? input.meanAltitudeKm,
      initialApogeeAltitudeKm: initialPoint?.apogeeAltitudeKm ?? input.meanAltitudeKm,
      initialEccentricity: initialPoint?.eccentricity ?? 0,
      annualAltitudeLossKm,
      annualDeltaV_mps,
      missionDeltaV_mps,
      requiredPropellantKg: requiredPropellant,
      requiredPropellantWithMarginKg,
      availablePropellantKg: input.propellantMassKg,
      naturalLifetimeYears: naturalLifetime.years,
      naturalLifetimeReached: naturalLifetime.reached,
      meanDensityKgPerM3,
      worstAnnualLossKm,
      ballisticCoefficient: input.ballisticCoefficient,
      designStatus: computeDesignStatus(requiredPropellantWithMarginKg, input.propellantMassKg),
    },
  };
}

function buildScenarioComparisons(
  spec: SatelliteSpec,
  startTime: Date,
  input: MaintenanceAnalysisInput,
): MaintenanceScenarioComparison[] {
  return (Object.keys(ATMOSPHERE_PRESETS) as AtmospherePresetKey[]).map((key) => {
    const presetDefaults = getAtmospherePresetDefaults(key);
    const scenarioInput = normalizeInput({
      ...input,
      atmospherePreset: key,
      f107: presetDefaults.f107,
      ap: presetDefaults.ap,
    });
    const scenarioResult = summarizeScenario(spec, "", startTime, scenarioInput, key);
    return {
      key,
      label: ATMOSPHERE_PRESETS[key].label,
      annualAltitudeLossKm: scenarioResult.kpi.annualAltitudeLossKm,
      missionDeltaV_mps: scenarioResult.kpi.missionDeltaV_mps,
      requiredPropellantKg: scenarioResult.kpi.requiredPropellantWithMarginKg,
      naturalLifetimeYears: scenarioResult.kpi.naturalLifetimeYears,
      naturalLifetimeReached: scenarioResult.kpi.naturalLifetimeReached,
    };
  });
}

function computeSweep(
  spec: SatelliteSpec,
  startTime: Date,
  input: MaintenanceAnalysisInput,
): MaintenanceSweepPoint[] {
  const start = input.sweepStart;
  const end = input.sweepEnd;
  const steps = input.sweepSteps;
  const delta = steps <= 1 ? 0 : (end - start) / (steps - 1);

  return Array.from({ length: steps }, (_, index) => start + delta * index).map((value) => {
    const adjustedRawInput = {
      ...input,
      [input.sweepParameter]: value,
    };
    const adjustedInput = normalizeInput(adjustedRawInput);
    const result = summarizeScenario(spec, "", startTime, adjustedInput, adjustedInput.atmospherePreset);
    return {
      inputValue: value,
      annualDeltaV_mps: result.kpi.annualDeltaV_mps,
      requiredPropellantKg: result.kpi.requiredPropellantWithMarginKg,
      naturalLifetimeYears: result.kpi.naturalLifetimeYears,
    };
  });
}

export function getAtmosphereScenarioLabel(key: AtmospherePresetKey): string {
  return ATMOSPHERE_PRESETS[key].label;
}

export function getDefaultReferenceAltitudeKm(spec: SatelliteSpec, startTime: Date): number {
  return computeDefaultReferenceAltitudeKm(spec, startTime);
}

export function createDesignSatelliteSpec(input: Pick<MaintenanceAnalysisInput, "meanAltitudeKm" | "eccentricity" | "inclinationDeg">, startTime: Date): SatelliteSpec {
  return {
    type: "elements",
    elements: {
      satnum: 99000,
      epoch: startTime,
      semiMajorAxisKm: EARTH_RADIUS_KM + input.meanAltitudeKm,
      eccentricity: input.eccentricity,
      inclinationDeg: input.inclinationDeg,
      raanDeg: 0,
      argPerigeeDeg: 0,
      meanAnomalyDeg: 0,
    },
    meta: {
      objectName: "Design Case",
    },
  };
}

export function analyzeOrbitMaintenance(
  spec: SatelliteSpec,
  satelliteLabel: string,
  startTime: Date,
  rawInput: MaintenanceAnalysisInput,
): MaintenanceAnalysisResult {
  const input = normalizeInput(rawInput);
  const currentScenario = summarizeScenario(spec, satelliteLabel, startTime, input, input.atmospherePreset);
  const scenarioComparisons = buildScenarioComparisons(spec, startTime, input);
  const worstScenario = scenarioComparisons.reduce((worst, candidate) => (
    candidate.requiredPropellantKg > worst.requiredPropellantKg ? candidate : worst
  ));

  return {
    ...currentScenario,
    scenarioComparisons,
    sweep: computeSweep(spec, startTime, input),
    worstScenario,
  };
}
