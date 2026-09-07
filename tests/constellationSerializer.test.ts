import { describe, expect, it } from "bun:test";
import {
  parseConstellationConfig,
  serializeConstellationConfig,
} from "../src/lib/constellationSerializer";
import { buildConstellation } from "../src/lib/tomlParsers";
import type { ConstellationShell } from "../src/lib/constellationTypes";

describe("constellation serializer", () => {
  it("round-trips decimal phasing values", () => {
    const serialized = serializeConstellationConfig({
      epoch: new Date("2025-05-20T00:00:00Z"),
      shells: [
        {
          id: "shell-1",
          count: 8,
          planes: 4,
          phasing: 1.5,
          apogee_altitude: 500,
          eccentricity: 0,
          inclination: 43,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      ],
    });

    expect(serialized).toContain("phasing = 1.5");
    expect(parseConstellationConfig(serialized).shells[0]?.phasing).toBe(1.5);
  });
});

describe("constellation serializer → runtime parser round trip", () => {
  // `inclination = 90` is the registry default for walker_star and
  // streets_of_coverage, so the serializer omits the key. The runtime parser
  // must then fall back to the same pattern-aware default, not to 0 — otherwise
  // a saved polar constellation reloads as an equatorial one.
  const polarShells: ConstellationShell[] = [
    {
      id: "star",
      pattern: "walker_star",
      count: 66,
      planes: 6,
      apogee_altitude: 780,
      eccentricity: 0,
      inclination: 90,
      raan_start: 0,
      raan_range: 180,
      argp: 0,
      mean_anomaly_0: 0,
    },
    {
      id: "soc",
      pattern: "streets_of_coverage",
      count: 66,
      planes: 6,
      apogee_altitude: 780,
      eccentricity: 0,
      inclination: 90,
      raan_start: 0,
      raan_range: 180,
      argp: 0,
      mean_anomaly_0: 0,
      soc_min_elevation: 8.2,
      soc_coverage_fold: 1,
      soc_target_latitude: 0,
      soc_sats_per_plane: 11,
    },
  ];

  for (const shell of polarShells) {
    it(`keeps inclination 90 for ${shell.pattern} when the serializer omits the key`, () => {
      const toml = serializeConstellationConfig({
        epoch: new Date("2024-01-01T00:00:00Z"),
        shells: [shell],
      });
      expect(toml).toContain(`pattern = "${shell.pattern}"`);
      expect(toml).not.toContain("inclination =");

      const { satellites } = buildConstellation(toml, 0);
      expect(satellites.length).toBeGreaterThan(0);
      for (const sat of satellites) {
        expect(sat.type).toBe("elements");
        if (sat.type === "elements") {
          expect(sat.elements.inclinationDeg).toBe(90);
        }
      }
    });
  }

  it("still reads an omitted inclination as 0 for walker_delta", () => {
    const toml = serializeConstellationConfig({
      epoch: new Date("2024-01-01T00:00:00Z"),
      shells: [
        {
          id: "delta",
          count: 4,
          planes: 2,
          phasing: 0,
          apogee_altitude: 500,
          eccentricity: 0,
          inclination: 0,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      ],
    });
    expect(toml).not.toContain("inclination =");
    const { satellites } = buildConstellation(toml, 0);
    expect(satellites.length).toBe(4);
    for (const sat of satellites) {
      if (sat.type === "elements") expect(sat.elements.inclinationDeg).toBe(0);
    }
  });
});
