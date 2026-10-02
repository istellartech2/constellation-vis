import type { AvailabilityBasis, ScreenMetrics, VerifiedMetrics } from "./types";

/** Latitude rows average over longitude and time; this is not a worst-point guarantee. */
export function scoreAvailability(
  metrics: ScreenMetrics | VerifiedMetrics,
  basis: AvailabilityBasis = "areaAverage",
): number {
  if (basis === "areaAverage") return metrics.foldAvailability;
  if ("perLatitude" in metrics) {
    return metrics.perLatitude.length > 0
      ? Math.min(...metrics.perLatitude.map((row) => row.foldAvailability))
      : 0;
  }
  return metrics.worstLatitudeAvailability ?? 0;
}

export function evaluatedAvailability(metrics?: ScreenMetrics | VerifiedMetrics): number {
  return metrics?.evaluationAvailability ?? metrics?.foldAvailability ?? 0;
}
