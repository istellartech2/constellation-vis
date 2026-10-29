import { normalizeEarthTextureMode } from "./earthTextures";
import type { DisplaySettings } from "./viewState";

/** Scalar rendering settings; camera framing and ISL configuration stay local. */
export type RemoteDisplaySettings = Partial<Omit<DisplaySettings, "isl">>;
const booleans = new Set([
  "showCountryBorders", "showClouds", "showGraticule", "showEcliptic", "showGeoOrbit", "showSunDirection", "ecef",
  "showPerturbation", "brightEarth", "whiteBackground",
  "showGroundStationCones", "showSatelliteFovCones",
]);
/** Retired fields still accepted (and dropped) so older clients keep working. */
const legacyBooleans = new Set(["showDerivedSatelliteInfo"]);
const colors = new Set(["groundConeColor", "fovConeColor", "satelliteVisibleColor", "satelliteHiddenColor", "satelliteSelectedColor"]);
const ranges: Record<string, readonly [number, number]> = {
  satRadius: [0.01, 0.05], groundConeMinElevationDeg: [0, 85], groundConeDistanceKm: [100, 20000],
  fovConeHalfAngleDeg: [1, 80], fovConeAlongTrackDeg: [-60, 60], fovConeCrossTrackDeg: [-60, 60],
  speedExp: [0, Math.log10(600)],
};

export function validateRemoteDisplay(value: unknown): RemoteDisplaySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("display must be an object");
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (legacyBooleans.has(key)) {
      if (typeof v !== "boolean") throw new Error(`${key} must be boolean`);
      continue;
    }
    result[key] = v;
    if (key === "earthTexture") {
      // Old image-path values are still accepted and rewritten to the mode id.
      const mode = normalizeEarthTextureMode(v);
      if (!mode) throw new Error("Unknown earthTexture");
      result[key] = mode;
      continue;
    }
    if (booleans.has(key)) {
      if (typeof v !== "boolean") throw new Error(`${key} must be boolean`);
    } else if (colors.has(key)) {
      if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${key} requires #RRGGBB`);
    } else if (Object.hasOwn(ranges, key)) {
      const [min, max] = ranges[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be ${min}–${max}`);
    } else throw new Error(`Unknown display field: ${key}`);
  }
  return result as RemoteDisplaySettings;
}

export function remoteDisplaySnapshot(display: DisplaySettings): RemoteDisplaySettings {
  const { isl: _isl, ...scalar } = display;
  void _isl;
  return validateRemoteDisplay(scalar);
}
