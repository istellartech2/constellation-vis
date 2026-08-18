import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseScenarioToml } from "../src/cli/scenarioParser";

describe("scenario TOML parser", () => {
  it("parses the Transporter Tokyo Tsukuba fixture", async () => {
    const text = await readFile("tests/transporter-tokyo-tsukuba.toml", "utf8");
    const scenario = parseScenarioToml(text, "fixture");

    expect(scenario.startTime.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(scenario.durationHours).toBe(24);
    expect(scenario.satellites).toHaveLength(1);
    expect(scenario.satellites[0].id).toBe("transporter-demo-1");
    expect(scenario.terminals.map((terminal) => terminal.kind)).toEqual(["service", "feeder"]);
    expect(scenario.terminals[1].uplinkFrequencyHz).toBe(30_000_000_000);
  });

  it("requires both service and feeder terminals", () => {
    const text = `
[analysis]
startTime = "2026-08-18T00:00:00Z"

[[satellites]]
type = "elements"
satnum = 90001
epoch = "2026-08-18T00:00:00Z"
semiMajorAxisKm = 6903.137
eccentricity = 0
inclinationDeg = 97.5
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[groundstations]]
name = "Only UE"
kind = "service"
latitudeDeg = 35
longitudeDeg = 139
`;
    expect(() => parseScenarioToml(text)).toThrow("feeder");
  });
});
