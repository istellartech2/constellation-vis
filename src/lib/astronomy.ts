import * as THREE from "three";
import { gstime, jday, radiansToDegrees, sunPos } from "satellite.js";
import type { OrbitalElements } from "./satellites";

// A grab bag of helper functions used when building the Three.js scene.

const DEG2RAD = Math.PI / 180;
export const OBLIQUITY = 23.4393 * DEG2RAD;

/** Ratio of Earth's polar to equatorial radius. */
export const EARTH_FLATTENING = 6356.7523142 / 6378.137;

/** Earth gravitational parameter (GM) in km^3/s^2. */
const EARTH_MU_KM3_S2 = 398600.4418;
/** Earth sidereal rotation rate in rad/s. */
const EARTH_ROTATION_RATE_RAD_S = 7.2921150e-5;

/**
 * Geostationary semi-major axis in kilometres, derived from GM and the
 * sidereal rotation rate as (GM / ω²)^(1/3) ≈ 42164.17 km. At this radius the
 * orbital mean motion matches Earth's rotation, keeping the satellite fixed
 * over a longitude.
 */
export const GEO_SEMI_MAJOR_AXIS_KM = Math.cbrt(
  EARTH_MU_KM3_S2 / (EARTH_ROTATION_RATE_RAD_S * EARTH_ROTATION_RATE_RAD_S),
);

function normalizeAngleDeg(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/**
 * Greenwich Mean Sidereal Time at `date`, in degrees. Wraps `satellite.js`
 * `gstime` so it stays consistent with the ECI→geodetic conversion used
 * elsewhere for rendering and derived longitude.
 */
export function gmstDeg(date: Date): number {
  return normalizeAngleDeg(radiansToDegrees(gstime(date)));
}

/**
 * Right ascension of the ascending node (deg) that places the node over the
 * given East-positive longitude at `epoch`. Since a ground longitude maps to
 * ECI right ascension as `eciRA = longitude + GMST`, the node RA is
 * `normalize(longitude + GMST(epoch))`.
 *
 * Used as the RAAN so that at `epoch` the satellite (mean anomaly 0, i.e. at
 * the ascending node) sits on the equator over the target longitude. For an
 * equatorial orbit this simply parks it there; for an inclined geosynchronous
 * orbit it centres the figure-8 ground track on that longitude.
 */
export function geoNodeRightAscensionDeg(longitudeDeg: number, epoch: Date): number {
  return normalizeAngleDeg(longitudeDeg + gmstDeg(epoch));
}

/**
 * Build the classical orbital elements for a geostationary (or, with a
 * non-zero inclination, geosynchronous) satellite parked over `longitudeDeg`
 * (East positive) at `epoch`.
 */
export function geoElementsFromLongitude(opts: {
  satnum: number;
  epoch: Date;
  longitudeDeg: number;
  inclinationDeg?: number;
}): OrbitalElements {
  return {
    satnum: opts.satnum,
    epoch: opts.epoch,
    semiMajorAxisKm: GEO_SEMI_MAJOR_AXIS_KM,
    eccentricity: 0,
    inclinationDeg: opts.inclinationDeg ?? 0,
    raanDeg: geoNodeRightAscensionDeg(opts.longitudeDeg, opts.epoch),
    argPerigeeDeg: 0,
    meanAnomalyDeg: 0,
  };
}

/** Unit Sun direction in ECI, using the same ephemeris as eclipse analysis. */
export function sunVectorECI(date: Date): {
  x: number;
  y: number;
  z: number;
} {
  const sun = sunPos(jday(date)).rsun;
  const length = Math.hypot(sun.x, sun.y, sun.z);
  return { x: sun.x / length, y: sun.y / length, z: sun.z / length };
}

/**
 * Generate Earth graticule as line segments.
 * Lines are drawn translucent so the grid reads as a quiet reference rather
 * than competing with the texture; the equator and prime meridian keep a
 * faint tint so they stay identifiable at a glance.
 * @param stepDeg Angular spacing between lines in degrees.
 * @param offset  Fractional radial offset from the surface.
 * @param darkMode Draw dark lines (for the white-background theme).
 */
export function createGraticule(
  stepDeg = 10,
  offset = 0,
  darkMode = false,
): THREE.LineSegments {
  const verts: number[] = [];
  const colors: number[] = [];
  const r = 1 + offset;
  // Mid-gray on the light theme so lines read over both dark and light textures.
  const gray = new THREE.Color(darkMode ? 0x9ca3af : 0xffffff);
  const red = new THREE.Color(darkMode ? 0xef4444 : 0xff7a7a);
  const blue = new THREE.Color(darkMode ? 0x3b82f6 : 0x7a9cff);
  const gridAlpha = darkMode ? 0.3 : 0.16;
  const referenceAlpha = darkMode ? 0.5 : 0.45;
  const pushColor = (c: THREE.Color, a: number) => {
    for (let j = 0; j < 2; j++) colors.push(c.r, c.g, c.b, a);
  };

  // Longitude lines
  for (let lon = -180; lon < 180; lon += stepDeg) {
    const lonRad = lon * DEG2RAD;
    const isReference = lon === 0;
    for (let lat = -90; lat < 90; lat += 2) {
      const a = lat * DEG2RAD;
      const b = (lat + 2) * DEG2RAD;
      verts.push(
        Math.cos(a) * Math.cos(lonRad) * r,
        Math.sin(a) * EARTH_FLATTENING * r,
        -Math.cos(a) * Math.sin(lonRad) * r,
        Math.cos(b) * Math.cos(lonRad) * r,
        Math.sin(b) * EARTH_FLATTENING * r,
        -Math.cos(b) * Math.sin(lonRad) * r
      );
      pushColor(isReference ? blue : gray, isReference ? referenceAlpha : gridAlpha);
    }
  }

  // Latitude lines
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    const latRad = lat * DEG2RAD;
    const isReference = lat === 0;
    for (let lon = -180; lon < 180; lon += 2) {
      const a = lon * DEG2RAD;
      const b = (lon + 2) * DEG2RAD;
      verts.push(
        Math.cos(latRad) * Math.cos(a) * r,
        Math.sin(latRad) * EARTH_FLATTENING * r,
        -Math.cos(latRad) * Math.sin(a) * r,
        Math.cos(latRad) * Math.cos(b) * r,
        Math.sin(latRad) * EARTH_FLATTENING * r,
        -Math.cos(latRad) * Math.sin(b) * r
      );
      pushColor(isReference ? red : gray, isReference ? referenceAlpha : gridAlpha);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

/** Create a line representing the ecliptic plane */
export function createEclipticLine(stepDeg = 2): THREE.Line {
  const verts: number[] = [];

  for (let lon = 0; lon <= 360; lon += stepDeg) {
    const rad = lon * DEG2RAD;
    verts.push(
      Math.cos(rad),
      Math.sin(rad) * Math.sin(OBLIQUITY),
      -Math.sin(rad) * Math.cos(OBLIQUITY)
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.4 });
  return new THREE.Line(geometry, material);
}

/**
 * Create a line representing the geostationary orbit altitude circle.
 * The circle lies flat in the equatorial (ECI x-y) plane at the given
 * scene radius (1 unit = Earth's equatorial radius).
 */
export function createGeoOrbitLine(radius: number, stepDeg = 2): THREE.Line {
  const verts: number[] = [];

  for (let lon = 0; lon <= 360; lon += stepDeg) {
    const rad = lon * DEG2RAD;
    verts.push(Math.cos(rad) * radius, 0, -Math.sin(rad) * radius);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.3 });
  return new THREE.Line(geometry, material);
}
