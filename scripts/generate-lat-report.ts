import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  parseSatellitesToml,
  parseConstellationToml,
} from '../src/utils/tomlParse';
import { parseConfigBundle } from '../src/utils/configBundle';
import { generateVisibilityReport } from '../src/lib/visibility';

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  const args = process.argv.slice(2);
  let minElDeg: number | undefined = args[0] ? Number(args[0]) : undefined;
  let settingsPath: string | undefined = args[1];

  if (minElDeg === undefined || Number.isNaN(minElDeg)) {
    const ans = await ask('Minimum elevation angle (deg): ');
    const num = Number(ans);
    minElDeg = Number.isNaN(num) ? 10 : num;
  }

  if (!settingsPath) {
    const ans = await ask('Path to settings.toml (leave blank for defaults): ');
    settingsPath = ans || undefined;
  }

  let sats;
  if (settingsPath) {
    const bundle = await Bun.file(settingsPath).text();
    sats = parseConfigBundle(bundle).satellites;
  } else {
    const satText = await Bun.file('public/satellites.toml').text();
    sats = parseSatellitesToml(satText);
    try {
      const constText = await Bun.file('public/constellation.toml').text();
      sats.push(...parseConstellationToml(constText));
    } catch {
      /* optional constellation */
    }
  }

  const stations = [];
  for (let lat = 0; lat <= 90; lat += 1) {
    stations.push({
      name: `Lat${lat}`,
      latitudeDeg: lat,
      longitudeDeg: 0,
      heightKm: 0,
      minElevationDeg: minElDeg,
    });
  }

  const start = new Date();
  const csv = generateVisibilityReport(sats, stations, start, 24, 60);
  await Bun.write('lat_visibility_report.csv', csv);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
