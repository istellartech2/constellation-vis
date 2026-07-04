import { describe, expect, it } from "bun:test";
import { edgeCostMs, propagationDelayMs, stabilityPenaltyMs } from "../src/lib/isl/cost";

describe("isl cost", () => {
  describe("stabilityPenaltyMs (§1.5.2, Phase 4)", () => {
    it("is at its cap (w_tau) when the link is about to expire (remaining = 0)", () => {
      expect(stabilityPenaltyMs(0, 60, 20)).toBeCloseTo(20, 6);
    });

    it("is 0 once remaining time reaches the stability threshold (tau_min)", () => {
      expect(stabilityPenaltyMs(60, 60, 20)).toBeCloseTo(0, 6);
    });

    it("is 0 (not negative) well beyond the threshold", () => {
      expect(stabilityPenaltyMs(300, 60, 20)).toBe(0);
    });

    it("decreases linearly between 0 and tau_min", () => {
      expect(stabilityPenaltyMs(30, 60, 20)).toBeCloseTo(10, 6); // halfway -> half the cap
    });

    it("is 0 when disabled (threshold <= 0)", () => {
      expect(stabilityPenaltyMs(0, 0, 20)).toBe(0);
    });
  });

  describe("edgeCostMs with the optional stability component", () => {
    it("defaults stabilityMs to 0 (Phase 1-3 call sites unaffected)", () => {
      const withoutStability = edgeCostMs(1000, 2, 0);
      const explicitZero = edgeCostMs(1000, 2, 0, 0);
      expect(withoutStability).toBeCloseTo(explicitZero, 9);
    });

    it("adds the stability penalty on top of propagation delay + hop + kind penalties", () => {
      const distanceKm = 1000;
      const hopPenaltyMs = 2;
      const kindPenaltyMs = 5;
      const stabilityMs = 8;
      const total = edgeCostMs(distanceKm, hopPenaltyMs, kindPenaltyMs, stabilityMs);
      expect(total).toBeCloseTo(
        propagationDelayMs(distanceKm) + hopPenaltyMs + kindPenaltyMs + stabilityMs,
        9,
      );
    });
  });
});
