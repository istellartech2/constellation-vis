import * as satellite from "satellite.js";

/** Classical orbital elements used for defining a satellite. */
export interface OrbitalElements {
  /** Satellite catalog number for TLE generation */
  satnum: number;
  /** Epoch of the elements */
  epoch: Date;
  /** Semi–major axis in kilometres */
  semiMajorAxisKm: number;
  eccentricity: number;
  /** Inclination in degrees */
  inclinationDeg: number;
  /** Right ascension of the ascending node in degrees */
  raanDeg: number;
  /** Argument of perigee in degrees */
  argPerigeeDeg: number;
  /** Mean anomaly in degrees */
  meanAnomalyDeg: number;
}

export type SatelliteSpec =
  | { type: "tle"; lines: [string, string] }
  | { type: "elements"; elements: OrbitalElements };

/** Convert epoch date to `YYDDD.DDDDDDDD` format used by TLEs. */
function formatTleEpoch(date: Date): string {
  const year = date.getUTCFullYear() % 100;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const day = Math.floor(doy);
  const frac = doy - day;
  return (
    year.toString().padStart(2, "0") +
    day.toString().padStart(3, "0") +
    "." +
    frac.toFixed(8).slice(2)
  );
}

/** Create a minimal TLE representation from orbital elements. */
function elementsToTle(el: OrbitalElements): [string, string] {
  const mu = 398600.4418; // Earth gravitational parameter km^3/s^2
  const nRad = Math.sqrt(mu / Math.pow(el.semiMajorAxisKm, 3));
  const meanMotion = (nRad * 86400) / (2 * Math.PI); // rev/day

  const satnum = el.satnum.toString().padStart(5, "0");
  const epoch = formatTleEpoch(el.epoch);

  const line1 =
    `1 ${satnum}U 00000A   ${epoch}  .00000000  00000-0  00000-0 0  9991`;

  const inc = el.inclinationDeg.toFixed(4).padStart(8, " ");
  const raan = el.raanDeg.toFixed(4).padStart(8, " ");
  const ecc = el.eccentricity.toFixed(7).slice(2).padStart(7, "0");
  const argp = el.argPerigeeDeg.toFixed(4).padStart(8, " ");
  const ma = el.meanAnomalyDeg.toFixed(4).padStart(8, " ");
  const mm = meanMotion.toFixed(8).padStart(11, " ");
  const line2 = `2 ${satnum} ${inc} ${raan} ${ecc} ${argp} ${ma} ${mm}    0`;

  return [line1, line2];
}

/** Convert a satellite specification to a `satellite.js` satrec. */
export function toSatrec(spec: SatelliteSpec): satellite.SatRec {
  if (spec.type === "tle") {
    return satellite.twoline2satrec(spec.lines[0], spec.lines[1]);
  }
  const [l1, l2] = elementsToTle(spec.elements);
  return satellite.twoline2satrec(l1, l2);
}

/** List of satellites used by the demo. */
import satellites from "./satellites.generated";

export const SATELLITES: SatelliteSpec[] = satellites;

