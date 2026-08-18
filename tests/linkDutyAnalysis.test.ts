import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseScenarioToml } from "../src/cli/scenarioParser";
import { analyzeLinkDuty } from "../src/lib/linkDutyAnalysis";

describe("link duty analysis", () => {
  it("finds service, feeder, and end-to-end duty", async () => {
    const scenario = parseScenarioToml(
      await readFile("tests/transporter-tokyo-tsukuba.toml", "utf8"),
    );
    const result = analyzeLinkDuty({ ...scenario, stepSeconds: 30, includeSamples: false });
    const satellite = result.satellites[0];

    expect(satellite.contactWindows.length).toBeGreaterThan(0);
    expect(satellite.duty.serviceRatio).toBeGreaterThan(0);
    expect(satellite.duty.feederRatio).toBeGreaterThan(0);
    expect(satellite.duty.endToEndRatio).toBeGreaterThan(0);
    expect(satellite.duty.endToEndRatio).toBeLessThanOrEqual(satellite.duty.serviceRatio);
    expect(satellite.duty.endToEndRatio).toBeLessThanOrEqual(satellite.duty.feederRatio);
    expect(result.constellationSummary.endToEndDutyRatio).toBeCloseTo(satellite.duty.endToEndRatio, 12);
    expect(satellite.links.every((link) => link.dutyRatio >= 0 && link.dutyRatio <= 1)).toBe(true);
  });
});
