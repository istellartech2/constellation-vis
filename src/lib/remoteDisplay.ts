import type { DisplaySettings } from "./viewState";

/** Scalar rendering settings; camera framing and ISL configuration stay local. */
export type RemoteDisplaySettings = Partial<Omit<DisplaySettings, "isl">>;
const booleans = new Set([
  "showGraticule", "showEcliptic", "showGeoOrbit", "showSunDirection", "ecef",
  "showPerturbation", "showDerivedSatelliteInfo", "brightEarth", "whiteBackground",
  "showGroundStationCones", "showSatelliteFovCones",
]);
const colors = new Set(["groundConeColor", "fovConeColor", "satelliteVisibleColor", "satelliteHiddenColor", "satelliteSelectedColor"]);
const ranges: Record<string, readonly [number, number]> = {
  satRadius: [0.01, 0.05], groundConeMinElevationDeg: [0, 85], groundConeDistanceKm: [100, 20000],
  fovConeHalfAngleDeg: [1, 80], fovConeAlongTrackDeg: [-60, 60], fovConeCrossTrackDeg: [-60, 60],
  speedExp: [0, Math.log10(600)],
};
const textures = new Set(["./assets/earth01.webp", "./assets/earth02.webp", "blue-marble", "high-resolution"]);

export function validateRemoteDisplay(value: unknown): RemoteDisplaySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("display must be an object");
  for (const [key, v] of Object.entries(value)) {
    if (booleans.has(key)) {
      if (typeof v !== "boolean") throw new Error(`${key} must be boolean`);
    } else if (colors.has(key)) {
      if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${key} requires #RRGGBB`);
    } else if (Object.hasOwn(ranges, key)) {
      const [min, max] = ranges[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be ${min}–${max}`);
    } else if (key === "earthTexture") {
      if (typeof v !== "string" || !textures.has(v)) throw new Error("Unknown earthTexture");
    } else throw new Error(`Unknown display field: ${key}`);
  }
  return { ...value } as RemoteDisplaySettings;
}

export function remoteDisplaySnapshot(display: DisplaySettings): RemoteDisplaySettings {
  const { isl: _isl, ...scalar } = display;
  void _isl;
  return validateRemoteDisplay(scalar);
}
