import * as THREE from "three";
import { jday } from "satellite.js";

const DEG2RAD = Math.PI / 180;
export const OBLIQUITY = 23.4393 * DEG2RAD;

/** Convert a UTC Date to Julian Date */
function toJulianDate(date: Date): number {
  return jday(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds() + date.getUTCMilliseconds() / 1000
  );
}

/** Centuries since J2000.0 */
function julianCenturies(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

/** Sun's true longitude in radians */
export function sunTrueLongitude(date: Date): number {
  const jd = toJulianDate(date);
  const T = julianCenturies(jd);
  const L0 = (280.460 + 36000.770 * T + 0.0003032 * T * T) % 360;
  const g  = (357.528 + 35999.050 * T - 0.0001537 * T * T) % 360;
  const C  =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(g * DEG2RAD) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * g * DEG2RAD) +
    0.000289 * Math.sin(3 * g * DEG2RAD);
  return (L0 + C) * DEG2RAD;
}

/** Sun position vector in the ECI frame */
export function sunVectorECI(date: Date): {
  x: number;
  y: number;
  z: number;
  lambda: number;
} {
  const jd     = toJulianDate(date);
  const T      = julianCenturies(jd);
  const lambda = sunTrueLongitude(date);
  const eps    = OBLIQUITY - 0.0130042 * T * DEG2RAD;

  return {
    x: Math.cos(lambda),
    y: Math.cos(eps) * Math.sin(lambda),
    z: Math.sin(eps) * Math.sin(lambda),
    lambda,
  };
}

/** Generate Earth graticule as line segments */
export function createGraticule(stepDeg = 20): THREE.LineSegments {
  const verts: number[] = [];
  const material = new THREE.LineBasicMaterial({ color: 0xdcdcdc });

  // Longitude lines
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const lonRad = lon * DEG2RAD;
    for (let lat = -90; lat < 90; lat += 2) {
      const a = lat * DEG2RAD;
      const b = (lat + 2) * DEG2RAD;
      verts.push(
        Math.cos(a) * Math.cos(lonRad), Math.sin(a), -Math.cos(a) * Math.sin(lonRad),
        Math.cos(b) * Math.cos(lonRad), Math.sin(b), -Math.cos(b) * Math.sin(lonRad)
      );
    }
  }

  // Latitude lines
  for (let lat = -80; lat <= 80; lat += stepDeg) {
    const latRad = lat * DEG2RAD;
    for (let lon = -180; lon < 180; lon += 2) {
      const a = lon * DEG2RAD;
      const b = (lon + 2) * DEG2RAD;
      verts.push(
        Math.cos(latRad) * Math.cos(a), Math.sin(latRad), -Math.cos(latRad) * Math.sin(a),
        Math.cos(latRad) * Math.cos(b), Math.sin(latRad), -Math.cos(latRad) * Math.sin(b)
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
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
