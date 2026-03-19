import * as satellite from "satellite.js";
import type { EciVec3, GeodeticLocation, SatRec } from "satellite.js";
import { sunVectorECI } from "./astronomy";
import type { SatelliteSpec } from "./satellites";
import { toSatrec } from "./satellites";

const EARTH_RADIUS_KM = 6378.137;
const DEFAULT_STEP_SECONDS = 10;

export interface SatelliteDerivedInfo {
  periodMinutes: number;
  orbitsPerDay: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  currentAltitudeKm: number | null;
  eciSpeedKmPerSec: number | null;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  eclipseMinutes: number | null;
  eclipseRatio: number | null;
  timeToNextEclipseStartMinutes: number | null;
  timeToNextSunlightReturnMinutes: number | null;
}

interface PropagatedState {
  position: EciVec3<number>;
  velocity: EciVec3<number> | undefined;
  geodetic: GeodeticLocation;
}

interface ShadowTransition {
  atMinutes: number;
  entersShadow: boolean;
}

function magnitude(vec: EciVec3<number>): number {
  return Math.sqrt((vec.x ** 2) + (vec.y ** 2) + (vec.z ** 2));
}

function normalizeLongitudeDeg(longitudeDeg: number): number {
  let normalized = longitudeDeg;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

function propagateState(rec: SatRec, date: Date): PropagatedState | null {
  const pv = satellite.propagate(rec, date);
  if (!pv?.position) return null;

  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(pv.position, gmst);
  return {
    position: pv.position,
    velocity: pv.velocity,
    geodetic,
  };
}

export function isInEarthShadow(position: EciVec3<number>, date: Date): boolean {
  const sun = sunVectorECI(date);
  const dot = (position.x * sun.x) + (position.y * sun.y) + (position.z * sun.z);
  if (dot >= 0) return false;

  const perpendicularSq =
    ((position.x ** 2) + (position.y ** 2) + (position.z ** 2)) - (dot ** 2);

  return perpendicularSq <= EARTH_RADIUS_KM ** 2;
}

function refineTransitionDate(
  rec: SatRec,
  start: Date,
  end: Date,
  expectedAfter: boolean,
): Date | null {
  let lo = start.getTime();
  let hi = end.getTime();

  for (let i = 0; i < 18; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    const sampleDate = new Date(mid);
    const state = propagateState(rec, sampleDate);
    if (!state) return null;
    const inShadow = isInEarthShadow(state.position, sampleDate);
    if (inShadow === expectedAfter) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return new Date(hi);
}

function findShadowTransitions(
  rec: SatRec,
  at: Date,
  searchMinutes: number,
  stepSeconds = DEFAULT_STEP_SECONDS,
): ShadowTransition[] {
  const initialState = propagateState(rec, at);
  if (!initialState) return [];

  const transitions: ShadowTransition[] = [];
  let previousDate = at;
  let previousInShadow = isInEarthShadow(initialState.position, at);
  const maxSearchMs = Math.max(stepSeconds * 1000, searchMinutes * 60000);

  for (let elapsedMs = stepSeconds * 1000; elapsedMs <= maxSearchMs; elapsedMs += stepSeconds * 1000) {
    const currentDate = new Date(at.getTime() + elapsedMs);
    const state = propagateState(rec, currentDate);
    if (!state) continue;

    const currentInShadow = isInEarthShadow(state.position, currentDate);
    if (currentInShadow !== previousInShadow) {
      const transitionDate = refineTransitionDate(rec, previousDate, currentDate, currentInShadow) ?? currentDate;
      transitions.push({
        atMinutes: (transitionDate.getTime() - at.getTime()) / 60000,
        entersShadow: currentInShadow,
      });
    }

    previousDate = currentDate;
    previousInShadow = currentInShadow;
  }

  return transitions;
}

function nextTransitionAfter(
  transitions: ShadowTransition[],
  entersShadow: boolean,
  afterMinutes = 0,
): ShadowTransition | null {
  return transitions.find((transition) =>
    transition.entersShadow === entersShadow && transition.atMinutes >= afterMinutes,
  ) ?? null;
}

function computeEclipseStats(
  rec: SatRec,
  at: Date,
  periodMinutes: number,
  stepSeconds = DEFAULT_STEP_SECONDS,
): Pick<SatelliteDerivedInfo, "eclipseMinutes" | "eclipseRatio" | "timeToNextEclipseStartMinutes" | "timeToNextSunlightReturnMinutes"> {
  const currentState = propagateState(rec, at);
  if (!currentState) {
    return {
      eclipseMinutes: null,
      eclipseRatio: null,
      timeToNextEclipseStartMinutes: null,
      timeToNextSunlightReturnMinutes: null,
    };
  }

  const currentlyInShadow = isInEarthShadow(currentState.position, at);
  const transitions = findShadowTransitions(rec, at, periodMinutes * 2.5, stepSeconds);

  const firstIngress = nextTransitionAfter(transitions, true);
  const firstEgress = nextTransitionAfter(transitions, false);

  let eclipseMinutes: number | null = null;
  let timeToNextEclipseStartMinutes: number | null = null;
  let timeToNextSunlightReturnMinutes: number | null = null;

  if (currentlyInShadow) {
    timeToNextSunlightReturnMinutes = firstEgress?.atMinutes ?? null;
    const nextIngress = firstEgress
      ? nextTransitionAfter(transitions, true, firstEgress.atMinutes)
      : firstIngress;
    timeToNextEclipseStartMinutes = nextIngress?.atMinutes ?? null;

    const pairedEgress = nextIngress
      ? nextTransitionAfter(transitions, false, nextIngress.atMinutes)
      : null;
    if (nextIngress && pairedEgress) {
      eclipseMinutes = pairedEgress.atMinutes - nextIngress.atMinutes;
    } else if (timeToNextSunlightReturnMinutes !== null && timeToNextEclipseStartMinutes !== null) {
      eclipseMinutes = Math.max(0, periodMinutes - (timeToNextEclipseStartMinutes - timeToNextSunlightReturnMinutes));
    }
  } else {
    timeToNextEclipseStartMinutes = firstIngress?.atMinutes ?? null;
    const pairedEgress = firstIngress
      ? nextTransitionAfter(transitions, false, firstIngress.atMinutes)
      : null;
    timeToNextSunlightReturnMinutes = pairedEgress?.atMinutes ?? null;
    if (firstIngress && pairedEgress) {
      eclipseMinutes = pairedEgress.atMinutes - firstIngress.atMinutes;
    } else {
      eclipseMinutes = 0;
    }
  }

  if (eclipseMinutes === null && !currentlyInShadow && firstIngress === null && firstEgress === null) {
    eclipseMinutes = 0;
  }

  const eclipseRatio =
    eclipseMinutes !== null && Number.isFinite(periodMinutes) && periodMinutes > 0
      ? eclipseMinutes / periodMinutes
      : null;

  return {
    eclipseMinutes,
    eclipseRatio,
    timeToNextEclipseStartMinutes,
    timeToNextSunlightReturnMinutes,
  };
}

export function getSatelliteDerivedInfo(spec: SatelliteSpec, at: Date): SatelliteDerivedInfo {
  const rec = toSatrec(spec);
  const periodMinutes = (2 * Math.PI) / rec.no;
  const semiMajorAxisKm = rec.a * EARTH_RADIUS_KM;
  const eccentricity = rec.ecco;
  const perigeeAltitudeKm = semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM;
  const apogeeAltitudeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM;

  const state = propagateState(rec, at);
  const currentAltitudeKm = state ? magnitude(state.position) - EARTH_RADIUS_KM : null;
  const eciSpeedKmPerSec = state?.velocity ? magnitude(state.velocity) : null;
  const latitudeDeg = state ? satellite.radiansToDegrees(state.geodetic.latitude) : null;
  const longitudeDeg = state ? normalizeLongitudeDeg(satellite.radiansToDegrees(state.geodetic.longitude)) : null;

  return {
    periodMinutes,
    orbitsPerDay: 1440 / periodMinutes,
    perigeeAltitudeKm,
    apogeeAltitudeKm,
    currentAltitudeKm,
    eciSpeedKmPerSec,
    latitudeDeg,
    longitudeDeg,
    ...computeEclipseStats(rec, at, periodMinutes),
  };
}

export function formatDurationMinutes(totalMinutes: number | null): string {
  if (totalMinutes === null || !Number.isFinite(totalMinutes)) return "N/A";
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function formatLatitude(latitudeDeg: number | null): string {
  if (latitudeDeg === null || !Number.isFinite(latitudeDeg)) return "N/A";
  const hemi = latitudeDeg >= 0 ? "N" : "S";
  return `${Math.abs(latitudeDeg).toFixed(2)}° ${hemi}`;
}

export function formatLongitude(longitudeDeg: number | null): string {
  if (longitudeDeg === null || !Number.isFinite(longitudeDeg)) return "N/A";
  const hemi = longitudeDeg >= 0 ? "E" : "W";
  return `${Math.abs(longitudeDeg).toFixed(2)}° ${hemi}`;
}
