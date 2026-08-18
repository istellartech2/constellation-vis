import * as satellite from "satellite.js";
import type { GroundStation } from "./groundStations";
import type { VisibilityCriteria } from "./visibility";
import { passesVisibilityCriteria } from "./visibility";

export const SPEED_OF_LIGHT_KM_PER_SEC = 299_792.458;
const EARTH_ROTATION_RAD_PER_SEC = 7.29211514670698e-5;

export type LinkKind = "service" | "feeder";

export interface GroundTerminal extends GroundStation {
  id: string;
  kind: LinkKind;
  uplinkFrequencyHz?: number;
  downlinkFrequencyHz?: number;
}

export interface LinkGeometry {
  timestamp: string;
  elevationDeg: number;
  azimuthDeg: number;
  offNadirDeg: number | null;
  slantRangeKm: number;
  rangeRateKmPerSec: number;
  oneWayPropagationDelayMs: number;
  roundTripPropagationDelayMs: number;
  uplinkDopplerHz: number | null;
  downlinkDopplerHz: number | null;
  uplinkReceivedFrequencyHz: number | null;
  downlinkReceivedFrequencyHz: number | null;
  visible: boolean;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

function computeOffNadirRad(satelliteEcf: Vec3, stationEcf: Vec3): number | null {
  const nadir = { x: -satelliteEcf.x, y: -satelliteEcf.y, z: -satelliteEcf.z };
  const toStation = {
    x: stationEcf.x - satelliteEcf.x,
    y: stationEcf.y - satelliteEcf.y,
    z: stationEcf.z - satelliteEcf.z,
  };
  const denominator = magnitude(nadir) * magnitude(toStation);
  if (denominator === 0) return null;
  const cosine = Math.min(1, Math.max(-1, dot(nadir, toStation) / denominator));
  return Math.acos(cosine);
}

function dopplerHz(frequencyHz: number | undefined, rangeRateKmPerSec: number): number | null {
  if (frequencyHz === undefined) return null;
  return -frequencyHz * rangeRateKmPerSec / SPEED_OF_LIGHT_KM_PER_SEC;
}

/**
 * Calculate one-way satellite-to-ground geometry. Positive range rate means
 * increasing separation; consequently a receding link has negative Doppler.
 */
export function calculateLinkGeometry(
  satrec: satellite.SatRec,
  terminal: GroundTerminal,
  date: Date,
): LinkGeometry | null {
  const propagated = satellite.propagate(satrec, date);
  if (!propagated || !propagated.position || !propagated.velocity) return null;

  const gmst = satellite.gstime(date);
  const satelliteEcf = satellite.eciToEcf(propagated.position, gmst);
  const rotatedVelocity = satellite.eciToEcf(propagated.velocity, gmst);
  const satelliteVelocityEcf = {
    x: rotatedVelocity.x + EARTH_ROTATION_RAD_PER_SEC * satelliteEcf.y,
    y: rotatedVelocity.y - EARTH_ROTATION_RAD_PER_SEC * satelliteEcf.x,
    z: rotatedVelocity.z,
  };
  const observer = {
    longitude: satellite.degreesToRadians(terminal.longitudeDeg),
    latitude: satellite.degreesToRadians(terminal.latitudeDeg),
    height: terminal.heightKm,
  };
  const stationEcf = satellite.geodeticToEcf(observer);
  const rangeVector = {
    x: satelliteEcf.x - stationEcf.x,
    y: satelliteEcf.y - stationEcf.y,
    z: satelliteEcf.z - stationEcf.z,
  };
  const slantRangeKm = magnitude(rangeVector);
  if (slantRangeKm === 0) return null;

  const rangeRateKmPerSec = dot(rangeVector, satelliteVelocityEcf) / slantRangeKm;
  const look = satellite.ecfToLookAngles(observer, satelliteEcf);
  const offNadirRad = computeOffNadirRad(satelliteEcf, stationEcf);
  const criteria: VisibilityCriteria = terminal;
  const uplinkDopplerHz = dopplerHz(terminal.uplinkFrequencyHz, rangeRateKmPerSec);
  const downlinkDopplerHz = dopplerHz(terminal.downlinkFrequencyHz, rangeRateKmPerSec);
  const oneWayPropagationDelayMs = slantRangeKm / SPEED_OF_LIGHT_KM_PER_SEC * 1000;

  return {
    timestamp: date.toISOString(),
    elevationDeg: radiansToDegrees(look.elevation),
    azimuthDeg: radiansToDegrees(look.azimuth),
    offNadirDeg: offNadirRad === null ? null : radiansToDegrees(offNadirRad),
    slantRangeKm,
    rangeRateKmPerSec,
    oneWayPropagationDelayMs,
    roundTripPropagationDelayMs: oneWayPropagationDelayMs * 2,
    uplinkDopplerHz,
    downlinkDopplerHz,
    uplinkReceivedFrequencyHz:
      terminal.uplinkFrequencyHz === undefined || uplinkDopplerHz === null
        ? null
        : terminal.uplinkFrequencyHz + uplinkDopplerHz,
    downlinkReceivedFrequencyHz:
      terminal.downlinkFrequencyHz === undefined || downlinkDopplerHz === null
        ? null
        : terminal.downlinkFrequencyHz + downlinkDopplerHz,
    visible: passesVisibilityCriteria(look.elevation, offNadirRad, criteria),
  };
}
