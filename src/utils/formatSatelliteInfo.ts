import type { SatelliteSpec } from "../data/satellites";

export function formatSatelliteInfo(satellites: SatelliteSpec[], idx: number | null): string {
  if (idx === null) return "";
  const spec = satellites[idx];
  if (!spec) return "";
  if (spec.type === "tle") {
    return spec.lines.join("\n");
  }
  const e = spec.elements;
  return (
    `satnum: ${e.satnum}\n` +
    `a: ${e.semiMajorAxisKm} km\n` +
    `e: ${e.eccentricity}\n` +
    `i: ${e.inclinationDeg} deg\n` +
    `RAAN: ${e.raanDeg} deg\n` +
    `argP: ${e.argPerigeeDeg} deg\n` +
    `M: ${e.meanAnomalyDeg} deg`
  );
}
