import { describe, expect, it } from "bun:test";
import { pickSatelliteHitIndex } from "./visualization";

describe("pickSatelliteHitIndex", () => {
  it("returns null when there are no hits", () => {
    expect(pickSatelliteHitIndex([], null)).toBeNull();
  });

  it("picks the first hit when nothing is selected", () => {
    expect(pickSatelliteHitIndex([3, 4, 5], null)).toBe(3);
  });

  it("cycles to the next overlapping satellite when current selection is in the hit list", () => {
    expect(pickSatelliteHitIndex([3, 4, 5], 3)).toBe(4);
    expect(pickSatelliteHitIndex([3, 4, 5], 4)).toBe(5);
    expect(pickSatelliteHitIndex([3, 4, 5], 5)).toBe(3);
  });

  it("falls back to the first hit when current selection is not in the hit list", () => {
    expect(pickSatelliteHitIndex([3, 4, 5], 10)).toBe(3);
  });
});
