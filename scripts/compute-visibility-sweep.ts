/**
 * Script to sweep average visibility for different constellation shell parameters.
 * Defines arrays of values for each ShellParams field and computes the averageVisibility
 * for each value while keeping other parameters at defaults.
 */
import type { ShellParams } from './generate-constellation';
import { parseGroundStationsToml } from '../src/utils/tomlParse';
const workerModule = new URL('./worker-visibility.ts', import.meta.url);

async function main() {
  const gsText = await Bun.file('public/groundstations.toml').text();
  const stations = parseGroundStationsToml(gsText);
  if (stations.length === 0) {
    console.error('No ground stations defined in public/groundstations.toml');
    process.exit(1);
  }
  const station = stations[0];

  const start = new Date();
  const epoch = start.toISOString();
  const durationHours = 12;
  const stepSec = 60;

  const defaults: ShellParams = {
    name: 'default',
    count: 30,
    planes: 6,
    phasing: 0,
    apogee_altitude: 550,
    eccentricity: 0,
    inclination: 53,
    raan_range: 360,
  };

  const sweeps: Array<{ param: keyof Omit<ShellParams, 'name'>; values: number[] }> = [
    { param: 'count', values: [10, 20, 30, 40, 50] },
    { param: 'planes', values: [1, 2, 4, 6] },
    { param: 'phasing', values: [0, 90, 180, 270] },
    { param: 'apogee_altitude', values: [300, 500, 700, 1000] },
    { param: 'eccentricity', values: [0, 0.1, 0.2] },
    { param: 'inclination', values: [30, 45, 60, 90] },
    { param: 'raan_range', values: [180, 360] },
  ];

  for (const { param, values } of sweeps) {
    console.log(`\nSweeping parameter: ${param}`);
    const promises: Promise<{ name: string; avg: number }>[] = values.map((v) => {
      const shell: ShellParams = { ...defaults, [param]: v, name: `${param}=${v}` } as ShellParams;
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerModule, { type: 'module' });
        worker.onmessage = (e) => {
          resolve(e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          // Propagate worker errors with message if no Error object is provided
          reject(e.error ?? new Error(e.message));
          worker.terminate();
        };
        worker.postMessage({ shell, epoch, startMs: start.getTime(), durationHours, stepSec, station });
      });
    });
    // Await all worker promises and print results once ready
    const results = await Promise.all(promises);
    for (const { name, avg } of results) {
      console.log(`  ${name}: ${avg.toFixed(2)}`);
    }
  }
}

// Run script
main().catch((e) => {
  console.error(e);
  process.exit(1);
});