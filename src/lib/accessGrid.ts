// Fast "how many satellites does each station see at each time step" kernel.
//
// Same visibility rules as `calculateStationAccessData` in visibility.ts
// (station elevation / off-nadir criteria, optional satellite FOV), but:
// - the per-pair test is a few dot products against precomputed station
//   vectors instead of ecfToLookAngles + acos + object allocations;
// - SGP4 runs only at knots every KNOT_SECONDS and the ECI state in between
//   comes from cubic Hermite interpolation of position and velocity (LEO error
//   is well under a metre at a 60 s knot spacing);
// - the result is a flat Uint16Array, cheap to transfer out of a worker.
import * as satellite from "satellite.js";
import type { SatelliteSpec } from "./satellites";
import { toSatrec } from "./satellites";
import type { GroundStation } from "./groundStations";
import {
  computeFovBoresightEcf,
  normalizeVisibilityCriteria,
  type SatelliteFovCriteria,
  type StationVisibilitySample,
} from "./visibility";

/** SGP4 knot spacing for Hermite interpolation of the ECI state. */
export const KNOT_SECONDS = 60;

export interface AccessGrid {
  startMs: number;
  stepMs: number;
  stepCount: number;
  stationCount: number;
  /** Visible-satellite count at [step * stationCount + station]. */
  counts: Uint16Array;
}

export interface AccessGridOptions {
  durationHours: number;
  stepSeconds: number;
  fov?: SatelliteFovCriteria;
  /** Called after each satellite with the completed fraction (0–1). */
  onProgress?: (fraction: number) => void;
}

interface FastObserver {
  x: number;
  y: number;
  z: number;
  /** Geodetic up unit vector (the "Z" of satellite.js' SEZ topocentric frame). */
  ux: number;
  uy: number;
  uz: number;
  sinMinElevation: number;
  cosMaxOffNadir: number;
  mode: "elevation_only" | "off_nadir_only" | "and";
}

function prepare(station: GroundStation): FastObserver {
  const criteria = normalizeVisibilityCriteria(station);
  const lat = satellite.degreesToRadians(station.latitudeDeg);
  const lon = satellite.degreesToRadians(station.longitudeDeg);
  const ecf = satellite.geodeticToEcf({ latitude: lat, longitude: lon, height: station.heightKm });
  const maxOffNadirRad = satellite.degreesToRadians(criteria.maxOffNadirDeg);
  const mode = criteria.visibilityMode === "off_nadir_only" || criteria.visibilityMode === "and"
    ? criteria.visibilityMode
    : "elevation_only";
  return {
    x: ecf.x,
    y: ecf.y,
    z: ecf.z,
    ux: Math.cos(lat) * Math.cos(lon),
    uy: Math.cos(lat) * Math.sin(lon),
    uz: Math.sin(lat),
    sinMinElevation: Math.sin(satellite.degreesToRadians(criteria.minElevationDeg)),
    // ≥ 180° (including the Infinity default) never rejects.
    cosMaxOffNadir: maxOffNadirRad >= Math.PI ? -2 : Math.cos(maxOffNadirRad),
    mode,
  };
}

/** Station-side criteria only (elevation / off-nadir), as in passesVisibilityCriteria. */
function passesStation(o: FastObserver, sx: number, sy: number, sz: number, sNorm: number): boolean {
  const dx = sx - o.x;
  const dy = sy - o.y;
  const dz = sz - o.z;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (range === 0) return false;
  const elevationPass = dx * o.ux + dy * o.uy + dz * o.uz >= o.sinMinElevation * range;
  if (o.mode === "elevation_only") return elevationPass;
  // cos(off-nadir) = (-s)·(o - s) / (|s||o - s|) = s·d / (|s||d|)
  const offNadirPass = sNorm > 0 && sx * dx + sy * dy + sz * dz >= o.cosMaxOffNadir * sNorm * range;
  return o.mode === "and" ? elevationPass && offNadirPass : offNadirPass;
}

/** Station inside the (tilted) sensor cone, as in withinSatelliteFov. */
function insideFov(
  o: FastObserver,
  sx: number, sy: number, sz: number,
  bx: number, by: number, bz: number,
  cosHalf: number,
): boolean {
  const dx = o.x - sx;
  const dy = o.y - sy;
  const dz = o.z - sz;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const bNorm = Math.sqrt(bx * bx + by * by + bz * bz);
  if (range === 0 || bNorm === 0) return false;
  return dx * bx + dy * by + dz * bz >= cosHalf * range * bNorm;
}

/**
 * Elevation-only fast path, kept as a small separate function so the JIT
 * optimises the hot loop on its own. Stations are pre-sorted by geocentric
 * latitude; only those within `reach` radians of the sub-satellite latitude
 * can see the satellite (the central angle is at least the latitude
 * difference), found by binary search. The test itself is
 * d·u ≥ sin(minEl)·|d| without the sqrt.
 */
function countElevationOnly(
  counts: Uint16Array,
  row: number,
  sorted: SortedStations,
  sx: number,
  sy: number,
  sz: number,
  sNorm: number,
): void {
  const { lat, pos, upv, sinMin, index, minRadius, cosMinElevation, minElevation } = sorted;
  // Largest Earth central angle at which any station still sees the satellite.
  const reach = Math.acos(Math.min(1, (minRadius * cosMinElevation) / sNorm)) - minElevation + LATITUDE_MARGIN_RAD;
  const satLat = Math.asin(sz / sNorm);
  const lo = lowerBound(lat, satLat - reach);
  const hi = satLat + reach;
  for (let k = lo; k < lat.length && lat[k] <= hi; k++) {
    const j = k * 3;
    const dx = sx - pos[j];
    const dy = sy - pos[j + 1];
    const dz = sz - pos[j + 2];
    const up = dx * upv[j] + dy * upv[j + 1] + dz * upv[j + 2];
    const sm = sinMin[k];
    const rhs = sm * sm * (dx * dx + dy * dy + dz * dz);
    const visible = sm >= 0 ? up > 0 && up * up >= rhs : up >= 0 || up * up <= rhs;
    if (visible) counts[row + index[k]]++;
  }
}

/** Covers the geodetic-vs-geocentric up-vector tilt (≤ 0.2°) with room to spare. */
const LATITUDE_MARGIN_RAD = (1 * Math.PI) / 180;

interface SortedStations {
  /** Geocentric latitude (rad), ascending. */
  lat: Float64Array;
  pos: Float64Array;
  upv: Float64Array;
  sinMin: Float64Array;
  /** Original station index for each sorted slot. */
  index: Int32Array;
  minRadius: number;
  minElevation: number;
  cosMinElevation: number;
}

function sortStations(observers: FastObserver[], minElevationRad: number[]): SortedStations {
  const order = observers
    .map((o, i) => ({ i, lat: Math.asin(o.z / Math.hypot(o.x, o.y, o.z)) }))
    .sort((a, b) => a.lat - b.lat);
  const minElevation = Math.min(...minElevationRad);
  return {
    lat: Float64Array.from(order, (e) => e.lat),
    pos: Float64Array.from(order.flatMap(({ i }) => [observers[i].x, observers[i].y, observers[i].z])),
    upv: Float64Array.from(order.flatMap(({ i }) => [observers[i].ux, observers[i].uy, observers[i].uz])),
    sinMin: Float64Array.from(order, ({ i }) => observers[i].sinMinElevation),
    index: Int32Array.from(order, (e) => e.i),
    minRadius: Math.min(...observers.map((o) => Math.hypot(o.x, o.y, o.z))),
    minElevation,
    cosMinElevation: Math.cos(minElevation),
  };
}

function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Knot {
  ok: boolean;
  rx: number; ry: number; rz: number;
  vx: number; vy: number; vz: number;
}

function propagateKnot(rec: satellite.SatRec, ms: number): Knot {
  const pv = satellite.propagate(rec, new Date(ms));
  const p = pv?.position;
  const v = pv?.velocity;
  if (!p || !v || typeof p === "boolean" || typeof v === "boolean") {
    return { ok: false, rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0 };
  }
  return { ok: true, rx: p.x, ry: p.y, rz: p.z, vx: v.x, vy: v.y, vz: v.z };
}

export function computeAccessGrid(
  sats: SatelliteSpec[],
  stations: GroundStation[],
  start: Date,
  { durationHours, stepSeconds, fov, onProgress }: AccessGridOptions,
): AccessGrid {
  const startMs = start.getTime();
  const stepMs = stepSeconds * 1000;
  const stepCount = Math.floor((durationHours * 3600) / stepSeconds) + 1;
  const stationCount = stations.length;
  const counts = new Uint16Array(stepCount * stationCount);
  const observers = stations.map(prepare);
  // Latitude-sorted flat copies for the common elevation-only loop.
  const fastPath = !fov && observers.length > 0 && observers.every((o) => o.mode === "elevation_only");
  const sorted = fastPath
    ? sortStations(observers, stations.map((st) => satellite.degreesToRadians(normalizeVisibilityCriteria(st).minElevationDeg)))
    : null;

  // Earth rotation per step, shared by every satellite.
  const cosG = new Float64Array(stepCount);
  const sinG = new Float64Array(stepCount);
  const gmst = new Float64Array(stepCount);
  for (let i = 0; i < stepCount; i++) {
    const g = satellite.gstime(new Date(startMs + i * stepMs));
    gmst[i] = g;
    cosG[i] = Math.cos(g);
    sinG[i] = Math.sin(g);
  }

  // Interpolate only when knots are coarser than the output step.
  const knotMs = KNOT_SECONDS * 1000;
  const interpolate = stepMs < knotMs;
  const cosHalf = fov ? Math.cos(satellite.degreesToRadians(fov.halfAngleDeg)) : 0;
  const recs = sats.map((s) => toSatrec(s));

  for (let si = 0; si < recs.length; si++) {
    const rec = recs[si];
    let k0: Knot | null = null;
    let k1: Knot | null = null;
    let k0Ms = Number.NaN;

    for (let step = 0; step < stepCount; step++) {
      const ms = startMs + step * stepMs;
      let rx: number, ry: number, rz: number, vx: number, vy: number, vz: number;

      if (interpolate) {
        const knotStart = startMs + Math.floor((ms - startMs) / knotMs) * knotMs;
        if (knotStart !== k0Ms) {
          k0 = knotStart === k0Ms + knotMs && k1 ? k1 : propagateKnot(rec, knotStart);
          k1 = propagateKnot(rec, knotStart + knotMs);
          k0Ms = knotStart;
        }
        const a = k0!;
        const b = k1!;
        if (!a.ok || !b.ok) {
          // Decayed or failed at a knot: fall back to propagating this step directly.
          const direct = propagateKnot(rec, ms);
          if (!direct.ok) continue;
          ({ rx, ry, rz, vx, vy, vz } = direct);
        } else {
          const h = knotMs / 1000;
          const t = (ms - k0Ms) / knotMs;
          const t2 = t * t;
          const t3 = t2 * t;
          const h00 = 2 * t3 - 3 * t2 + 1;
          const h10 = (t3 - 2 * t2 + t) * h;
          const h01 = -2 * t3 + 3 * t2;
          const h11 = (t3 - t2) * h;
          rx = h00 * a.rx + h10 * a.vx + h01 * b.rx + h11 * b.vx;
          ry = h00 * a.ry + h10 * a.vy + h01 * b.ry + h11 * b.vy;
          rz = h00 * a.rz + h10 * a.vz + h01 * b.rz + h11 * b.vz;
          if (fov) {
            const d00 = (6 * t2 - 6 * t) / h;
            const d10 = 3 * t2 - 4 * t + 1;
            const d01 = (-6 * t2 + 6 * t) / h;
            const d11 = 3 * t2 - 2 * t;
            vx = d00 * a.rx + d10 * a.vx + d01 * b.rx + d11 * b.vx;
            vy = d00 * a.ry + d10 * a.vy + d01 * b.ry + d11 * b.vy;
            vz = d00 * a.rz + d10 * a.vz + d01 * b.rz + d11 * b.vz;
          } else {
            vx = vy = vz = 0;
          }
        }
      } else {
        const direct = propagateKnot(rec, ms);
        if (!direct.ok) continue;
        ({ rx, ry, rz, vx, vy, vz } = direct);
      }

      // ECI → ECF (rotation about Z by GMST), as satellite.eciToEcf.
      const c = cosG[step];
      const s = sinG[step];
      const sx = rx * c + ry * s;
      const sy = -rx * s + ry * c;
      const sz = rz;
      const sNorm = Math.sqrt(sx * sx + sy * sy + sz * sz);

      const row = step * stationCount;
      if (sorted) {
        if (sNorm > 0) countElevationOnly(counts, row, sorted, sx, sy, sz, sNorm);
        continue;
      }

      // The boresight is station-independent; compute it lazily, once.
      let boresight: satellite.EcfVec3<number> | null | undefined;
      for (let gi = 0; gi < stationCount; gi++) {
        const o = observers[gi];
        if (!passesStation(o, sx, sy, sz, sNorm)) continue;
        if (fov) {
          if (boresight === undefined) {
            boresight = computeFovBoresightEcf(
              { x: rx, y: ry, z: rz },
              { x: vx, y: vy, z: vz },
              gmst[step],
              fov,
            );
          }
          if (!boresight || !insideFov(o, sx, sy, sz, boresight.x, boresight.y, boresight.z, cosHalf)) continue;
        }
        counts[row + gi]++;
      }
    }
    onProgress?.((si + 1) / recs.length);
  }

  return { startMs, stepMs, stepCount, stationCount, counts };
}

/** One station's counts over time (copied out of the strided grid). */
export function gridStationCounts(grid: AccessGrid, stationIndex: number): Uint16Array {
  const out = new Uint16Array(grid.stepCount);
  for (let i = 0; i < grid.stepCount; i++) out[i] = grid.counts[i * grid.stationCount + stationIndex];
  return out;
}

/**
 * The grid as the per-step sample objects the access screens chart from,
 * optionally averaged over `averagePoints` consecutive steps.
 */
export function gridToSamples(
  grid: AccessGrid,
  stationNames: string[],
  averagePoints = 1,
): StationVisibilitySample[] {
  const n = Math.max(1, Math.floor(averagePoints));
  const out: StationVisibilitySample[] = [];
  for (let first = 0; first < grid.stepCount; first += n) {
    const last = Math.min(grid.stepCount, first + n);
    const timestamp = grid.startMs + first * grid.stepMs;
    out.push({
      time: new Date(timestamp).toISOString().slice(11, 19),
      timestamp,
      stations: stationNames.map((name, gi) => {
        let sum = 0;
        for (let i = first; i < last; i++) sum += grid.counts[i * grid.stationCount + gi];
        return { name, visibleCount: sum / (last - first) };
      }),
    });
  }
  return out;
}
