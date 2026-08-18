import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseScenarioToml } from "../src/cli/scenarioParser";
import { calculateLinkGeometry, SPEED_OF_LIGHT_KM_PER_SEC } from "../src/lib/linkGeometry";
import { toSatrec } from "../src/lib/satellites";

describe("ground link geometry", () => {
  it("calculates delay and Doppler consistently", async () => {
    const scenario = parseScenarioToml(
      await readFile("tests/transporter-tokyo-tsukuba.toml", "utf8"),
    );
    const satrec = toSatrec(scenario.satellites[0].spec);
    const terminal = scenario.terminals[0];
    let visibleTime: Date | null = null;
    for (let seconds = 0; seconds <= 86_400; seconds += 30) {
      const date = new Date(scenario.startTime.getTime() + seconds * 1000);
      if (calculateLinkGeometry(satrec, terminal, date)?.visible) {
        visibleTime = date;
        break;
      }
    }
    expect(visibleTime).not.toBeNull();
    const geometry = calculateLinkGeometry(satrec, terminal, visibleTime as Date);
    expect(geometry).not.toBeNull();
    if (!geometry || !visibleTime) return;

    expect(geometry.oneWayPropagationDelayMs).toBeCloseTo(
      geometry.slantRangeKm / SPEED_OF_LIGHT_KM_PER_SEC * 1000,
      10,
    );
    expect(geometry.roundTripPropagationDelayMs).toBeCloseTo(geometry.oneWayPropagationDelayMs * 2, 10);
    expect(geometry.downlinkDopplerHz).toBeCloseTo(
      -terminal.downlinkFrequencyHz! * geometry.rangeRateKmPerSec / SPEED_OF_LIGHT_KM_PER_SEC,
      8,
    );

    const before = calculateLinkGeometry(satrec, terminal, new Date(visibleTime.getTime() - 500));
    const after = calculateLinkGeometry(satrec, terminal, new Date(visibleTime.getTime() + 500));
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const numericalRangeRate = (after!.slantRangeKm - before!.slantRangeKm);
    expect(geometry.rangeRateKmPerSec).toBeCloseTo(numericalRangeRate, 3);
  });
});
