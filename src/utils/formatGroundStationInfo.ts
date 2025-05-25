import type { GroundStation } from '../data/groundStations';

/**
 * Build a human readable block of text describing the ground station at the
 * provided index. Returns an empty string when no station is selected.
 */
export function formatGroundStationInfo(stations: GroundStation[], idx: number | null): string {
  if (idx === null) return '';
  const gs = stations[idx];
  if (!gs) return '';
  return (
    `name: ${gs.name}\n` +
    `lat: ${gs.latitudeDeg} deg\n` +
    `lon: ${gs.longitudeDeg} deg\n` +
    `height: ${gs.heightKm} km\n` +
    `minEl: ${gs.minElevationDeg} deg`
  );
}
