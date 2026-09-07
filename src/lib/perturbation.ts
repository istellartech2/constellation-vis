/**
 * Satellite orbital perturbation calculations based on J2, J3, and atmospheric drag.
 * Reference: docs/perturbation.md
 */

// Physical constants
const MU = 3.986004418e14; // Earth's gravitational parameter (m³/s²)
const RE = 6378137.0; // Earth's equatorial radius (m)
const J2 = 1.08263e-3; // Second zonal harmonic coefficient
const J3 = -2.532e-6; // Third zonal harmonic coefficient

// Conversion constants
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

export interface OrbitalElements {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
}

export interface PerturbationRates {
  // Semi-major axis decay rate (km/year)
  da_dt: number;
  // Eccentricity change rate (1/year)
  de_dt: number;
  // Inclination change rate (deg/year)
  di_dt: number;
  // RAAN drift rate (deg/year)
  dOmega_dt: number;
  // Argument of perigee drift rate (deg/year)
  domega_dt: number;
  // Mean anomaly drift rate (deg/day) - different unit for practical use
  dM_dt: number;
}

export interface DetailedPerturbationRates {
  j2: PerturbationRates;
  j3: PerturbationRates;
  drag: PerturbationRates;
  total: PerturbationRates;
}

export interface AtmosphereModelInput {
  model?: "exponential" | "harris-priester";
  referenceAltitudeKm?: number;
  scaleHeightKm?: number;
  referenceDensityKgPerM3?: number;
  densityMultiplier?: number;
  lowOrbitLimitKm?: number;
  f107?: number;
  ap?: number;
  diurnalBulgeFactor?: number;
}

const DEFAULT_ATMOSPHERE_MODEL: Required<AtmosphereModelInput> = {
  model: "exponential",
  referenceAltitudeKm: 400,
  scaleHeightKm: 60,
  referenceDensityKgPerM3: 1e-12,
  densityMultiplier: 1,
  lowOrbitLimitKm: 1000,
  f107: 150,
  ap: 15,
  diurnalBulgeFactor: 0.5,
};

const HP_DENSITY_TABLE: Array<{ altitudeKm: number; densityKgPerM3: number }> = [
  { altitudeKm: 150, densityKgPerM3: 2.07e-9 },
  { altitudeKm: 180, densityKgPerM3: 5.46e-10 },
  { altitudeKm: 200, densityKgPerM3: 2.79e-10 },
  { altitudeKm: 250, densityKgPerM3: 7.25e-11 },
  { altitudeKm: 300, densityKgPerM3: 2.42e-11 },
  { altitudeKm: 350, densityKgPerM3: 9.52e-12 },
  { altitudeKm: 400, densityKgPerM3: 4.07e-12 },
  { altitudeKm: 450, densityKgPerM3: 1.95e-12 },
  { altitudeKm: 500, densityKgPerM3: 9.91e-13 },
  { altitudeKm: 600, densityKgPerM3: 3.18e-13 },
  { altitudeKm: 700, densityKgPerM3: 1.39e-13 },
  { altitudeKm: 800, densityKgPerM3: 6.87e-14 },
  { altitudeKm: 900, densityKgPerM3: 3.95e-14 },
  { altitudeKm: 1000, densityKgPerM3: 2.42e-14 },
  { altitudeKm: 1200, densityKgPerM3: 8.43e-15 },
  { altitudeKm: 1500, densityKgPerM3: 2.05e-15 },
];

function normalizeAtmosphereModel(input?: AtmosphereModelInput): Required<AtmosphereModelInput> {
  return {
    model: input?.model ?? DEFAULT_ATMOSPHERE_MODEL.model,
    referenceAltitudeKm: input?.referenceAltitudeKm ?? DEFAULT_ATMOSPHERE_MODEL.referenceAltitudeKm,
    scaleHeightKm: Math.max(input?.scaleHeightKm ?? DEFAULT_ATMOSPHERE_MODEL.scaleHeightKm, 1),
    referenceDensityKgPerM3: Math.max(
      input?.referenceDensityKgPerM3 ?? DEFAULT_ATMOSPHERE_MODEL.referenceDensityKgPerM3,
      1e-18,
    ),
    densityMultiplier: Math.max(input?.densityMultiplier ?? DEFAULT_ATMOSPHERE_MODEL.densityMultiplier, 0),
    lowOrbitLimitKm: Math.max(input?.lowOrbitLimitKm ?? DEFAULT_ATMOSPHERE_MODEL.lowOrbitLimitKm, 100),
    f107: Math.max(input?.f107 ?? DEFAULT_ATMOSPHERE_MODEL.f107, 50),
    ap: Math.max(input?.ap ?? DEFAULT_ATMOSPHERE_MODEL.ap, 0),
    diurnalBulgeFactor: Math.max(input?.diurnalBulgeFactor ?? DEFAULT_ATMOSPHERE_MODEL.diurnalBulgeFactor, 0),
  };
}

/**
 * Index of the table interval bracketing `altitudeKm`, clamped to the first /
 * last interval outside the table so that both the density interpolation and
 * the scale-height derivation stay on a real log-linear segment.
 */
function hpIntervalIndex(altitudeKm: number): number {
  const lastIndex = HP_DENSITY_TABLE.length - 1;
  if (altitudeKm <= HP_DENSITY_TABLE[0].altitudeKm) return 1;
  if (altitudeKm >= HP_DENSITY_TABLE[lastIndex].altitudeKm) return lastIndex;
  return HP_DENSITY_TABLE.findIndex((entry) => entry.altitudeKm >= altitudeKm);
}

function interpolateLogDensity(altitudeKm: number): number {
  if (altitudeKm <= HP_DENSITY_TABLE[0].altitudeKm) return HP_DENSITY_TABLE[0].densityKgPerM3;
  const last = HP_DENSITY_TABLE[HP_DENSITY_TABLE.length - 1];
  if (altitudeKm >= last.altitudeKm) return last.densityKgPerM3;

  const upperIndex = hpIntervalIndex(altitudeKm);
  const lower = HP_DENSITY_TABLE[Math.max(upperIndex - 1, 0)];
  const upper = HP_DENSITY_TABLE[upperIndex];
  const ratio = (altitudeKm - lower.altitudeKm) / Math.max(upper.altitudeKm - lower.altitudeKm, 1);
  const logLower = Math.log(lower.densityKgPerM3);
  const logUpper = Math.log(upper.densityKgPerM3);
  return Math.exp(logLower + (logUpper - logLower) * ratio);
}

/**
 * Local density scale height H [km], i.e. -(d h / d ln rho). Needed by the
 * King-Hele de/dt term, which is the only place drag cares about the *shape*
 * of the density profile rather than its value.
 *
 * For the exponential model this is just `scaleHeightKm`. For Harris-Priester
 * it is read off the log-linear table segment around `altitudeKm`, which gives
 * ~30 km at 200 km rising to ~120 km at 700 km. Clamped to 1 km like
 * `normalizeAtmosphereModel` does, so a degenerate table segment can never
 * divide by zero.
 */
export function atmosphericScaleHeightKm(
  altitudeKm: number,
  atmosphereModel?: AtmosphereModelInput,
): number {
  const normalized = normalizeAtmosphereModel(atmosphereModel);
  if (normalized.model !== "harris-priester") return normalized.scaleHeightKm;

  const upperIndex = hpIntervalIndex(altitudeKm);
  const lower = HP_DENSITY_TABLE[upperIndex - 1];
  const upper = HP_DENSITY_TABLE[upperIndex];
  const logDrop = Math.log(lower.densityKgPerM3) - Math.log(upper.densityKgPerM3);
  return Math.max((upper.altitudeKm - lower.altitudeKm) / Math.max(logDrop, 1e-9), 1);
}

/**
 * Harris-Priester style density.
 *
 * The table is used as-is. It previously carried a `HP_BASE_SCALE = 0.0003`
 * factor, which existed only to offset the factor-of-v_rel error in the drag
 * rate (see `calculateDetailedPerturbationRates`); with that fixed, the factor
 * would make drag ~3300x too small, so it is gone.
 *
 * Caveat on absolute level: `HP_DENSITY_TABLE` is a single high-side curve
 * (roughly 2-3x above a nominal orbit-mean density across 400-700 km), and
 * `diurnalFactor` spans only 0.85-1.15, so it cannot represent the real
 * Harris-Priester swing between minimum- and maximum-density profiles. Drag
 * output is therefore conservative by a factor of ~2-3. Fixing that properly
 * means carrying the min/max table pair and interpolating with
 * `rho = rho_min + (rho_max - rho_min) * cos^n(psi/2)`; a blanket scale factor
 * is what got us here and is not the answer.
 */
function calculateHarrisPriesterDensity(altitudeKm: number, input: Required<AtmosphereModelInput>): number {
  const baseDensity = interpolateLogDensity(altitudeKm);
  const solarFactor = Math.max(0.35, 1 + 0.004 * (input.f107 - 150));
  const geomagneticFactor = 1 + 0.02 * Math.sqrt(input.ap);
  const diurnalFactor = 0.85 + 0.3 * input.diurnalBulgeFactor;
  return baseDensity * solarFactor * geomagneticFactor * diurnalFactor * input.densityMultiplier;
}

export function calculateAtmosphericDensity(
  altitudeKm: number,
  atmosphereModel?: AtmosphereModelInput,
): number {
  const normalized = normalizeAtmosphereModel(atmosphereModel);
  if (normalized.model === "harris-priester") {
    return calculateHarrisPriesterDensity(altitudeKm, normalized);
  }
  return normalized.referenceDensityKgPerM3
    * normalized.densityMultiplier
    * Math.exp(-(altitudeKm - normalized.referenceAltitudeKm) / normalized.scaleHeightKm);
}

/**
 * Calculate perturbation rates for a given set of orbital elements.
 * Returns detailed breakdown by perturbation source.
 */
export function calculateDetailedPerturbationRates(
  elements: OrbitalElements,
  ballisticCoefficient: number = 0.012,
  atmosphereModel?: AtmosphereModelInput,
): DetailedPerturbationRates {
  const a = elements.semiMajorAxisKm * 1000; // Convert to meters
  const e = elements.eccentricity;
  const i = elements.inclinationDeg * DEG_TO_RAD;
  
  // Mean motion (rad/s)
  const n = Math.sqrt(MU / (a * a * a));
  
  // Helper terms
  const beta = Math.pow(1 - e * e, 2);
  const gamma = Math.pow(1 - e * e, 3);
  const k2 = 1.5 * J2 * RE * RE;
  const k3 = 0.5 * J3 * RE * RE * RE;
  
  const sin_i = Math.sin(i);
  const cos_i = Math.cos(i);
  const sin_i_sq = sin_i * sin_i;
  
  // J2 perturbations (rad/s)
  const j2_dOmega_dt_rad = -k2 * n * cos_i / (a * a * beta);
  const j2_domega_dt_rad = k2 * n * (2 - 2.5 * sin_i_sq) / (a * a * beta);
  const j2_dM_dt_rad = n + k2 * n * (1 - 3 * sin_i_sq) / (2 * a * a * beta);
  
  // J3 perturbations (rad/s)
  const j3_dOmega_dt_rad = -k3 * n * sin_i / (a * a * a * gamma);
  const j3_domega_dt_rad = k3 * n * (4 - 5 * sin_i_sq) * sin_i / (2 * a * a * a * gamma);
  const j3_de_dt_rad = k3 * n * (1.5 * sin_i_sq - 1) * e / (a * a * a * gamma);
  const j3_di_dt_rad = k3 * n * cos_i / (2 * a * a * a * gamma);
  
  // Atmospheric drag (simplified model)
  let da_dt_m = 0;
  let de_dt_drag = 0;
  const normalizedAtmosphere = normalizeAtmosphereModel(atmosphereModel);

  // Only apply drag for low orbits
  const perigeeAltitude = a * (1 - e) - RE;
  if (perigeeAltitude < normalizedAtmosphere.lowOrbitLimitKm * 1000) {
    const hKm = perigeeAltitude / 1000;
    const rho = calculateAtmosphericDensity(hKm, normalizedAtmosphere);

    // Orbital velocity approximation
    const v_rel = Math.sqrt(MU / a);

    /**
     * Drag rate parameter F [1/s]. NOTE the single power of v_rel: F is a
     * *rate*, not the drag acceleration. With this definition `da/dt = -2aF`
     * reduces exactly to the textbook circular-orbit secular decay
     *   da/dt = -rho * B * sqrt(mu * a)
     * (derive by equating drag power to d/dt of -mu/2a).
     *
     * This used to read `0.5 * rho * v_rel * v_rel * B`, i.e. the drag
     * acceleration [m/s^2], which made `-2aF` come out a factor of v_rel
     * (~7.6e3) too large and dimensionally wrong. `HP_BASE_SCALE` in the
     * Harris-Priester path had been shrinking the density table by ~3300x to
     * partly hide it. See docs/perturbation.md section 3.
     */
    const F = 0.5 * rho * v_rel * ballisticCoefficient;

    // Secular rates due to drag
    da_dt_m = -2 * a * F;
    /**
     * King-Hele small-eccentricity limit: an exponential atmosphere drags
     * apogee down faster than perigee, so
     *   de/dt = (da/dt) * e / (2H)
     * with H the local density scale height. Zero for a circular orbit, and
     * linear in e for small e.
     *
     * This used to read `-F * (2 / Math.PI) * a * e`, whose `2/pi` sat where
     * `1/H` belongs — dimensionally a length^-1 short, and ~4e4 too large.
     */
    const scaleHeightM = atmosphericScaleHeightKm(hKm, normalizedAtmosphere) * 1000;
    de_dt_drag = da_dt_m * e / (2 * scaleHeightM);
  }
  
  // Convert to practical units and organize by source
  const j2: PerturbationRates = {
    da_dt: 0, // J2 doesn't affect semi-major axis
    de_dt: 0, // J2 doesn't affect eccentricity (first order)
    di_dt: 0, // J2 doesn't affect inclination (first order)
    dOmega_dt: j2_dOmega_dt_rad * RAD_TO_DEG * SECONDS_PER_YEAR,
    domega_dt: j2_domega_dt_rad * RAD_TO_DEG * SECONDS_PER_YEAR,
    dM_dt: j2_dM_dt_rad * RAD_TO_DEG * 86400,
  };
  
  const j3: PerturbationRates = {
    da_dt: 0, // J3 doesn't affect semi-major axis
    de_dt: j3_de_dt_rad * SECONDS_PER_YEAR,
    di_dt: j3_di_dt_rad * RAD_TO_DEG * SECONDS_PER_YEAR,
    dOmega_dt: j3_dOmega_dt_rad * RAD_TO_DEG * SECONDS_PER_YEAR,
    domega_dt: j3_domega_dt_rad * RAD_TO_DEG * SECONDS_PER_YEAR,
    dM_dt: 0, // J3 doesn't significantly affect mean motion
  };
  
  const drag: PerturbationRates = {
    da_dt: da_dt_m * SECONDS_PER_YEAR / 1000,
    de_dt: de_dt_drag * SECONDS_PER_YEAR,
    di_dt: 0, // Drag doesn't affect inclination
    dOmega_dt: 0, // Drag doesn't affect RAAN
    domega_dt: 0, // Drag doesn't affect argument of perigee
    dM_dt: 0, // Drag effect on mean motion is included in semi-major axis change
  };
  
  const total: PerturbationRates = {
    da_dt: j2.da_dt + j3.da_dt + drag.da_dt,
    de_dt: j2.de_dt + j3.de_dt + drag.de_dt,
    di_dt: j2.di_dt + j3.di_dt + drag.di_dt,
    dOmega_dt: j2.dOmega_dt + j3.dOmega_dt + drag.dOmega_dt,
    domega_dt: j2.domega_dt + j3.domega_dt + drag.domega_dt,
    dM_dt: j2.dM_dt + j3.dM_dt + drag.dM_dt,
  };
  
  return { j2, j3, drag, total };
}

/**
 * Format perturbation rates for display with appropriate precision.
 */
export function formatPerturbationRates(rates: PerturbationRates): string[] {
  return [
    `da/dt: ${rates.da_dt.toFixed(3)} km/year`,
    `de/dt: ${rates.de_dt.toExponential(2)} /year`,
    `di/dt: ${rates.di_dt.toFixed(4)} deg/year`,
    `dΩ/dt: ${rates.dOmega_dt.toFixed(2)} deg/year`,
    `dω/dt: ${rates.domega_dt.toFixed(2)} deg/year`,
    `dM/dt: ${rates.dM_dt.toFixed(3)} deg/day`,
  ];
}

/**
 * Format J2 perturbation rates with deg/day units for KaTeX display.
 */
export function formatJ2PerturbationRates(rates: PerturbationRates): Array<{latex: string, value: string}> {
  const DAYS_PER_YEAR = 365.25;
  const results = [
    {
      latex: "d\\Omega/dt",
      value: `${(rates.dOmega_dt / DAYS_PER_YEAR).toFixed(2)} deg/day`,
      numValue: rates.dOmega_dt
    },
    {
      latex: "d\\omega/dt",
      value: `${(rates.domega_dt / DAYS_PER_YEAR).toFixed(2)} deg/day`,
      numValue: rates.domega_dt
    },
  ];
  
  return results
    .filter(item => Math.abs(item.numValue) > 1e-10)
    .map(item => ({ latex: item.latex, value: item.value }));
}

/**
 * Format J3 perturbation rates with deg/year units for KaTeX display.
 */
export function formatJ3PerturbationRates(rates: PerturbationRates): Array<{latex: string, value: string}> {
  const results = [
    {
      latex: "de/dt",
      value: `${rates.de_dt.toExponential(2)} /year`,
      numValue: rates.de_dt
    },
    {
      latex: "di/dt",
      value: `${rates.di_dt.toFixed(2)} deg/year`,
      numValue: rates.di_dt
    },
    {
      latex: "d\\Omega/dt",
      value: `${rates.dOmega_dt.toFixed(2)} deg/year`,
      numValue: rates.dOmega_dt
    },
    {
      latex: "d\\omega/dt",
      value: `${rates.domega_dt.toFixed(2)} deg/year`,
      numValue: rates.domega_dt
    },
  ];
  
  return results
    .filter(item => Math.abs(item.numValue) > 1e-10)
    .map(item => ({ latex: item.latex, value: item.value }));
}

/**
 * Format drag perturbation rates with km/day for da/dt.
 */
export function formatDragPerturbationRates(rates: PerturbationRates): string[] {
  const DAYS_PER_YEAR = 365.25;
  if (Math.abs(rates.da_dt) < 1e-10) return [];
  return [
    `da/dt: ${(rates.da_dt / DAYS_PER_YEAR).toFixed(6)} km/day`,
  ];
}

/**
 * Legacy function for compatibility - returns total rates.
 */
export function calculatePerturbationRates(
  elements: OrbitalElements,
  ballisticCoefficient: number = 0.012,
  atmosphereModel?: AtmosphereModelInput,
): PerturbationRates {
  return calculateDetailedPerturbationRates(elements, ballisticCoefficient, atmosphereModel).total;
}
