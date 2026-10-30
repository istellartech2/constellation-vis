import { sunVectorECI } from "./astronomy";
import { j2SecularRates } from "./j2Propagator";
import { createCatalog, setCatalogRow, type SatelliteCatalog } from "./satelliteCatalog";

/**
 * Synthetic catalogs for load testing and "what would it look like" views.
 * None of these satellites exist; every set carries an id range (8xx/7xx
 * million) that can never collide with NORAD numbers.
 */

const MU_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;
const DEG = Math.PI / 180;
/** Mean Sun motion in right ascension, rad/min (one tropical year per revolution). */
const SUN_RATE_RAD_MIN = (2 * Math.PI) / (365.2422 * 1440);

export type SyntheticPreset = "starmind" | "walker-mix";

export interface SyntheticPresetInfo {
  id: SyntheticPreset;
  label: string;
  /** One line shown under the option. */
  summary: string;
  /** Satellite id base (9 digits). */
  satnumBase: number;
}

export const SYNTHETIC_PRESETS: readonly SyntheticPresetInfo[] = [
  {
    id: "starmind",
    label: "SpaceX Starmind 推定",
    summary: "軌道AIデータセンター構想（FCC申請 最大100万機）。ドーン・ダスク太陽同期 500–2,000 km、50 km 刻みのシェル",
    satnumBase: 700_000_000,
  },
  {
    id: "walker-mix",
    label: "汎用 Walker 混合",
    summary: "53°/70°/97.6°/87.9°/40° の6シェルを全周に均等配置する負荷試験用セット",
    satnumBase: 800_000_000,
  },
];

export const SYNTHETIC_COUNTS = [10_000, 100_000, 1_000_000] as const;

/** Mean motion (rev/day) of a circular orbit at `altKm`, using the μ `catalogFromSpecs` uses. */
function meanMotionRevDay(altKm: number): number {
  const a = EARTH_RADIUS_KM + altKm;
  return (Math.sqrt(MU_KM3_S2 / a ** 3) * 86400) / (2 * Math.PI);
}

/**
 * Sun-synchronous inclination (deg) for a circular orbit at `altKm`, solved
 * against the same SGP4 secular node rate the GPU J2 layer applies, so the
 * drawn planes stay locked to the Sun over long simulated spans.
 */
export function sunSynchronousInclinationDeg(altKm: number): number {
  const n = (meanMotionRevDay(altKm) * 2 * Math.PI) / 1440;
  // raanDot grows monotonically from negative (prograde) to positive past 90°.
  let lo = 90 * DEG;
  let hi = 180 * DEG;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (j2SecularRates(n, 0, mid).raanDot < SUN_RATE_RAD_MIN) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) / DEG;
}

/** Right ascension of the Sun (deg, 0–360) at `epochMs`. */
export function sunRightAscensionDeg(epochMs: number): number {
  const s = sunVectorECI(new Date(epochMs));
  return ((Math.atan2(s.y, s.x) / DEG) % 360 + 360) % 360;
}

/**
 * Starmind estimate, from public reporting only (see docs/synthetic-catalogs.md):
 * - FCC filing (SAT-LOA-20260108-00016, Jan 2026): up to 1,000,000 satellites,
 *   500–2,000 km, narrow shells of up to 50 km, sun-synchronous inclinations.
 * - "remain constantly in the sunlight" → dawn–dusk (terminator) SSO, LTAN 18:00.
 * Assumed here (not published): one shell every 50 km from 500 to 2,000 km with
 * equal shares, planes spread ±STARMIND_RAAN_SPREAD_DEG around the terminator,
 * Walker-style phasing within a shell.
 */
export const STARMIND_SHELL_ALTITUDES_KM = Array.from({ length: 31 }, (_, k) => 500 + 50 * k);
export const STARMIND_LTAN_HOURS = 18;
export const STARMIND_RAAN_SPREAD_DEG = 8;

function starmindCatalog(count: number, epochMs: number, satnumBase: number): SatelliteCatalog {
  const cat = createCatalog(count);
  // LTAN 18:00 → ascending node 6 h (90°) east of the mean Sun.
  const raanCenter = sunRightAscensionDeg(epochMs) + (STARMIND_LTAN_HOURS - 12) * 15;
  const shells = STARMIND_SHELL_ALTITUDES_KM;
  let row = 0;
  shells.forEach((altKm, s) => {
    const n = Math.floor(count / shells.length) + (s < count % shells.length ? 1 : 0);
    if (n <= 0) return;
    const inclinationDeg = sunSynchronousInclinationDeg(altKm);
    const mm = meanMotionRevDay(altKm);
    const planes = Math.max(1, Math.round(Math.sqrt(n / 4)));
    const perPlane = Math.ceil(n / planes);
    for (let k = 0; k < n; k++) {
      const p = Math.floor(k / perPlane);
      const j = k % perPlane;
      const t = planes === 1 ? 0 : p / (planes - 1) - 0.5;
      setCatalogRow(cat, row, {
        satnum: satnumBase + row,
        epochMs,
        meanMotionRevDay: mm,
        eccentricity: 0.0001,
        inclinationDeg,
        raanDeg: (((raanCenter + 2 * STARMIND_RAAN_SPREAD_DEG * t) % 360) + 360) % 360,
        argPerigeeDeg: 0,
        // Offset neighbouring planes and shells so slots do not line up at the poles.
        meanAnomalyDeg: ((360 * j) / perPlane + (360 * p) / (planes * perPlane) + s * 7.3) % 360,
      });
      row++;
    }
  });
  return cat;
}

/** Small deterministic PRNG so synthetic catalogs are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALKER_SHELLS = [
  { altKm: 340, incDeg: 53, share: 0.2 },
  { altKm: 550, incDeg: 53, share: 0.25 },
  { altKm: 570, incDeg: 70, share: 0.15 },
  { altKm: 560, incDeg: 97.6, share: 0.15 },
  { altKm: 1100, incDeg: 87.9, share: 0.15 },
  { altKm: 1200, incDeg: 40, share: 0.1 },
];

/** Walker-like mix spread over the full 360° of RAAN, no names (names dominate memory at 10^6). */
function walkerMixCatalog(count: number, epochMs: number, satnumBase: number, seed = 1): SatelliteCatalog {
  const cat = createCatalog(count);
  const rand = mulberry32(seed);
  let row = 0;
  WALKER_SHELLS.forEach((shell, s) => {
    const n = s === WALKER_SHELLS.length - 1 ? count - row : Math.round(count * shell.share);
    if (n <= 0) return;
    const planes = Math.max(1, Math.round(Math.sqrt(n / 2)));
    const perPlane = Math.ceil(n / planes);
    const mm = meanMotionRevDay(shell.altKm);
    for (let k = 0; k < n && row < count; k++) {
      const p = Math.floor(k / perPlane);
      const j = k % perPlane;
      setCatalogRow(cat, row, {
        satnum: satnumBase + row,
        epochMs,
        meanMotionRevDay: mm,
        eccentricity: 0.0001 + rand() * 0.0009,
        inclinationDeg: shell.incDeg,
        raanDeg: (360 * p) / planes,
        argPerigeeDeg: 0,
        meanAnomalyDeg: ((360 * j) / perPlane + (360 * p) / (planes * perPlane) + rand() * 0.5) % 360,
      });
      row++;
    }
  });
  return cat;
}

export function syntheticCatalog(preset: SyntheticPreset, count: number, epochMs: number): SatelliteCatalog {
  const info = SYNTHETIC_PRESETS.find((p) => p.id === preset) ?? SYNTHETIC_PRESETS[1];
  return info.id === "starmind"
    ? starmindCatalog(count, epochMs, info.satnumBase)
    : walkerMixCatalog(count, epochMs, info.satnumBase);
}
