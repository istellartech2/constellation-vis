/**
 * Parameters for a single shell in the constellation.
 */
export type ShellParams = {
  name: string;
  count: number;
  planes: number;
  phasing: number;
  apogee_altitude: number;
  eccentricity: number;
  inclination: number;
  raan_range: number;
  raan_start?: number;
  argp?: number;
  mean_anomaly_0?: number;
};

/**
 * Generates a TOML string for the constellation using the given shell parameters.
 *
 * @param shell - Settings for a single [[constellation.shells]] block.
 * @param epoch  - Optional ISO timestamp to use instead of current time.
 * @returns      TOML-formatted constellation configuration.
 */
export function generateConstellationToml(shell: ShellParams, epoch?: string): string {
  const ts = epoch ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push('[constellation]');
  lines.push(`epoch = ${ts}`);
  lines.push('');
  lines.push('[[constellation.shells]]');
  lines.push(`name = "${shell.name}"`);
  lines.push(`count = ${shell.count}`);
  lines.push(`planes = ${shell.planes}`);
  lines.push(`phasing = ${shell.phasing}`);
  lines.push(`apogee_altitude = ${shell.apogee_altitude}`);
  lines.push(`eccentricity = ${shell.eccentricity}`);
  lines.push(`inclination = ${shell.inclination}`);
  lines.push(`raan_range = ${shell.raan_range}`);
  if (shell.raan_start !== undefined) lines.push(`raan_start = ${shell.raan_start}`);
  if (shell.argp !== undefined) lines.push(`argp = ${shell.argp}`);
  if (shell.mean_anomaly_0 !== undefined) {
    lines.push(`mean_anomaly_0 = ${shell.mean_anomaly_0}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 8 || args.length > 11) {
    console.error(
      'Usage: bun run scripts/generate-constellation.ts ' +
        'name count planes phasing apogee_altitude eccentricity inclination raan_range [raan_start] [argp] [mean_anomaly_0]',
    );
    process.exit(1);
  }
  const [
    name,
    countStr,
    planesStr,
    phasingStr,
    apogeeAltitudeStr,
    eccentricityStr,
    inclinationStr,
    raanRangeStr,
    raanStartStr,
    argpStr,
    meanAnomalyStr,
  ] = args;
  const shell: ShellParams = {
    name,
    count: Number(countStr),
    planes: Number(planesStr),
    phasing: Number(phasingStr),
    apogee_altitude: Number(apogeeAltitudeStr),
    eccentricity: Number(eccentricityStr),
    inclination: Number(inclinationStr),
    raan_range: Number(raanRangeStr),
  };
  if (raanStartStr !== undefined) shell.raan_start = Number(raanStartStr);
  if (argpStr !== undefined) shell.argp = Number(argpStr);
  if (meanAnomalyStr !== undefined) shell.mean_anomaly_0 = Number(meanAnomalyStr);

  const toml = generateConstellationToml(shell);
  await Bun.write('scripts/constellation.toml', toml);
  console.log('Wrote scripts/constellation.toml');
}

if (import.meta.main) {
  await main();
}