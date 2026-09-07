/** Shell-level orbit shape helpers shared by every pattern. */

import { numberField } from "./fields";
import type { PatternShellInput, ShellOrbit } from "./types";

export const EARTH_RADIUS_KM = 6378.137;
/** Earth gravitational parameter, km^3/s^2 (matches `satellites.ts`). */
export const MU_KM3_S2 = 398600.4418;

/**
 * Semi-major axis from the stored apogee altitude.
 *
 * Kept as the literal expression `(EARTH_RADIUS_KM + h) / (1 + e)` from the
 * original `generateFromShellsDetailed` — refactoring it (e.g. multiplying by
 * a reciprocal) changes the last mantissa bit and breaks
 * `tests/constellationPatternsBaseline.test.ts`.
 */
export function semiMajorAxisFromApogeeAltitude(apogeeAltitudeKm: number, ecc: number): number {
  const apogeeRadius = EARTH_RADIUS_KM + apogeeAltitudeKm;
  return apogeeRadius / (1 + ecc);
}

/** Reads the common orbit fields (altitude/eccentricity/inclination/argp). */
export function orbitFromShell(shell: PatternShellInput): ShellOrbit {
  const eccentricity = numberField("eccentricity", shell);
  return {
    semiMajorAxisKm: semiMajorAxisFromApogeeAltitude(
      numberField("apogee_altitude", shell),
      eccentricity,
    ),
    eccentricity,
    inclinationDeg: numberField("inclination", shell),
    argPerigeeDeg: numberField("argp", shell),
  };
}

/** Keplerian period in minutes for a semi-major axis in km. */
export function periodMinFromSemiMajorAxis(semiMajorAxisKm: number): number {
  return (2 * Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / MU_KM3_S2)) / 60;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}
