/**
 * The coverage hot loop, deliberately propagation-agnostic.
 *
 * `accumulateCoverage` knows nothing about SGP4, Keplerian motion or Walker
 * notation: the caller hands it a `sampleAt` callback that fills a preallocated
 * `KernelSample` with ECF satellite positions for one time step. That is what
 * lets the coarse analytic screen (`screen.ts`) and the SGP4 verification
 * (`verify.ts`) share one predicate implementation, so a "screened feasible /
 * verified infeasible" disagreement can only come from fidelity, never from two
 * subtly different geometry implementations.
 *
 * Performance discipline (this runs ~5M–60M predicate evaluations per
 * candidate): no per-step allocation, no closures inside the inner loops, flat
 * typed arrays only, and a latitude-band prefilter so a satellite is only tested
 * against grid rows it could possibly cover.
 */

/** WGS-84 equatorial radius, km. Matches `isl/geometry.ts::EARTH_RADIUS_EQUATOR_KM`. */
export const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Latitude bins for the satellite bucket sort. 1° bins over [-90°, 90°]; bin
 * `b` holds sub-satellite geocentric latitudes in [b - 90, b - 89).
 */
const LAT_BIN_COUNT = 181;

/**
 * Extra latitude reach granted to the band prefilter when the WGS-84 elevation
 * predicate is used. The spherical band bound (|φ - ψ| ≤ θ) is exact for the
 * spherical predicate but not for the ellipsoid one: the geodetic normal is
 * tilted from the geocentric radius by up to 0.19°, and the polar radius is
 * 21 km smaller than the equatorial one. See `ellipsoidBandMarginRad`;
 * `tests/constellationDesign-kernel.test.ts` pins banded and unbanded results
 * to be identical for both predicates.
 */
const SPHERICAL_BAND_MARGIN_RAD = 1e-6;
/** Upper bound on geodetic − geocentric latitude for WGS-84 (≈0.1924° at 45°). */
const GEODETIC_TILT_RAD = 0.1924 * DEG;

/**
 * Extra latitude reach for the ellipsoid predicate. `θ` is computed on the
 * equatorial sphere; over the flattened high-latitude surface the same orbit
 * radius `r = a·cos ε / cos(θ+ε)` sees further:
 *   θ_polar = acos((a(1−f)/r)·cos ε) − ε
 * A fixed 0.5° is *not* an upper bound (≈0.66° at h = 300 km, ε = 0), so the
 * margin is derived per call. Adds the geodetic-normal tilt on top.
 */
function ellipsoidBandMarginRad(thetaRad: number, epsRad: number): number {
  const cosEps = Math.cos(epsRad);
  const denom = Math.cos(thetaRad + epsRad);
  if (!(denom > 0)) return 1.0 * DEG;
  const r = (WGS84_A_KM * cosEps) / denom;
  const arg = Math.min(1, Math.max(-1, ((WGS84_A_KM * (1 - WGS84_F)) / r) * cosEps));
  const thetaPolar = Math.acos(arg) - epsRad;
  return Math.max(0, thetaPolar - thetaRad) + GEODETIC_TILT_RAD + 1e-6;
}

/**
 * Golden-ratio longitude dither increment, in turns. Applied on top of true
 * Earth rotation when the fast path samples only a `T_orb/S` window: without it
 * the same handful of ground-track longitudes are revisited every step and
 * seam holes (e.g. Iridium's) are never sampled.
 */
export const GOLDEN_RATIO_DITHER_TURNS = 0.6180339887;

/**
 * Sentinel sub-satellite latitude for a satellite whose propagation failed.
 * Larger than any real latitude in radians, so the band prefilter drops it from
 * every row — a failed propagation must never be substituted with a {0,0,0}
 * position, which would read as a real satellite at the Earth's centre.
 */
export const INVALID_SUB_LATITUDE_RAD = 99;

/**
 * A near-equal-area latitude/longitude point set, stored as flat typed arrays.
 *
 * Rows are ordered by ascending latitude. Each row holds
 * `max(1, round(360/Δ · cos φ))` equally spaced longitudes, so point density is
 * roughly uniform per unit area (2° global ≈ 10 300 points instead of the
 * 16 200 a naive lat/lon grid would put mostly near the poles).
 */
export interface RegionGrid {
  /** Number of latitude rows. */
  rowCount: number;
  /** Geocentric latitude of each row, radians — the quantity the band prefilter compares against. */
  rowLatRad: Float64Array;
  /** Geodetic latitude of each row, degrees — the quantity reported to users. */
  rowLatDeg: Float64Array;
  /** Index into the point arrays of each row's first point. */
  rowStart: Int32Array;
  /** Number of points in each row. */
  rowLen: Int32Array;
  /** Point position on the WGS-84 ellipsoid surface, ECF km. */
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** Geodetic up (ellipsoid normal) unit vector at the point. */
  ux: Float64Array;
  uy: Float64Array;
  uz: Float64Array;
  /** Geocentric unit direction of the point (used by the spherical predicate). */
  cx: Float64Array;
  cy: Float64Array;
  cz: Float64Array;
  pointCount: number;
  stepDeg: number;
  latMinDeg: number;
  latMaxDeg: number;
}

/**
 * One time step's satellite state, preallocated once per candidate and mutated
 * in place by `sampleAt`.
 *
 * `count` is fixed for the whole run and is set by the caller before
 * `accumulateCoverage`; `sampleAt` must not change it.
 */
export interface KernelSample {
  /** ECF positions in km, `[x0, y0, z0, x1, y1, z1, …]`, length ≥ 3·count. */
  positionsEcf: Float64Array;
  /** Sub-satellite *geocentric* latitude in radians, or `INVALID_SUB_LATITUDE_RAD`. */
  subLatRad: Float64Array;
  count: number;
}

export function createKernelSample(satelliteCount: number): KernelSample {
  return {
    positionsEcf: new Float64Array(satelliteCount * 3),
    subLatRad: new Float64Array(satelliteCount),
    count: satelliteCount,
  };
}

/**
 * Fills one time step. `timeSec` is the offset from the run's start instant;
 * the kernel owns the time stepping (`timeSec = stepIndex · windowSec / timeSteps`)
 * so callers cannot disagree with it about the sample grid.
 */
export type KernelSampler = (stepIndex: number, timeSec: number, out: KernelSample) => void;

export interface CoverageOptions {
  /** Earth central angle θ, radians. */
  centralAngleRad: number;
  /** Minimum elevation ε, radians. Used by the ellipsoid predicate only. */
  minElevationRad: number;
  /** Required simultaneous satellite count. */
  fold: number;
  predicate: "spherical" | "ellipsoid";
  timeSteps: number;
  /** Length of the sampled time window, seconds. */
  windowSec: number;
  /** Apply the golden-ratio longitude dither on top of the sampler's own Earth rotation. */
  ditherLongitude: boolean;
  /** Test only: skip the latitude-band prefilter (used to prove the prefilter is lossless). */
  disableBanding?: boolean;
}

export interface CoverageLatitudeRow {
  /** Geodetic latitude, degrees. */
  latitudeDeg: number;
  meanFold: number;
  foldAvailability: number;
  minFold: number;
}

export interface CoverageStats {
  /**
   * Minimum simultaneous satellite count over every sampled (point, time) pair.
   * Resolution-sensitive: refining the grid or the time step can only lower it.
   */
  minFold: number;
  meanFold: number;
  /** Fraction of sampled (point, time) pairs meeting `fold`. The feasibility metric. */
  foldAvailability: number;
  /** Geodetic latitude of the row with the lowest availability. */
  worstLatitudeDeg: number;
  worstFoldAtWorstLatitude: number;
  perLatitude: CoverageLatitudeRow[];
  /** Number of (point, time) pairs evaluated. */
  sampleCount: number;
  /** Number of visibility predicate evaluations. */
  testCount: number;
}

/* -------------------------------------------------------------------------- */
/* Grid construction                                                          */
/* -------------------------------------------------------------------------- */

function gridKey(latMinDeg: number, latMaxDeg: number, stepDeg: number): string {
  return `${latMinDeg}|${latMaxDeg}|${stepDeg}`;
}

const gridCache = new Map<string, RegionGrid>();
const GRID_CACHE_LIMIT = 8;

/**
 * Builds (and memoizes) the region grid. The optimizer screens thousands of
 * candidates against the same handful of grids, and building a 2° global grid
 * costs ~10 000 trig evaluations — worth caching, harmless to share because the
 * grid is never mutated.
 */
export function buildRegionGrid(latMinDeg: number, latMaxDeg: number, stepDeg: number): RegionGrid {
  const key = gridKey(latMinDeg, latMaxDeg, stepDeg);
  const cached = gridCache.get(key);
  if (cached) return cached;
  const grid = createRegionGrid(latMinDeg, latMaxDeg, stepDeg);
  if (gridCache.size >= GRID_CACHE_LIMIT) {
    const oldest = gridCache.keys().next();
    if (!oldest.done) gridCache.delete(oldest.value);
  }
  gridCache.set(key, grid);
  return grid;
}

function createRegionGrid(latMinDeg: number, latMaxDeg: number, stepDeg: number): RegionGrid {
  if (!(stepDeg > 0)) throw new Error(`buildRegionGrid: stepDeg must be positive (got ${stepDeg})`);
  const lo = Math.max(-90, Math.min(latMinDeg, latMaxDeg));
  const hi = Math.min(90, Math.max(latMinDeg, latMaxDeg));
  const rowCount = Math.max(1, Math.round((hi - lo) / stepDeg) + 1);

  const rowLatDeg = new Float64Array(rowCount);
  const rowLen = new Int32Array(rowCount);
  const rowStart = new Int32Array(rowCount);
  const lonPerRow = 360 / stepDeg;

  let total = 0;
  for (let r = 0; r < rowCount; r++) {
    const latDeg = rowCount === 1 ? 0.5 * (lo + hi) : lo + (r * (hi - lo)) / (rowCount - 1);
    rowLatDeg[r] = latDeg;
    const n = Math.max(1, Math.round(lonPerRow * Math.cos(latDeg * DEG)));
    rowLen[r] = n;
    rowStart[r] = total;
    total += n;
  }

  const px = new Float64Array(total);
  const py = new Float64Array(total);
  const pz = new Float64Array(total);
  const ux = new Float64Array(total);
  const uy = new Float64Array(total);
  const uz = new Float64Array(total);
  const cx = new Float64Array(total);
  const cy = new Float64Array(total);
  const cz = new Float64Array(total);
  const rowLatRad = new Float64Array(rowCount);

  for (let r = 0; r < rowCount; r++) {
    const phi = rowLatDeg[r] * DEG;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    // Prime vertical radius of curvature on the WGS-84 ellipsoid.
    const nRad = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    const rXY = nRad * cosPhi;
    const rZ = nRad * (1 - WGS84_E2) * sinPhi;
    // Geocentric latitude is constant along a row, so the band prefilter can
    // work per row rather than per point.
    rowLatRad[r] = Math.atan2(rZ, rXY);

    const n = rowLen[r];
    const start = rowStart[r];
    const dLon = 360 / n;
    for (let m = 0; m < n; m++) {
      const lam = (-180 + m * dLon) * DEG;
      const cosLam = Math.cos(lam);
      const sinLam = Math.sin(lam);
      const i = start + m;
      const x = rXY * cosLam;
      const y = rXY * sinLam;
      px[i] = x;
      py[i] = y;
      pz[i] = rZ;
      ux[i] = cosPhi * cosLam;
      uy[i] = cosPhi * sinLam;
      uz[i] = sinPhi;
      const inv = 1 / Math.sqrt(x * x + y * y + rZ * rZ);
      cx[i] = x * inv;
      cy[i] = y * inv;
      cz[i] = rZ * inv;
    }
  }

  return {
    rowCount,
    rowLatRad,
    rowLatDeg,
    rowStart,
    rowLen,
    px,
    py,
    pz,
    ux,
    uy,
    uz,
    cx,
    cy,
    cz,
    pointCount: total,
    stepDeg,
    latMinDeg: lo,
    latMaxDeg: hi,
  };
}

/* -------------------------------------------------------------------------- */
/* Reusable scratch buffers                                                   */
/* -------------------------------------------------------------------------- */

interface Workspace {
  foldBuf: Int32Array;
  rowSum: Float64Array;
  rowSat: Float64Array;
  rowMin: Int32Array;
  unitX: Float64Array;
  unitY: Float64Array;
  unitZ: Float64Array;
  satX: Float64Array;
  satY: Float64Array;
  satZ: Float64Array;
  binCount: Int32Array;
  binStart: Int32Array;
  binCursor: Int32Array;
  sortedIdx: Int32Array;
}

let workspace: Workspace | null = null;

function ensureWorkspace(pointCount: number, rowCount: number, satCount: number): Workspace {
  const w = workspace;
  if (
    w &&
    w.foldBuf.length >= pointCount &&
    w.rowSum.length >= rowCount &&
    w.unitX.length >= satCount
  ) {
    return w;
  }
  const points = Math.max(pointCount, w?.foldBuf.length ?? 0);
  const rows = Math.max(rowCount, w?.rowSum.length ?? 0);
  const sats = Math.max(satCount, w?.unitX.length ?? 0);
  const next: Workspace = {
    foldBuf: new Int32Array(points),
    rowSum: new Float64Array(rows),
    rowSat: new Float64Array(rows),
    rowMin: new Int32Array(rows),
    unitX: new Float64Array(sats),
    unitY: new Float64Array(sats),
    unitZ: new Float64Array(sats),
    satX: new Float64Array(sats),
    satY: new Float64Array(sats),
    satZ: new Float64Array(sats),
    binCount: new Int32Array(LAT_BIN_COUNT),
    binStart: new Int32Array(LAT_BIN_COUNT + 1),
    binCursor: new Int32Array(LAT_BIN_COUNT),
    sortedIdx: new Int32Array(sats),
  };
  workspace = next;
  return next;
}

/** Test hook: drops the shared scratch buffers so a test can measure a cold run. */
export function resetCoverageKernelScratch(): void {
  workspace = null;
  gridCache.clear();
}

/* -------------------------------------------------------------------------- */
/* Main accumulation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Samples `opts.timeSteps` instants over `opts.windowSec` and accumulates fold
 * statistics over `grid`.
 *
 * `sample` is the caller's preallocated per-candidate buffer (the plan's
 * signature omitted it; the kernel cannot allocate it itself because only the
 * caller knows the satellite count, and reusing one buffer across every step
 * and every candidate is the whole point of `KernelSample`).
 *
 * The satellite positions the sampler produces are rotated about the ECF z axis
 * by the (negated) golden-ratio dither instead of rotating the 10 000-point
 * grid — the two are equivalent for both predicates (a rotation about z maps the
 * ellipsoid onto itself) and one costs O(satellites) rather than O(points).
 */
export function accumulateCoverage(
  grid: RegionGrid,
  sample: KernelSample,
  sampleAt: KernelSampler,
  opts: CoverageOptions,
): CoverageStats {
  const { rowCount, pointCount } = grid;
  const timeSteps = Math.max(1, Math.floor(opts.timeSteps));
  const fold = Math.max(1, Math.floor(opts.fold));
  const satCount = sample.count;
  const useEllipsoid = opts.predicate === "ellipsoid";
  const banded = opts.disableBanding !== true;

  const cosTheta = Math.cos(opts.centralAngleRad);
  const sinEps = Math.sin(Math.max(0, opts.minElevationRad));
  const sinEpsSq = sinEps * sinEps;
  const reachRad =
    opts.centralAngleRad +
    (useEllipsoid
      ? ellipsoidBandMarginRad(opts.centralAngleRad, Math.max(0, opts.minElevationRad))
      : SPHERICAL_BAND_MARGIN_RAD);
  const reachDeg = reachRad * RAD;

  const w = ensureWorkspace(pointCount, rowCount, Math.max(1, satCount));
  const {
    foldBuf,
    rowSum,
    rowSat,
    rowMin,
    unitX,
    unitY,
    unitZ,
    satX,
    satY,
    satZ,
    binCount,
    binStart,
    binCursor,
    sortedIdx,
  } = w;

  rowSum.fill(0, 0, rowCount);
  rowSat.fill(0, 0, rowCount);
  rowMin.fill(0x7fffffff, 0, rowCount);

  const { rowLatRad, rowLatDeg, rowStart, rowLen, px, py, pz, ux, uy, uz, cx, cy, cz } = grid;

  let sumFold = 0;
  let satisfied = 0;
  let minFold = 0x7fffffff;
  let testCount = 0;

  const stepSec = opts.windowSec / timeSteps;

  for (let k = 0; k < timeSteps; k++) {
    sampleAt(k, k * stepSec, sample);

    // Golden-ratio longitude dither, applied to the satellites (cheap) rather
    // than the grid (expensive) — see the doc comment above.
    let dCos = 1;
    let dSin = 0;
    if (opts.ditherLongitude && k > 0) {
      const dLon = 2 * Math.PI * ((k * GOLDEN_RATIO_DITHER_TURNS) % 1);
      dCos = Math.cos(dLon);
      dSin = Math.sin(dLon);
    }

    const pos = sample.positionsEcf;
    const subLat = sample.subLatRad;

    binCount.fill(0);
    let valid = 0;
    for (let s = 0; s < satCount; s++) {
      const psi = subLat[s];
      if (!(psi >= -1.5708 && psi <= 1.5708)) continue; // sentinel / NaN
      const x0 = pos[s * 3];
      const y0 = pos[s * 3 + 1];
      const z0 = pos[s * 3 + 2];
      const x = x0 * dCos + y0 * dSin;
      const y = -x0 * dSin + y0 * dCos;
      satX[s] = x;
      satY[s] = y;
      satZ[s] = z0;
      const inv = 1 / Math.sqrt(x * x + y * y + z0 * z0);
      unitX[s] = x * inv;
      unitY[s] = y * inv;
      unitZ[s] = z0 * inv;
      let bin = Math.floor(psi * RAD) + 90;
      if (bin < 0) bin = 0;
      else if (bin > LAT_BIN_COUNT - 1) bin = LAT_BIN_COUNT - 1;
      binCount[bin]++;
      valid++;
    }

    // Prefix-sum offset table, then a single bucket-sort pass.
    let acc = 0;
    for (let b = 0; b < LAT_BIN_COUNT; b++) {
      binStart[b] = acc;
      binCursor[b] = acc;
      acc += binCount[b];
    }
    binStart[LAT_BIN_COUNT] = acc;
    for (let s = 0; s < satCount; s++) {
      const psi = subLat[s];
      if (!(psi >= -1.5708 && psi <= 1.5708)) continue;
      let bin = Math.floor(psi * RAD) + 90;
      if (bin < 0) bin = 0;
      else if (bin > LAT_BIN_COUNT - 1) bin = LAT_BIN_COUNT - 1;
      sortedIdx[binCursor[bin]++] = s;
    }

    for (let r = 0; r < rowCount; r++) {
      const start = rowStart[r];
      const len = rowLen[r];
      const end = start + len;
      foldBuf.fill(0, start, end);

      let from = 0;
      let to = valid;
      if (banded) {
        const phiDeg = rowLatRad[r] * RAD;
        let binLo = Math.floor(phiDeg - reachDeg) + 90;
        let binHi = Math.floor(phiDeg + reachDeg) + 90;
        if (binLo < 0) binLo = 0;
        if (binHi > LAT_BIN_COUNT - 1) binHi = LAT_BIN_COUNT - 1;
        if (binHi < 0 || binLo > LAT_BIN_COUNT - 1) {
          from = 0;
          to = 0;
        } else {
          from = binStart[binLo];
          to = binStart[binHi + 1];
        }
      }

      if (to > from) {
        testCount += (to - from) * len;
        if (useEllipsoid) {
          for (let q = from; q < to; q++) {
            const s = sortedIdx[q];
            const sx = satX[s];
            const sy = satY[s];
            const sz = satZ[s];
            for (let i = start; i < end; i++) {
              const dx = sx - px[i];
              const dy = sy - py[i];
              const dz = sz - pz[i];
              const dot = ux[i] * dx + uy[i] * dy + uz[i] * dz;
              if (dot <= 0) continue;
              if (dot * dot >= sinEpsSq * (dx * dx + dy * dy + dz * dz)) foldBuf[i]++;
            }
          }
        } else {
          for (let q = from; q < to; q++) {
            const s = sortedIdx[q];
            const sx = unitX[s];
            const sy = unitY[s];
            const sz = unitZ[s];
            for (let i = start; i < end; i++) {
              if (cx[i] * sx + cy[i] * sy + cz[i] * sz >= cosTheta) foldBuf[i]++;
            }
          }
        }
      }

      let rSum = 0;
      let rSat = 0;
      let rMin = rowMin[r];
      for (let i = start; i < end; i++) {
        const v = foldBuf[i];
        rSum += v;
        if (v >= fold) rSat++;
        if (v < rMin) rMin = v;
      }
      rowSum[r] += rSum;
      rowSat[r] += rSat;
      rowMin[r] = rMin;
      sumFold += rSum;
      satisfied += rSat;
      if (rMin < minFold) minFold = rMin;
    }
  }

  const sampleCount = pointCount * timeSteps;
  const perLatitude: CoverageLatitudeRow[] = new Array(rowCount);
  let worstRow = 0;
  let worstAvail = Number.POSITIVE_INFINITY;
  let worstMean = Number.POSITIVE_INFINITY;
  for (let r = 0; r < rowCount; r++) {
    const pairs = rowLen[r] * timeSteps;
    const mean = pairs > 0 ? rowSum[r] / pairs : 0;
    const avail = pairs > 0 ? rowSat[r] / pairs : 0;
    perLatitude[r] = {
      latitudeDeg: rowLatDeg[r],
      meanFold: mean,
      foldAvailability: avail,
      minFold: rowMin[r] === 0x7fffffff ? 0 : rowMin[r],
    };
    if (avail < worstAvail - 1e-12 || (Math.abs(avail - worstAvail) <= 1e-12 && mean < worstMean)) {
      worstAvail = avail;
      worstMean = mean;
      worstRow = r;
    }
  }

  return {
    minFold: minFold === 0x7fffffff ? 0 : minFold,
    meanFold: sampleCount > 0 ? sumFold / sampleCount : 0,
    foldAvailability: sampleCount > 0 ? satisfied / sampleCount : 0,
    worstLatitudeDeg: rowLatDeg[worstRow],
    worstFoldAtWorstLatitude: perLatitude[worstRow]?.minFold ?? 0,
    perLatitude,
    sampleCount,
    testCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Fixed-point gap sampling                                                   */
/* -------------------------------------------------------------------------- */

/** A small set of fixed ground points used for outage-gap statistics. */
export interface GapPointSet {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  ux: Float64Array;
  uy: Float64Array;
  uz: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
  cz: Float64Array;
  latDeg: Float64Array;
  count: number;
}

/**
 * ~110 fixed points: one row per `latStepDeg` of latitude, `lonCount`
 * longitudes each. Gap length is a property of a *fixed* point tracked through
 * real time, so this pass must never be dithered and never use the coarse
 * `T_orb/S` window; it gets its own point set to keep that separation obvious.
 */
export function buildGapPointSet(
  latMinDeg: number,
  latMaxDeg: number,
  latStepDeg = 5,
  lonCount = 3,
): GapPointSet {
  const lo = Math.max(-90, Math.min(latMinDeg, latMaxDeg));
  const hi = Math.min(90, Math.max(latMinDeg, latMaxDeg));
  const rows = Math.max(1, Math.round((hi - lo) / latStepDeg) + 1);
  const n = rows * lonCount;
  const set: GapPointSet = {
    px: new Float64Array(n),
    py: new Float64Array(n),
    pz: new Float64Array(n),
    ux: new Float64Array(n),
    uy: new Float64Array(n),
    uz: new Float64Array(n),
    cx: new Float64Array(n),
    cy: new Float64Array(n),
    cz: new Float64Array(n),
    latDeg: new Float64Array(n),
    count: n,
  };
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const latDeg = rows === 1 ? 0.5 * (lo + hi) : lo + (r * (hi - lo)) / (rows - 1);
    const phi = latDeg * DEG;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const nRad = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    const rXY = nRad * cosPhi;
    const rZ = nRad * (1 - WGS84_E2) * sinPhi;
    for (let m = 0; m < lonCount; m++) {
      const lam = (-180 + (m * 360) / lonCount) * DEG;
      const x = rXY * Math.cos(lam);
      const y = rXY * Math.sin(lam);
      set.px[i] = x;
      set.py[i] = y;
      set.pz[i] = rZ;
      set.ux[i] = cosPhi * Math.cos(lam);
      set.uy[i] = cosPhi * Math.sin(lam);
      set.uz[i] = sinPhi;
      const inv = 1 / Math.sqrt(x * x + y * y + rZ * rZ);
      set.cx[i] = x * inv;
      set.cy[i] = y * inv;
      set.cz[i] = rZ * inv;
      set.latDeg[i] = latDeg;
      i++;
    }
  }
  return set;
}

export interface GapStats {
  maxGapSec: number;
  meanGapSec: number;
  /** Number of outage intervals observed across every point. */
  gapCount: number;
}

/**
 * Counts, per fixed point, how long the point stays below `fold` simultaneous
 * satellites. Intervals still open at the end of the window are included (a
 * 24 h window that never recovers is the worst case, not a missing sample).
 */
export function accumulateGaps(
  points: GapPointSet,
  sample: KernelSample,
  sampleAt: KernelSampler,
  opts: {
    minElevationRad: number;
    fold: number;
    timeSteps: number;
    windowSec: number;
  },
): GapStats {
  const timeSteps = Math.max(1, Math.floor(opts.timeSteps));
  const fold = Math.max(1, Math.floor(opts.fold));
  const stepSec = opts.windowSec / timeSteps;
  const sinEps = Math.sin(Math.max(0, opts.minElevationRad));
  const sinEpsSq = sinEps * sinEps;
  const satCount = sample.count;

  const runLength = new Int32Array(points.count);
  let maxGapSteps = 0;
  let gapCount = 0;
  let gapStepsTotal = 0;

  for (let k = 0; k < timeSteps; k++) {
    sampleAt(k, k * stepSec, sample);
    const pos = sample.positionsEcf;
    const subLat = sample.subLatRad;
    for (let i = 0; i < points.count; i++) {
      let count = 0;
      const pxi = points.px[i];
      const pyi = points.py[i];
      const pzi = points.pz[i];
      const uxi = points.ux[i];
      const uyi = points.uy[i];
      const uzi = points.uz[i];
      for (let s = 0; s < satCount; s++) {
        const psi = subLat[s];
        if (!(psi >= -1.5708 && psi <= 1.5708)) continue;
        const dx = pos[s * 3] - pxi;
        const dy = pos[s * 3 + 1] - pyi;
        const dz = pos[s * 3 + 2] - pzi;
        const dot = uxi * dx + uyi * dy + uzi * dz;
        if (dot <= 0) continue;
        if (dot * dot >= sinEpsSq * (dx * dx + dy * dy + dz * dz)) {
          count++;
          if (count >= fold) break;
        }
      }
      if (count >= fold) {
        if (runLength[i] > 0) {
          gapCount++;
          gapStepsTotal += runLength[i];
          if (runLength[i] > maxGapSteps) maxGapSteps = runLength[i];
          runLength[i] = 0;
        }
      } else {
        runLength[i]++;
      }
    }
  }

  for (let i = 0; i < points.count; i++) {
    if (runLength[i] > 0) {
      gapCount++;
      gapStepsTotal += runLength[i];
      if (runLength[i] > maxGapSteps) maxGapSteps = runLength[i];
    }
  }

  return {
    maxGapSec: maxGapSteps * stepSec,
    meanGapSec: gapCount > 0 ? (gapStepsTotal * stepSec) / gapCount : 0,
    gapCount,
  };
}
