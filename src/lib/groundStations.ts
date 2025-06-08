import { parseGroundStationsToml, type GroundStation } from '../utils/tomlParse';

// Helper used by the demo to fetch and parse the bundled ground station list.

export async function loadGroundStations(): Promise<GroundStation[]> {
  try {
    const resp = await fetch(import.meta.env.BASE_URL + 'groundstations.toml');
    
    if (!resp.ok) {
      throw new Error(`Failed to fetch ground stations: ${resp.status} ${resp.statusText}`);
    }
    
    const text = await resp.text();
    return parseGroundStationsToml(text);
  } catch (error) {
    console.error('Error loading ground stations:', error);
    // Return empty array as fallback to prevent app crash
    return [];
  }
}

export type { GroundStation };
