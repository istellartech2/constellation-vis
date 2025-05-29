import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from '../src/utils/tomlParse';
import { averageVisibility } from '../src/utils/visibility';
import type { SatelliteSpec } from '../src/data/satellites';

async function loadSatellites(): Promise<SatelliteSpec[]> {
  const satText = await Bun.file('public/satellites.toml').text();
  const base = parseSatellitesToml(satText);
  try {
    const constText = await Bun.file('public/constellation.toml').text();
    return [...base, ...parseConstellationToml(constText)];
  } catch {
    return base;
  }
}

async function main() {
  const sats = await loadSatellites();
  const gsText = await Bun.file('public/groundstations.toml').text();
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
