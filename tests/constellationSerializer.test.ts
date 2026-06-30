import { describe, expect, it } from "bun:test";
import {
  parseConstellationConfig,
  serializeConstellationConfig,
} from "../src/lib/constellationSerializer";

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
