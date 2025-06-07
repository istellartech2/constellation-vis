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

/**
 * Calculate perturbation rates for a given set of orbital elements.
 * Returns detailed breakdown by perturbation source.
 */
export function calculateDetailedPerturbationRates(
  elements: OrbitalElements,
  ballisticCoefficient: number = 0.012 // CdA/m in m²/kg
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
  
  // Only apply drag for low orbits
  const perigeeAltitude = a * (1 - e) - RE;
  if (perigeeAltitude < 1000000) { // Below 1000 km
    // Simple exponential atmosphere model
    const h0 = 400000; // Reference altitude (400 km)
    const H = 60000; // Scale height (60 km)
    const rho0 = 1e-12; // Reference density (kg/m³)
    
    const h = perigeeAltitude;
    const rho = rho0 * Math.exp(-(h - h0) / H);
    
    // Orbital velocity approximation
    const v_rel = Math.sqrt(MU / a);
    
    // Drag force parameter
    const F = 0.5 * rho * v_rel * v_rel * ballisticCoefficient;
    
    // Secular rates due to drag
    da_dt_m = -2 * a * F;
    de_dt_drag = -F * (2 / Math.PI) * a * e;
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
  ballisticCoefficient: number = 0.012
): PerturbationRates {
  return calculateDetailedPerturbationRates(elements, ballisticCoefficient).total;
}