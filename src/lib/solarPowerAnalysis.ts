import type { SatelliteSpec } from "./satellites";
import { getSatelliteDerivedInfo, isInEarthShadow } from "./satelliteDerivedInfo";
import { toSatrec } from "./satellites";
import * as satellite from "satellite.js";
export { buildSelectableSatellites, type SelectableSatellite } from "./analysisSatellites";

export type SolarSweepParameter =
  | "solarArrayPowerBOL_W"
  | "batteryCapacityWh"
  | "baseLoadW"
  | "payloadLoadW"
  | "missionYears";

export interface SolarPowerAnalysisInput {
  orbitStepSeconds: number;
  dayStepSeconds: number;
  solarArrayPowerBOL_W: number;
  sunTrackingFactor: number;
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
  inSunlight: boolean;
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

function computeGenerationW(input: SolarPowerAnalysisInput, inSunlight: boolean): number {
  if (!inSunlight) return 0;
  const degradationFactor = computeDegradationFactor(input);
  return input.solarArrayPowerBOL_W * degradationFactor * input.sunTrackingFactor * input.powerPathEfficiency;
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
): SolarPowerSample[] {
  const rec = toSatrec(spec);
  const batteryCapacityWh = Math.max(input.batteryCapacityWh, 1);
  let batteryEnergyWh = batteryCapacityWh * (input.initialSocPercent / 100);
  const samples: SolarPowerSample[] = [];
  const totalSteps = Math.max(1, Math.ceil((durationMinutes * 60) / stepSeconds));

  for (let step = 0; step <= totalSteps; step += 1) {
    const date = new Date(startTime.getTime() + step * stepSeconds * 1000);
    const pv = satellite.propagate(rec, date);
    if (!pv?.position) continue;

    const inSunlight = !isInEarthShadow(pv.position, date);
    const generationW = computeGenerationW(input, inSunlight);
    const loadW = computeLoadW(input, inSunlight);
    const netPowerW = generationW - loadW;
    const deltaHours = step === 0 ? 0 : stepSeconds / 3600;

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
      elapsedMinutes: step * stepSeconds / 60,
      inSunlight,
      generationW,
      loadW,
      netPowerW,
      socPercent: (batteryEnergyWh / batteryCapacityWh) * 100,
      batteryEnergyWh,
    });
  }

  return samples;
}

function computeMaxContinuousEclipseMinutes(samples: SolarPowerSample[], stepSeconds: number): number {
  let current = 0;
  let max = 0;

  for (const sample of samples) {
    if (sample.inSunlight) {
      current = 0;
      continue;
    }
    current += stepSeconds / 60;
    max = Math.max(max, current);
  }

  return max;
}

function computeMinSolarArrayRequirement(input: SolarPowerAnalysisInput, sunlightRatio: number): number {
  if (sunlightRatio <= EPSILON) return Number.POSITIVE_INFINITY;
  const averageLoadW =
    ((input.baseLoadW + input.payloadLoadW * input.payloadDutyCycle) * (1 + input.designMarginPercent / 100))
    + (input.sunlightExtraLoadW * sunlightRatio + input.eclipseExtraLoadW * (1 - sunlightRatio)) * (1 + input.designMarginPercent / 100);
  const generationFactor = computeDegradationFactor(input) * input.sunTrackingFactor * input.powerPathEfficiency * sunlightRatio;
  if (generationFactor <= EPSILON) return Number.POSITIVE_INFINITY;
  return averageLoadW / generationFactor;
}

function computeKpi(
  samples: SolarPowerSample[],
  stepSeconds: number,
  input: SolarPowerAnalysisInput,
  orbitPeriodMinutes: number,
  orbitEclipseMinutes: number,
): SolarPowerKpi {
  const deltaHours = stepSeconds / 3600;
  const dailyGenerationWh = samples.reduce((sum, sample) => sum + sample.generationW * deltaHours, 0);
  const dailyLoadWh = samples.reduce((sum, sample) => sum + sample.loadW * deltaHours, 0);
  const minSocPercent = samples.reduce((min, sample) => Math.min(min, sample.socPercent), Number.POSITIVE_INFINITY);
  const maxSocPercent = samples.reduce((max, sample) => Math.max(max, sample.socPercent), 0);
  const endSocPercent = samples.at(-1)?.socPercent ?? input.initialSocPercent;
  const sunlightSamples = samples.filter((sample) => sample.inSunlight).length;
  const sunlightRatio = samples.length > 0 ? sunlightSamples / samples.length : 0;
  const energyDeficitWh = Math.max(0, dailyLoadWh - dailyGenerationWh);
  const minBatteryRequiredWh = orbitEclipseMinutes > 0
    ? computeLoadW(input, false) * (orbitEclipseMinutes / 60) / Math.max(input.minSocPercent > 0 ? 1 - input.minSocPercent / 100 : 1, 0.05)
    : 0;
  const minSolarArrayPowerRequiredW = computeMinSolarArrayRequirement(input, sunlightRatio);
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
    maxContinuousEclipseMinutes: computeMaxContinuousEclipseMinutes(samples, stepSeconds),
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
  );
  const daySamples = simulateSolarPower(
    spec,
    startTime,
    MINUTES_PER_DAY,
    input.dayStepSeconds,
    input,
  );

  return {
    orbitSamples,
    daySamples,
    orbitKpi: computeKpi(orbitSamples, input.orbitStepSeconds, input, orbitPeriodMinutes, eclipseMinutes),
    dayKpi: computeKpi(daySamples, input.dayStepSeconds, input, orbitPeriodMinutes, eclipseMinutes),
  };
}

function computeSweep(
  spec: SatelliteSpec,
  startTime: Date,
  input: SolarPowerAnalysisInput,
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
    const { dayKpi } = simulateForDate(spec, startTime, adjustedInput);
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
): SolarPowerAnalysisResult {
  const input = normalizeInput(rawInput);
  const current = simulateForDate(spec, startTime, input);
  const representativeDays = getRepresentativeDates(startTime).map(({ key, label, start }) => {
    const { dayKpi } = simulateForDate(spec, start, input);
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
    sweep: computeSweep(spec, startTime, input),
    currentOrbit: current.orbitKpi,
    currentDay: current.dayKpi,
    worstRepresentativeDay,
  };
}
