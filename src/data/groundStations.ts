import { parseGroundStationsToml, type GroundStation } from '../utils/tomlParse';

export async function loadGroundStations(): Promise<GroundStation[]> {
  const resp = await fetch('/groundstations.toml');
  const text = await resp.text();
  return parseGroundStationsToml(text);
}

export type { GroundStation };
