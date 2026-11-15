import { analysisTimes } from "./analysisTime";
import { earthShadowFraction } from "./illumination";
import type { SatelliteSpec } from "./satellites";
import { getSatelliteDerivedInfo } from "./satelliteDerivedInfo";
import { toSatrec } from "./satellites";
import * as satellite from "satellite.js";
import { sunVectorECI } from "./astronomy";
import type { GroundStation } from "./groundStations";
import {
  DEFAULT_SATELLITE_ATTITUDE,
  DEFAULT_SOLAR_ARRAY_TYPE,
  type AttitudeQuaternion,
  type SatelliteAttitudeSettings,
  type SolarArrayType,
} from "./attitude/types";
import { satelliteAttitudeEci, solarArrayIncidence } from "./attitude/satelliteAttitude";
export { buildSelectableSatellites, type SelectableSatellite } from "./analysisSatellites";

export type SolarSweepParameter =
  | "solarArrayPowerBOL_W"
  | "batteryCapacityWh"
  | "baseLoadW"
  | "payloadLoadW"
  | "missionYears";

/** 手入力: sunTrackingFactor を一定値で使う / 姿勢から計算: サンプルごとの入射角 cos × その他の損失係数. */
export type GenerationFactorMode = "manual" | "attitude";

export interface SolarPowerAnalysisInput {
  orbitStepSeconds: number;
  dayStepSeconds: number;
  solarArrayPowerBOL_W: number;
  sunTrackingFactor: number;
  /** Default "manual" (sunTrackingFactor). "attitude" derives the factor from the attitude law and array type. */
  generationFactorMode: GenerationFactorMode;
  solarArrayType: SolarArrayType;
  attitude: SatelliteAttitudeSettings;
  /** 姿勢から計算 時に入射角 cos へ掛ける、その他の損失係数 (default 1.0). */
  otherLossFactor: number;
  powerPathEfficiency: number;
  degradationPerYear: number;
  missionYears: number;
  baseLoadW: number;
  sunlightExtraLoadW: number;
  eclipseExtraLoadW: number;
  payloadDutyCycle: number;
  payloadLoadW: number;
  batteryCapacityWh: number;
  initialSocPercent: number;
  minSocPercent: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  designMarginPercent: number;
  sweepParameter: SolarSweepParameter;
  sweepStart: number;
  sweepEnd: number;
  sweepSteps: number;
}

export interface SolarPowerSample {
  timestamp: number;
  timeLabel: string;
  elapsedMinutes: number;
  /** Mode flag: more than half of the solar disc is visible. */
  inSunlight: boolean;
  /** Visible solar disc fraction, including penumbra. */
  sunlightFraction: number;
  /** Panel incidence cosine (clamped ≥ 0); only computed for orbit samples or in attitude mode. */
  incidenceFactor?: number;
  /** Array drive angle about body Y [rad] (0 for a fixed panel). */
  driveAngleRad?: number;
  /** Generation factor actually applied this sample (sunTrackingFactor or incidence × otherLoss). */
  generationFactor: number;
  generationW: number;
  loadW: number;
  netPowerW: number;
  socPercent: number;
  batteryEnergyWh: number;
}

export interface SolarPowerKpi {
  orbitPeriodMinutes: number;
  eclipseMinutesPerOrbit: number;
  sunlightMinutesPerOrbit: number;
  sunlightRatio: number;
  dailyGenerationWh: number;
  dailyLoadWh: number;
  dailyNetWh: number;
  minSocPercent: number;
  endSocPercent: number;
  maxSocPercent: number;
  maxContinuousEclipseMinutes: number;
  minBatteryRequiredWh: number;
  minSolarArrayPowerRequiredW: number;
  energyDeficitWh: number;
  designStatus: "nominal" | "warning" | "critical";
}

export interface SolarRepresentativeDayResult {
  key: string;
  label: string;
  startTimeIso: string;
  kpi: SolarPowerKpi;
}

export interface SolarSweepPoint {
  inputValue: number;
  minSocPercent: number;
  dailyNetWh: number;
  minBatteryRequiredWh: number;
  minSolarArrayPowerRequiredW: number;
}

export interface SolarPowerAnalysisResult {
  satelliteLabel: string;
  analysisInput: SolarPowerAnalysisInput;
  orbitSamples: SolarPowerSample[];
  daySamples: SolarPowerSample[];
  representativeDays: SolarRepresentativeDayResult[];
  sweep: SolarSweepPoint[];
  currentOrbit: SolarPowerKpi;
  currentDay: SolarPowerKpi;
  worstRepresentativeDay: SolarRepresentativeDayResult;
  /** Orbit-average (sunlit samples) incidence factor from the attitude law, and the manual factor, for side-by-side display. */
  factorComparison: {
    /** Mean incidence cosine × otherLossFactor over the sunlit samples of the current orbit. */
    attitudeFactor: number;
    /** The manual 追尾/姿勢係数. */
    manualFactor: number;
    /** Which one drove the generation numbers. */
    applied: GenerationFactorMode;
  };
}

export interface SolarPowerAnalysisOptions {
  /** Ground stations, only needed for the 地上局指向 attitude. */
  stations?: GroundStation[];
}

const MINUTES_PER_DAY = 24 * 60;
const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatSampleTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function createDefaultSolarPowerInput(): SolarPowerAnalysisInput {
  return {
    orbitStepSeconds: 30,
    dayStepSeconds: 120,
    solarArrayPowerBOL_W: 250,
    sunTrackingFactor: 0.78,
    generationFactorMode: "manual",
    solarArrayType: DEFAULT_SOLAR_ARRAY_TYPE,
    attitude: DEFAULT_SATELLITE_ATTITUDE,
    otherLossFactor: 1,
    powerPathEfficiency: 0.9,
    degradationPerYear: 0.025,
    missionYears: 3,
    baseLoadW: 90,
    sunlightExtraLoadW: 15,
    eclipseExtraLoadW: 20,
    payloadDutyCycle: 0.25,
    payloadLoadW: 45,
    batteryCapacityWh: 650,
    initialSocPercent: 95,
    minSocPercent: 30,
    chargeEfficiency: 0.95,
    dischargeEfficiency: 0.94,
    designMarginPercent: 20,
    sweepParameter: "batteryCapacityWh",
    sweepStart: 400,
    sweepEnd: 1200,
    sweepSteps: 9,
  };
}

function normalizeInput(input: SolarPowerAnalysisInput): SolarPowerAnalysisInput {
  return {
    ...input,
    orbitStepSeconds: clamp(Math.round(input.orbitStepSeconds), 5, 600),
    dayStepSeconds: clamp(Math.round(input.dayStepSeconds), 10, 1800),
    solarArrayPowerBOL_W: Math.max(input.solarArrayPowerBOL_W, 0),
    sunTrackingFactor: clamp(input.sunTrackingFactor, 0, 1.2),
    generationFactorMode: input.generationFactorMode === "attitude" ? "attitude" : "manual",
    solarArrayType: input.solarArrayType ?? DEFAULT_SOLAR_ARRAY_TYPE,
    attitude: input.attitude ?? DEFAULT_SATELLITE_ATTITUDE,
    otherLossFactor: clamp(input.otherLossFactor ?? 1, 0, 1.2),
    powerPathEfficiency: clamp(input.powerPathEfficiency, 0.01, 1),
    degradationPerYear: clamp(input.degradationPerYear, 0, 0.3),
    missionYears: clamp(input.missionYears, 0, 20),
    baseLoadW: Math.max(input.baseLoadW, 0),
    sunlightExtraLoadW: Math.max(input.sunlightExtraLoadW, 0),
    eclipseExtraLoadW: Math.max(input.eclipseExtraLoadW, 0),
    payloadDutyCycle: clamp(input.payloadDutyCycle, 0, 1),
    payloadLoadW: Math.max(input.payloadLoadW, 0),
    batteryCapacityWh: Math.max(input.batteryCapacityWh, 1),
    initialSocPercent: clamp(input.initialSocPercent, 0, 100),
    minSocPercent: clamp(input.minSocPercent, 0, 100),
    chargeEfficiency: clamp(input.chargeEfficiency, 0.01, 1),
    dischargeEfficiency: clamp(input.dischargeEfficiency, 0.01, 1),
    designMarginPercent: clamp(input.designMarginPercent, 0, 200),
    sweepStart: input.sweepStart,
    sweepEnd: input.sweepEnd,
    sweepSteps: clamp(Math.round(input.sweepSteps), 2, 25),
  };
}

function computeDegradationFactor(input: SolarPowerAnalysisInput): number {
  return Math.max(0, 1 - input.degradationPerYear * input.missionYears);
}

function computeLoadW(input: SolarPowerAnalysisInput, inSunlight: boolean): number {
  const payloadLoad = input.payloadLoadW * input.payloadDutyCycle;
  const sunlightLoad = inSunlight ? input.sunlightExtraLoadW : input.eclipseExtraLoadW;
  const marginFactor = 1 + input.designMarginPercent / 100;
  return (input.baseLoadW + payloadLoad + sunlightLoad) * marginFactor;
}

function computeGenerationW(input: SolarPowerAnalysisInput, sunlightFraction: number, generationFactor: number): number {
  const degradationFactor = computeDegradationFactor(input);
  return input.solarArrayPowerBOL_W * degradationFactor * generationFactor * input.powerPathEfficiency * sunlightFraction;
}

/** Mean generation factor over the sample set, weighted by visible sun fraction (the energy-relevant average). */
function meanGenerationFactor(samples: SolarPowerSample[], fallback: number): number {
  let weighted = 0;
  let weight = 0;
  for (const sample of samples) {
    weighted += sample.generationFactor * sample.sunlightFraction;
    weight += sample.sunlightFraction;
  }
  return weight > EPSILON ? weighted / weight : fallback;
}

/** Mean incidence cosine over sunlit (mode flag) samples; null if no sample carries one. */
function meanIncidenceFactor(samples: SolarPowerSample[]): number | null {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (!sample.inSunlight || sample.incidenceFactor === undefined) continue;
    sum += sample.incidenceFactor;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function getRepresentativeDates(startTime: Date): Array<{ key: string; label: string; start: Date }> {
  const year = startTime.getUTCFullYear();
  const h = startTime.getUTCHours();
  const m = startTime.getUTCMinutes();
  const s = startTime.getUTCSeconds();

  return [
    { key: "marchEquinox", label: "春分付近", start: new Date(Date.UTC(year, 2, 20, h, m, s)) },
    { key: "juneSolstice", label: "夏至付近", start: new Date(Date.UTC(year, 5, 21, h, m, s)) },
    { key: "septemberEquinox", label: "秋分付近", start: new Date(Date.UTC(year, 8, 22, h, m, s)) },
    { key: "decemberSolstice", label: "冬至付近", start: new Date(Date.UTC(year, 11, 21, h, m, s)) },
  ];
}

function simulateSolarPower(
  spec: SatelliteSpec,
  startTime: Date,
  durationMinutes: number,
  stepSeconds: number,
  input: SolarPowerAnalysisInput,
  stations: GroundStation[],
  alwaysIncidence: boolean,
): SolarPowerSample[] {
  const rec = toSatrec(spec);
  const batteryCapacityWh = Math.max(input.batteryCapacityWh, 1);
  let batteryEnergyWh = batteryCapacityWh * (input.initialSocPercent / 100);
  const samples: SolarPowerSample[] = [];
  const times = analysisTimes(startTime.getTime(), durationMinutes * 60, stepSeconds);
  const attitudeMode = input.generationFactorMode === "attitude";
  const wantIncidence = attitudeMode || alwaysIncidence;

  for (let step = 0; step < times.length; step += 1) {
    const date = new Date(times[step]);
    const pv = satellite.propagate(rec, date);
    if (!pv?.position) throw new Error(`衛星位置を計算できません: ${date.toISOString()}`);

    const sunlightFraction = 1 - earthShadowFraction(pv.position, date);
    const inSunlight = sunlightFraction > 0.5;
    let incidenceFactor: number | undefined;
    let driveAngleRad: number | undefined;
    if (wantIncidence && pv.velocity) {
      const q: AttitudeQuaternion = satelliteAttitudeEci(
        pv.position as unknown as { x: number; y: number; z: number },
        pv.velocity as unknown as { x: number; y: number; z: number },
        date,
        input.attitude,
        stations,
      );
      const incidence = solarArrayIncidence(q, sunVectorECI(date), input.solarArrayType);
      incidenceFactor = incidence.cosIncidence;
      driveAngleRad = incidence.driveAngleRad;
    }
    const generationFactor = attitudeMode
      ? (incidenceFactor ?? 0) * input.otherLossFactor
      : input.sunTrackingFactor;
    const generationW = computeGenerationW(input, sunlightFraction, generationFactor);
    const loadW = computeLoadW(input, inSunlight);
    const netPowerW = generationW - loadW;
    const deltaHours = step === 0 ? 0 : (times[step] - times[step - 1]) / 3_600_000;

    if (step > 0) {
      if (netPowerW >= 0) {
        batteryEnergyWh = Math.min(
          batteryCapacityWh,
          batteryEnergyWh + (netPowerW * input.chargeEfficiency * deltaHours),
        );
      } else {
        batteryEnergyWh = Math.max(
          0,
          batteryEnergyWh + (netPowerW / input.dischargeEfficiency) * deltaHours,
        );
      }
    }

    samples.push({
      timestamp: date.getTime(),
      timeLabel: formatSampleTime(date),
      elapsedMinutes: (times[step] - times[0]) / 60_000,
      inSunlight,
      sunlightFraction,
      incidenceFactor,
      driveAngleRad,
      generationFactor,
      generationW,
      loadW,
      netPowerW,
      socPercent: (batteryEnergyWh / batteryCapacityWh) * 100,
      batteryEnergyWh,
    });
  }

  return samples;
}

function computeMaxContinuousEclipseMinutes(samples: SolarPowerSample[]): number {
  let current = 0;
  let max = 0;

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.inSunlight) {
      current = 0;
      continue;
    }
    current += (sample.timestamp - samples[i - 1].timestamp) / 60_000;
    max = Math.max(max, current);
  }

  return max;
}

function computeMinSolarArrayRequirement(
  input: SolarPowerAnalysisInput,
  sunlightRatio: number,
  effectiveSunlightRatio: number,
  generationFactorValue: number,
): number {
  if (effectiveSunlightRatio <= EPSILON) return Number.POSITIVE_INFINITY;
  const averageLoadW =
    ((input.baseLoadW + input.payloadLoadW * input.payloadDutyCycle) * (1 + input.designMarginPercent / 100))
    + (input.sunlightExtraLoadW * sunlightRatio + input.eclipseExtraLoadW * (1 - sunlightRatio)) * (1 + input.designMarginPercent / 100);
  const generationFactor = computeDegradationFactor(input) * generationFactorValue * input.powerPathEfficiency * effectiveSunlightRatio;
  if (generationFactor <= EPSILON) return Number.POSITIVE_INFINITY;
  return averageLoadW / generationFactor;
}

function computeKpi(
  samples: SolarPowerSample[],
  input: SolarPowerAnalysisInput,
  orbitPeriodMinutes: number,
  orbitEclipseMinutes: number,
  generationFactor: number,
): SolarPowerKpi {
  // Same right-endpoint quadrature as the SOC integration; no extra endpoint step.
  const integral = (value: (sample: SolarPowerSample) => number) => samples.slice(1).reduce(
    (sum, sample, i) => sum + value(sample) * (sample.timestamp - samples[i].timestamp) / 3_600_000, 0,
  );
  const durationHours = samples.length > 1 ? (samples.at(-1)!.timestamp - samples[0].timestamp) / 3_600_000 : 0;
  const dailyGenerationWh = integral((s) => s.generationW);
  const dailyLoadWh = integral((s) => s.loadW);
  const minSocPercent = samples.reduce((min, sample) => Math.min(min, sample.socPercent), Number.POSITIVE_INFINITY);
  const maxSocPercent = samples.reduce((max, sample) => Math.max(max, sample.socPercent), 0);
  const endSocPercent = samples.at(-1)?.socPercent ?? input.initialSocPercent;
  const sunlightRatio = durationHours > 0 ? integral((s) => Number(s.inSunlight)) / durationHours : 0;
  const energyDeficitWh = Math.max(0, dailyLoadWh - dailyGenerationWh);
  const minBatteryRequiredWh = orbitEclipseMinutes > 0
    ? computeLoadW(input, false) * (orbitEclipseMinutes / 60) / Math.max(input.minSocPercent > 0 ? 1 - input.minSocPercent / 100 : 1, 0.05)
    : 0;
  const effectiveSunlightRatio = durationHours > 0 ? integral((s) => s.sunlightFraction) / durationHours : 0;
  const minSolarArrayPowerRequiredW = computeMinSolarArrayRequirement(input, sunlightRatio, effectiveSunlightRatio, generationFactor);
  const designStatus =
    minSocPercent <= input.minSocPercent
      ? "critical"
      : energyDeficitWh > 0
        ? "warning"
        : "nominal";

  return {
    orbitPeriodMinutes,
    eclipseMinutesPerOrbit: orbitEclipseMinutes,
    sunlightMinutesPerOrbit: Math.max(orbitPeriodMinutes - orbitEclipseMinutes, 0),
    sunlightRatio,
    dailyGenerationWh,
    dailyLoadWh,
    dailyNetWh: dailyGenerationWh - dailyLoadWh,
    minSocPercent: Number.isFinite(minSocPercent) ? minSocPercent : input.initialSocPercent,
    endSocPercent,
    maxSocPercent,
    maxContinuousEclipseMinutes: computeMaxContinuousEclipseMinutes(samples),
    minBatteryRequiredWh,
    minSolarArrayPowerRequiredW,
    energyDeficitWh,
    designStatus,
  };
}

function simulateForDate(
  spec: SatelliteSpec,
  startTime: Date,
  input: SolarPowerAnalysisInput,
  stations: GroundStation[],
): { orbitSamples: SolarPowerSample[]; daySamples: SolarPowerSample[]; orbitKpi: SolarPowerKpi; dayKpi: SolarPowerKpi } {
  const derived = getSatelliteDerivedInfo(spec, startTime);
  const orbitPeriodMinutes = derived.periodMinutes;
  const eclipseMinutes = derived.eclipseMinutes ?? 0;

  const orbitSamples = simulateSolarPower(
    spec,
    startTime,
    orbitPeriodMinutes,
    input.orbitStepSeconds,
    input,
    stations,
    true,
  );
  const daySamples = simulateSolarPower(
    spec,
    startTime,
    MINUTES_PER_DAY,
    input.dayStepSeconds,
    input,
    stations,
    false,
  );

  return {
    orbitSamples,
    daySamples,
    orbitKpi: computeKpi(orbitSamples, input, orbitPeriodMinutes, eclipseMinutes,
      meanGenerationFactor(orbitSamples, input.sunTrackingFactor)),
    dayKpi: computeKpi(daySamples, input, orbitPeriodMinutes, eclipseMinutes,
      meanGenerationFactor(daySamples, input.sunTrackingFactor)),
  };
}

function computeSweep(
  spec: SatelliteSpec,
  startTime: Date,
  input: SolarPowerAnalysisInput,
  stations: GroundStation[],
): SolarSweepPoint[] {
  const start = input.sweepStart;
  const end = input.sweepEnd;
  const steps = input.sweepSteps;
  const delta = steps <= 1 ? 0 : (end - start) / (steps - 1);
  const values = Array.from({ length: steps }, (_, index) => start + delta * index);

  return values.map((value) => {
    const adjustedInput = normalizeInput({
      ...input,
      [input.sweepParameter]: value,
    });
    const { dayKpi } = simulateForDate(spec, startTime, adjustedInput, stations);
    return {
      inputValue: value,
      minSocPercent: dayKpi.minSocPercent,
      dailyNetWh: dayKpi.dailyNetWh,
      minBatteryRequiredWh: dayKpi.minBatteryRequiredWh,
      minSolarArrayPowerRequiredW: dayKpi.minSolarArrayPowerRequiredW,
    };
  });
}

export function analyzeSolarPower(
  spec: SatelliteSpec,
  satelliteLabel: string,
  startTime: Date,
  rawInput: SolarPowerAnalysisInput,
  options: SolarPowerAnalysisOptions = {},
): SolarPowerAnalysisResult {
  const input = normalizeInput(rawInput);
  const stations = options.stations ?? [];
  const current = simulateForDate(spec, startTime, input, stations);
  const representativeDays = getRepresentativeDates(startTime).map(({ key, label, start }) => {
    const { dayKpi } = simulateForDate(spec, start, input, stations);
    return {
      key,
      label,
      startTimeIso: start.toISOString(),
      kpi: dayKpi,
    };
  });

  const worstRepresentativeDay = representativeDays.reduce((worst, candidate) => (
    candidate.kpi.minSocPercent < worst.kpi.minSocPercent ? candidate : worst
  ));

  return {
    satelliteLabel,
    analysisInput: input,
    orbitSamples: current.orbitSamples,
    daySamples: current.daySamples,
    representativeDays,
    sweep: computeSweep(spec, startTime, input, stations),
    currentOrbit: current.orbitKpi,
    currentDay: current.dayKpi,
    worstRepresentativeDay,
    factorComparison: {
      attitudeFactor: (meanIncidenceFactor(current.orbitSamples) ?? 0) * input.otherLossFactor,
      manualFactor: input.sunTrackingFactor,
      applied: input.generationFactorMode,
    },
  };
}
