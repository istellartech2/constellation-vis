import * as satellite from "satellite.js";
import type { SatelliteSpec } from "./satellites";

/**
 * Build a human readable block of text describing the satellite at the
 * provided index. Returns an empty string when no satellite is selected.
 */

export function formatSatelliteInfo(
  satellites: SatelliteSpec[],
  idx: number | null,
): string {
  if (idx === null) return "";
  const spec = satellites[idx];
  if (!spec) return "";

  const meta = spec.meta;
  let metaText = "";
  if (meta) {
    if (meta.objectName) metaText += `OBJECT_NAME: ${meta.objectName}\n`;
    if (meta.objectId) metaText += `OBJECT_ID: ${meta.objectId}\n`;
    if (meta.noradCatId !== undefined)
      metaText += `NORAD_CAT_ID: ${meta.noradCatId}\n`;
  }

  const EARTH_RADIUS_KM = 6378.137;

  const e = (() => {
    if (spec.type === "elements") {
      return spec.elements;
    }
    const rec = satellite.twoline2satrec(spec.lines[0], spec.lines[1]);
    return {
      satnum: Number(rec.satnum),
      semiMajorAxisKm: rec.a * EARTH_RADIUS_KM,
      eccentricity: rec.ecco,
      inclinationDeg: satellite.radiansToDegrees(rec.inclo),
      raanDeg: satellite.radiansToDegrees(rec.nodeo),
      argPerigeeDeg: satellite.radiansToDegrees(rec.argpo),
      meanAnomalyDeg: satellite.radiansToDegrees(rec.mo),
    };
  })();

  return (
    metaText +
    `satnum: ${e.satnum}\n` +
    `a: ${e.semiMajorAxisKm.toFixed(1)} km\n` +
    `e: ${e.eccentricity}\n` +
    `i: ${e.inclinationDeg.toFixed(1)} deg\n` +
    `RAAN: ${e.raanDeg.toFixed(1)} deg\n` +
    `argP: ${e.argPerigeeDeg.toFixed(1)} deg\n` +
    `M: ${e.meanAnomalyDeg.toFixed(1)} deg`
  );
}
