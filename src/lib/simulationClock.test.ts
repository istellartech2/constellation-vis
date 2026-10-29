import { describe, expect, it } from "bun:test";
import { SimulationClock } from "./simulationClock";

describe("simulation playback clock", () => {
  it("keeps time continuous through speed changes and pause/resume", () => {
    const clock = new SimulationClock(1_000_000, 0, 1);
    expect(clock.tick(1000, 10).getTime()).toBe(1_001_000);
    expect(clock.tick(2000, 0).getTime()).toBe(1_011_000);
    expect(clock.tick(5000, 2).getTime()).toBe(1_011_000);
    expect(clock.tick(6000, 2).getTime()).toBe(1_013_000);
  });
});
