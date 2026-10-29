import { describe, expect, it } from "bun:test";
import { buildConfigBundle, parseConfigBundle } from "../src/lib/config";

const satelliteToml = `[[satellites]]
type = "elements"
satnum = 90000
epoch = "2026-10-29T00:00:00Z"
semiMajorAxisKm = 7378.137
eccentricity = 0
inclinationDeg = 50
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0
`;

describe("settings file import", () => {
  it("rejects standalone satellite TOML instead of silently replacing settings with zero satellites", () => {
    expect(() => parseConfigBundle(satelliteToml)).toThrow("設定ファイルの区切り");
  });

  it("rejects unrelated or empty files", () => {
    for (const text of ["", "# comment only", "name = \"unexpected\""]) {
      expect(() => parseConfigBundle(text)).toThrow("設定ファイルの区切り");
    }
  });

  it("loads the saved bundle through the settings import parser", () => {
    const start = new Date("2026-10-29T00:00:00Z");
    const loaded = parseConfigBundle(buildConfigBundle(satelliteToml, "", "", start));
    expect(loaded.satellites).toHaveLength(1);
    expect(loaded.satText).toBe(satelliteToml.trim());
    expect(loaded.startTime.toISOString()).toBe(start.toISOString());
  });

  it("preserves intentionally empty saved settings", () => {
    const loaded = parseConfigBundle(buildConfigBundle("", "", "", new Date("2026-10-29T00:00:00Z")));
    expect(loaded.satellites).toHaveLength(0);
    expect(loaded.groundStations).toHaveLength(0);
  });
});
