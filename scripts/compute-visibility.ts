import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from '../src/utils/tomlParse';
import { averageVisibility } from '../src/utils/visibility';
import type { SatelliteSpec } from '../src/data/satellites';

const args = process.argv.slice(2);
const isCustom = args.length === 2;
const constellationFilePath = isCustom ? args[0] : 'public/constellation.toml';
const groundstationsFilePath = isCustom ? args[1] : 'public/groundstations.toml';

async function loadSatellites(): Promise<SatelliteSpec[]> {
  const satText = await Bun.file('public/satellites.toml').text();
  const base = parseSatellitesToml(satText);
  try {
    const constText = await Bun.file(constellationFilePath).text();
    return [...base, ...parseConstellationToml(constText)];
  } catch {
    return base;
  }
}

async function main() {
  const sats = await loadSatellites();
  const gsText = await Bun.file(groundstationsFilePath).text();
  const stations = parseGroundStationsToml(gsText);
  const station = stations[0];
  if (!station) throw new Error('No ground stations defined');
  const start = new Date();
  const avg = averageVisibility(sats, station, start, 12, 60);
  console.log(`Average visible satellites for ${station.name}: ${avg.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
