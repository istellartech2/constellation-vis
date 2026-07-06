/** Equivalent-delay [ms] cost model (§1.4): propagation delay + hop penalty + stability. */

export const SPEED_OF_LIGHT_KM_PER_S = 299792.458;

export function propagationDelayMs(distanceKm: number): number {
  return (distanceKm / SPEED_OF_LIGHT_KM_PER_S) * 1000;
}

/**
 * Stability penalty c_stab (§1.5.2): a monotonically decreasing penalty that
 * discourages routing through links about to expire. `remainingS` is the
 * predicted time (seconds) the edge will keep satisfying its existence
 * condition (from `remainingLinkTime`); `thresholdS` (tau_min) is the
 * remaining-time level considered "stable"; `weightMs` (w_tau) is the penalty
 * cap applied when remainingS is 0.
 */
export function stabilityPenaltyMs(remainingS: number, thresholdS: number, weightMs: number): number {
  if (thresholdS <= 0) return 0;
  return weightMs * Math.max(0, 1 - remainingS / thresholdS);
}

export function edgeCostMs(
  distanceKm: number,
  hopPenaltyMs: number,
  kindPenaltyMs = 0,
  stabilityMs = 0,
): number {
  return propagationDelayMs(distanceKm) + hopPenaltyMs + kindPenaltyMs + stabilityMs;
}
