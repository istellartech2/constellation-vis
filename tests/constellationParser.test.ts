import { describe, expect, it } from "bun:test";
import {
  generateShellRanges,
  parseConstellationConfig,
  parseConstellationToml,
} from "../src/lib/tomlParsers";
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

  // The inner generation loop must stop once *that
  // shell* has produced `count` satellites, not once the whole accumulated
  // array reaches `count` — otherwise every shell after the first is
  // truncated (a pre-existing bug independent of the ISL feature).
  it("generates every shell's full satellite count in a multi-shell constellation", () => {
    const toml = `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "shellA"
count = 12
planes = 3
apogee_altitude = 550

[[constellation.shells]]
name = "shellB"
count = 20
planes = 4
apogee_altitude = 780
`;

    const satellites = parseConstellationToml(toml);
    expect(satellites).toHaveLength(32);

    const ranges = generateShellRanges(parseConstellationConfig(toml), 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ key: "0", name: "shellA", startIndex: 0, count: 12, planes: 3 });
    expect(ranges[1]).toMatchObject({ key: "1", name: "shellB", startIndex: 12, count: 20, planes: 4 });
  });

  it("offsets shell ranges by a non-zero base satellite count", () => {
    const toml = `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
count = 6
planes = 2
`;
    const ranges = generateShellRanges(parseConstellationConfig(toml), 5);
    expect(ranges).toEqual([{ key: "0", name: undefined, startIndex: 5, count: 6, planes: 2 }]);
  });
});
