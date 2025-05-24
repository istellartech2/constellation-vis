import type { SatelliteSpec } from "../data/satellites";

/**
 * Build a human readable block of text describing the satellite at the
 * provided index. Returns an empty string when no satellite is selected.
 */

export function formatSatelliteInfo(satellites: SatelliteSpec[], idx: number | null): string {
  if (idx === null) return "";
  const spec = satellites[idx];
  if (!spec) return "";
  const meta = spec.meta;
  let metaText = "";
  if (meta) {
    if (meta.objectName) metaText += `OBJECT_NAME: ${meta.objectName}\n`;
    if (meta.objectId) metaText += `OBJECT_ID: ${meta.objectId}\n`;
    if (meta.noradCatId !== undefined) metaText += `NORAD_CAT_ID: ${meta.noradCatId}\n`;
  }
  if (spec.type === "tle") {
    return metaText + spec.lines.join("\n");
  }
  const e = spec.elements;
  return (
    metaText +
    `satnum: ${e.satnum}\n` +
    `a: ${e.semiMajorAxisKm} km\n` +
    `e: ${e.eccentricity}\n` +
    `i: ${e.inclinationDeg} deg\n` +
    `RAAN: ${e.raanDeg} deg\n` +
    `argP: ${e.argPerigeeDeg} deg\n` +
    `M: ${e.meanAnomalyDeg} deg`
  );
}
