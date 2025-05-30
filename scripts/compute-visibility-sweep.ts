/**
 * Script to sweep visibility statistics for different constellation shell parameters.
 * Computes every combination of parameter values and prints the average visibility,
 * median, and non-zero rate for each.
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

  const sweeps: Record<keyof Omit<ShellParams, 'name'>, number[]> = {
    count: [10, 20, 30, 40, 50],
    planes: [1, 2, 4, 6],
    phasing: [0, 90, 180, 270],
    apogee_altitude: [300, 500, 700, 1000],
    eccentricity: [0, 0.1, 0.2],
    inclination: [30, 45, 60, 90],
    raan_range: [180, 360],
  };

  const params = Object.keys(sweeps) as Array<keyof Omit<ShellParams, 'name'>>;

  function generateCombos(index: number, current: Partial<ShellParams>, out: ShellParams[]) {
    if (index === params.length) {
      const name = params.map((p) => `${p}=${(current[p] ?? defaults[p]) as number}`).join('_');
      out.push({ ...defaults, ...current, name } as ShellParams);
      return;
    }
    const key = params[index];
    for (const v of sweeps[key]) {
      generateCombos(index + 1, { ...current, [key]: v }, out);
    }
  }

  const combos: ShellParams[] = [];
  generateCombos(0, {}, combos);

  for (const shell of combos) {
    const result: { name: string; avg: number; median: number; nonZeroRate: number } = await new Promise((resolve, reject) => {
      const worker = new Worker(workerModule, { type: 'module' });
      worker.onmessage = (e) => {
        resolve(e.data);
        worker.terminate();
      };
      worker.onerror = (e) => {
        reject(e.error ?? new Error(e.message));
        worker.terminate();
      };
      worker.postMessage({ shell, epoch, startMs: start.getTime(), durationHours, stepSec, station });
    });
    const { name, avg, median, nonZeroRate } = result;
    console.log(
      `${name}: avg=${avg.toFixed(2)}, median=${median.toFixed(2)}, nonZero=${(
        nonZeroRate * 100
      ).toFixed(1)}%`,
    );
  }
}

// Run script
main().catch((e) => {
  console.error(e);
  process.exit(1);
});