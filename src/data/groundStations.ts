import { parseGroundStationsToml, type GroundStation } from '../utils/tomlParse';

// Helper used by the demo to fetch and parse the bundled ground station list.

export async function loadGroundStations(): Promise<GroundStation[]> {
  const resp = await fetch(import.meta.env.BASE_URL + 'groundstations.toml');
  const text = await resp.text();
  return parseGroundStationsToml(text);
}

export type { GroundStation };
