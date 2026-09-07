/**
 * Closed-form Walker Star / Streets-of-Coverage candidate enumeration.
 *
 * This is the cheap half of the optimizer: for every (altitude, S) pair the
 * plane count follows directly from the Beech sizing equations, so a few
 * hundred candidates cost microseconds and no propagation at all. All sizing
 * goes through `designStreetsOfCoverage` — the optimizer never reimplements the
 * equations, so a Star candidate and a `streets_of_coverage` shell built from it
 * are the same constellation by construction.
 *
 * Two N-fold strategies are enumerated (they are the same thing for N = 1, and
 * only the in-plane one is emitted then):
 *  - **in-plane**: `fold` is handed to the sizing equations, which widen the
 *    required street and thicken each plane;
 *  - **cross-plane**: size for single coverage, then use `P = ceil(N·P₁)` planes
 *    in the same RAAN span so neighbouring planes overlap N-fold.
 *
 * The inter-plane phase F is *not* enumerated: it is `T·ω/360`, the value the
 * sizing equations produce (and exactly what `streetsOfCoverage.ts` recomputes
 * when the candidate becomes a shell). For a global target that is P/2, which is
 * the half-slot stagger the plan calls for. Choosing a different F would make
 * the shell disagree with the verified candidate.
 */
import {
  bandAreaFraction,
  capAreaLowerBoundCount,
  degToRad,
  designStreetsOfCoverage,
  earthCentralAngleDeg,
  footprintRadiusKm,
  nadirLatencyMs,
  oneWayLatencyMs,
  orbitalPeriodSec,
  slantRangeAtElevationKm,
} from "../constellationPatterns/coverageGeometry";
import type { StreetsOfCoverageDesign } from "../constellationPatterns/types";
import { altitudeSamplesForInclination, starInclinationDeg } from "./searchGrid";
import {
  DEFAULT_MAX_SATS_PER_PLANE,
  DEFAULT_SPACING_SAFETY_FACTOR,
  regionLatitudeBounds,
  regionMinAbsLatitudeDeg,
  type AnalyticMetrics,
  type CandidateParameters,
  type DesignCandidate,
  type DesignConstraints,
  type DesignRequest,
  type SizingMethod,
} from "./types";

/** Default cap on S when the request leaves `maxSatsPerPlane` open. */
export const DEFAULT_STAR_MAX_SATS_PER_PLANE = 40;
/** Smallest S worth trying — S ≤ 2 can never form a continuous street. */
export const MIN_STAR_SATS_PER_PLANE = 3;

export interface StarSizingResult {
  candidates: DesignCandidate[];
  /** Candidates rejected by the sizing equations, kept for the "why is it empty" UI. */
  rejected: DesignCandidate[];
  warnings: string[];
}

function analyticFor(
  altitudeKm: number,
  minElevationDeg: number,
  constraints: DesignConstraints,
  design: StreetsOfCoverageDesign,
  sizingMethod: SizingMethod,
): AnalyticMetrics {
  const epsRad = degToRad(minElevationDeg);
  const thetaDeg = design.feasible
    ? design.thetaDeg
    : earthCentralAngleDeg(altitudeKm, minElevationDeg);
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
  const slant = slantRangeAtElevationKm(altitudeKm, epsRad);
  return {
    centralAngleDeg: thetaDeg,
    footprintRadiusKm: footprintRadiusKm(altitudeKm, epsRad),
    streetHalfWidthDeg: design.feasible ? design.cnDeg : undefined,
    capAreaLowerBoundCount: capAreaLowerBoundCount(
      bandAreaFraction(latMinDeg, latMaxDeg),
      degToRad(thetaDeg),
      constraints.fold,
    ),
    slantRangeAtEpsilonKm: slant,
    latencyAtEpsilonMs: oneWayLatencyMs(slant),
    latencyNadirMs: nadirLatencyMs(altitudeKm),
    orbitalPeriodSec: orbitalPeriodSec(altitudeKm),
    sizingMethod,
  };
}

export function starCandidateKey(parameters: CandidateParameters, sizingMethod: SizingMethod): string {
  const kind = sizingMethod === "streetsOfCoverage-crossPlane" ? "wsx" : "ws";
  return [
    kind,
    `T${parameters.totalSatellites}`,
    `P${parameters.planes}`,
    `S${parameters.satsPerPlane}`,
    `h${parameters.altitudeKm.toFixed(1)}`,
    `i${parameters.inclinationDeg.toFixed(2)}`,
  ].join("-");
}

/**
 * Every Walker Star candidate the constraints allow, in no particular order.
 * Instant — safe to call on the main thread to populate the results table before
 * the Worker has screened anything.
 */
export function enumerateStarCandidates(request: DesignRequest): StarSizingResult {
  const constraints = request.constraints;
  const warnings: string[] = [];
  const candidates: DesignCandidate[] = [];
  const rejected: DesignCandidate[] = [];

  const inclinationDeg = starInclinationDeg(constraints);
  if (inclinationDeg === null) {
    warnings.push(
      "傾斜角の上限が 80° 以下のため Walker Star / Streets of Coverage 系は候補から除外しました。",
    );
    return { candidates, rejected, warnings };
  }

  const fold = constraints.fold;
  const safety = constraints.spacingSafetyFactor ?? DEFAULT_SPACING_SAFETY_FACTOR;
  const targetLatitudeDeg = regionMinAbsLatitudeDeg(constraints.region);
  const maxSatsPerPlane = Math.min(
    constraints.maxSatsPerPlane ?? DEFAULT_STAR_MAX_SATS_PER_PLANE,
    DEFAULT_MAX_SATS_PER_PLANE,
  );
  const maxPlanes = constraints.maxPlanes ?? Number.POSITIVE_INFINITY;

  const altitudes = altitudeSamplesForInclination(constraints, inclinationDeg, warnings);

  for (const sample of altitudes) {
    for (let s = MIN_STAR_SATS_PER_PLANE; s <= maxSatsPerPlane; s++) {
      // --- in-plane N-fold -------------------------------------------------
      const inPlane = designStreetsOfCoverage({
        altitudeKm: sample.altitudeKm,
        minElevationDeg: constraints.minElevationDeg,
        fold,
        targetLatitudeDeg,
        satsPerPlane: s,
        spacingSafetyFactor: safety,
      });
      pushStar(
        candidates,
        rejected,
        constraints,
        sample,
        inclinationDeg,
        s,
        inPlane,
        inPlane.planes,
        inPlane.deltaCoDeg,
        "streetsOfCoverage-inPlane",
        maxPlanes,
      );

      // --- cross-plane N-fold ----------------------------------------------
      if (fold > 1) {
        const single = designStreetsOfCoverage({
          altitudeKm: sample.altitudeKm,
          minElevationDeg: constraints.minElevationDeg,
          fold: 1,
          targetLatitudeDeg,
          satsPerPlane: s,
          spacingSafetyFactor: safety,
        });
        if (single.feasible) {
          const planes = Math.ceil(fold * single.planes);
          // The RAAN span is fixed by the target latitude, so packing more
          // planes into it tightens Δco — that overlap is what buys the extra
          // fold across planes rather than within a plane.
          const deltaCo = planes > 1 ? (single.spanDeg - single.deltaSeamDeg) / (planes - 1) : 0;
          pushStar(
            candidates,
            rejected,
            constraints,
            sample,
            inclinationDeg,
            s,
            single,
            planes,
            deltaCo,
            "streetsOfCoverage-crossPlane",
            maxPlanes,
          );
        }
      }
    }
  }

  if (fold > 1) {
    warnings.push(
      "N 重カバレッジの Streets of Coverage 寸法は近似です(面内 N 重の半幅、または面間重なりの見積り)。数値検証の結果で判断してください。",
    );
  }

  return { candidates, rejected, warnings };
}

function pushStar(
  candidates: DesignCandidate[],
  rejected: DesignCandidate[],
  constraints: DesignConstraints,
  sample: { altitudeKm: number; repeatOrbits?: number; repeatDays?: number },
  inclinationDeg: number,
  satsPerPlane: number,
  design: StreetsOfCoverageDesign,
  planes: number,
  deltaCoDeg: number,
  sizingMethod: SizingMethod,
  maxPlanes: number,
): void {
  const totalSatellites = planes * satsPerPlane;
  const parameters: CandidateParameters = {
    family: "walkerStar",
    totalSatellites,
    planes,
    satsPerPlane,
    // ω is the designed inter-plane mean-anomaly offset; F = T·ω/360 is exactly
    // what `streetsOfCoverage.ts` derives from the same design.
    phasingF: (totalSatellites * design.omegaDeg) / 360,
    altitudeKm: sample.altitudeKm,
    inclinationDeg,
    raanSpanDeg: design.spanDeg,
    seamGapDeg: design.deltaSeamDeg,
    deltaCoDeg,
    socDesign: {
      minElevationDeg: constraints.minElevationDeg,
      fold: constraints.fold,
      targetLatitudeDeg: regionMinAbsLatitudeDeg(constraints.region),
      satsPerPlane,
    },
    repeatOrbits: sample.repeatOrbits,
    repeatDays: sample.repeatDays,
    kernelFastPath: true,
  };
  const analytic = analyticFor(
    sample.altitudeKm,
    constraints.minElevationDeg,
    constraints,
    design,
    sizingMethod,
  );
  const key = starCandidateKey(parameters, sizingMethod);

  if (!design.feasible) {
    rejected.push({
      key,
      parameters: { ...parameters, planes: 0, totalSatellites: 0 },
      analytic,
      feasible: false,
      rejectionReason: "streetInfeasible",
    });
    return;
  }
  if (planes > maxPlanes) {
    rejected.push({ key, parameters, analytic, feasible: false, rejectionReason: "maxPlanes" });
    return;
  }
  candidates.push({ key, parameters, analytic, feasible: false });
}
