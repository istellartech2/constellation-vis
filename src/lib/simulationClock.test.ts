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

  it("seeks without replaying the time before the jump", () => {
    const clock = new SimulationClock(1_000_000, 0, 10);
    expect(clock.tick(1000, 10).getTime()).toBe(1_010_000);
    // Jump backwards at real time 1500: the 500 ms since the last tick is dropped.
    clock.reset(500_000, 1500);
    expect(clock.tick(2500, 10).getTime()).toBe(510_000);
    // Forward jump while paused stays put until playback resumes.
    clock.tick(3000, 0);
    clock.reset(9_000_000, 3200);
    expect(clock.tick(4200, 1).getTime()).toBe(9_000_000);
    expect(clock.tick(5200, 1).getTime()).toBe(9_001_000);
  });
});
