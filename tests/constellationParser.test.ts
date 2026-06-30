import { describe, expect, it } from "bun:test";
import { parseConstellationConfig, parseConstellationToml } from "../src/lib/tomlParsers";
import { validateSatellites } from "../src/utils/validators";

describe("constellation TOML parser", () => {
  it("uses defaults for fields omitted by the constellation UI serializer", () => {
    const toml = `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
count = 2
planes = 1
`;

    const config = parseConstellationConfig(toml);
    expect(config.shells[0]).toMatchObject({
      count: 2,
      planes: 1,
      apogee_altitude: 0,
      inclination: 0,
    });

    const satellites = parseConstellationToml(toml);
    expect(satellites).toHaveLength(2);
    expect(() => validateSatellites(satellites, "constellation.toml")).not.toThrow();
    expect(satellites[0]?.type).toBe("elements");
    if (satellites[0]?.type !== "elements") return;
    expect(Number.isFinite(satellites[0].elements.semiMajorAxisKm)).toBe(true);
    expect(Number.isFinite(satellites[0].elements.inclinationDeg)).toBe(true);
  });
});
