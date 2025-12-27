/**
 * Type definitions for constellation configuration
 */

export interface ConstellationShell {
  id: string;                    // UUID for React keys
  name?: string;                 // Optional shell name
  count: number;                 // Total satellites (required)
  planes: number;                // Number of orbital planes (required)
  phasing?: number;              // Phasing between planes (default: 0)
  apogee_altitude?: number;      // Altitude in km (default: 0)
  eccentricity?: number;         // Orbital eccentricity (default: 0)
  inclination?: number;          // Inclination in degrees (default: 0)
  raan_start?: number;           // Starting RAAN in degrees (default: 0)
  raan_range?: number;           // RAAN range in degrees (default: 360)
  argp?: number;                 // Argument of perigee in degrees (default: 0)
  mean_anomaly_0?: number;       // Initial mean anomaly in degrees (default: 0)
}

export interface ConstellationConfig {
  name: string;
  epoch: Date;
  shells: ConstellationShell[];
}

export const DEFAULT_SHELL_VALUES: Omit<ConstellationShell, "id"> = {
  name: "",
  count: 1,
  planes: 1,
  phasing: 0,
  apogee_altitude: 500,
  eccentricity: 0,
  inclination: 0,
  raan_start: 0,
  raan_range: 360,
  argp: 0,
  mean_anomaly_0: 0,
};

export function createNewShell(): ConstellationShell {
  return {
    ...DEFAULT_SHELL_VALUES,
    id: crypto.randomUUID(),
  };
}

export function createDefaultConfig(): ConstellationConfig {
  return {
    name: "NewConstellation",
    epoch: new Date(),
    shells: [],
  };
}
