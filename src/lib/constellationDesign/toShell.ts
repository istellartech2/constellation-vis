/**
 * `DesignCandidate` → `ConstellationShell`, plus the relaxation suggestions the
 * wizard offers when nothing is feasible.
 *
 * The hard requirement here is that the shell reproduces the *verified*
 * constellation exactly. Two traps:
 *
 *  1. A `streets_of_coverage` shell stores design *inputs* and re-derives
 *     `planes`, `count` and the inter-plane phase from them
 *     (`streetsOfCoverage.ts`), always with `spacingSafetyFactor = 1`. So a
 *     candidate sized with a different safety factor cannot be expressed that
 *     way. `candidateToShell` re-runs the sizing the shell would run and falls
 *     back to an explicit `walker_star` shell whenever it disagrees.
 *  2. Cross-plane N-fold Star candidates use `P = ceil(N·P₁)` planes, which the
 *     in-plane sizing equations would never produce, so they are always emitted
 *     as `walker_star`.
 */
import { designStreetsOfCoverage } from "../constellationPatterns/coverageGeometry";
import type { ConstellationShell } from "../constellationTypes";
import type { DesignCandidate, DesignConstraints, DesignRequest, TargetRegion } from "./types";
import { regionLatitudeBounds } from "./types";

export interface CandidateToShellOptions {
  /** Source request; supplies the `mission_*` provenance fields. */
  request?: DesignRequest;
  name?: string;
}

function missionFields(request?: DesignRequest): Partial<ConstellationShell> {
  if (!request) return {};
  const { constraints, objective } = request;
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
  return {
    mission_objective: objective.kind,
    mission_min_elevation: constraints.minElevationDeg,
    mission_fold: constraints.fold,
    mission_region: constraints.region.kind,
    mission_lat_min: latMinDeg,
    mission_lat_max: latMaxDeg,
    mission_alt_min: constraints.altitudeMinKm,
    mission_alt_max: constraints.altitudeMaxKm,
  };
}

function rgtFields(candidate: DesignCandidate): Partial<ConstellationShell> {
  const { repeatOrbits, repeatDays } = candidate.parameters;
  if (repeatOrbits === undefined || repeatDays === undefined) return {};
  return { rgt_repeat_orbits: repeatOrbits, rgt_repeat_days: repeatDays };
}

/**
 * True when a `streets_of_coverage` shell built from this candidate's design
 * inputs would regenerate the same plane count and total — i.e. when the
 * candidate is expressible in the pattern that records *why* it has that size.
 */
export function isExpressibleAsStreetsOfCoverage(candidate: DesignCandidate): boolean {
  const { parameters, analytic } = candidate;
  if (parameters.family !== "walkerStar") return false;
  if (analytic.sizingMethod !== "streetsOfCoverage-inPlane") return false;
  const soc = parameters.socDesign;
  if (!soc) return false;
  const rebuilt = designStreetsOfCoverage({
    altitudeKm: parameters.altitudeKm,
    minElevationDeg: soc.minElevationDeg,
    fold: soc.fold,
    targetLatitudeDeg: soc.targetLatitudeDeg,
    satsPerPlane: soc.satsPerPlane,
  });
  return (
    rebuilt.feasible &&
    rebuilt.planes === parameters.planes &&
    rebuilt.count === parameters.totalSatellites
  );
}

export function candidateToShell(
  candidate: DesignCandidate,
  options: CandidateToShellOptions = {},
): ConstellationShell {
  const { parameters } = candidate;
  const common = {
    id: crypto.randomUUID(),
    ...(options.name ? { name: options.name } : {}),
    eccentricity: 0,
    apogee_altitude: parameters.altitudeKm,
    inclination: parameters.inclinationDeg,
    raan_start: 0,
    argp: 0,
    mean_anomaly_0: 0,
    ...rgtFields(candidate),
    ...missionFields(options.request),
  };

  if (parameters.family === "walkerStar") {
    if (isExpressibleAsStreetsOfCoverage(candidate)) {
      const soc = parameters.socDesign!;
      return {
        ...common,
        pattern: "streets_of_coverage",
        count: parameters.totalSatellites,
        planes: parameters.planes,
        phasing: parameters.phasingF,
        raan_spacing: parameters.deltaCoDeg,
        raan_range: parameters.raanSpanDeg ?? 180,
        soc_min_elevation: soc.minElevationDeg,
        soc_coverage_fold: soc.fold,
        soc_target_latitude: soc.targetLatitudeDeg,
        soc_sats_per_plane: soc.satsPerPlane,
      };
    }
    // Explicit star: every angle the generator needs is stored, so nothing is
    // re-derived and the shell is exactly the verified constellation.
    return {
      ...common,
      pattern: "walker_star",
      count: parameters.totalSatellites,
      planes: parameters.planes,
      phasing: parameters.phasingF,
      raan_spacing: parameters.deltaCoDeg,
      raan_range: parameters.raanSpanDeg ?? 180,
    };
  }

  return {
    ...common,
    pattern: "walker_delta",
    count: parameters.totalSatellites,
    planes: parameters.planes,
    phasing: parameters.phasingF,
    raan_range: 360,
  };
}

/* -------------------------------------------------------------------------- */
/* Relaxation suggestions                                                     */
/* -------------------------------------------------------------------------- */

export interface RelaxationSuggestion {
  label: string;
  apply: (constraints: DesignConstraints) => DesignConstraints;
}

const RELAXED_MIN_ELEVATION_DEG = 15;
const ALTITUDE_RELAXATION_KM = 500;
const MAX_RELAXED_ALTITUDE_KM = 2000;
const RELAXED_BAND_DEG = 60;

/**
 * Single-click ways to make an empty result set non-empty, ordered from
 * cheapest to most invasive. Each returns a *new* constraints object; none
 * mutate the input, so the wizard can offer several and still show the original.
 */
export function relaxationSuggestions(constraints: DesignConstraints): RelaxationSuggestion[] {
  const suggestions: RelaxationSuggestion[] = [];

  if (constraints.minElevationDeg > RELAXED_MIN_ELEVATION_DEG) {
    suggestions.push({
      label: `最低仰角を ${constraints.minElevationDeg}° → ${RELAXED_MIN_ELEVATION_DEG}° に緩和`,
      apply: (c) => ({ ...c, minElevationDeg: RELAXED_MIN_ELEVATION_DEG }),
    });
  }

  if (constraints.altitudeMaxKm < MAX_RELAXED_ALTITUDE_KM) {
    const next = Math.min(
      MAX_RELAXED_ALTITUDE_KM,
      constraints.altitudeMaxKm + ALTITUDE_RELAXATION_KM,
    );
    suggestions.push({
      label: `高度上限を ${Math.round(constraints.altitudeMaxKm)} km → ${Math.round(next)} km に引き上げ`,
      apply: (c) => ({ ...c, altitudeMaxKm: next }),
    });
  }

  if (constraints.fold > 1) {
    const next = (constraints.fold - 1) as DesignConstraints["fold"];
    suggestions.push({
      label: `多重被覆数を ${constraints.fold} → ${next} に緩和`,
      apply: (c) => ({ ...c, fold: next }),
    });
  }

  if (constraints.region.kind === "global") {
    const band: TargetRegion = {
      kind: "latitudeBand",
      latMinDeg: -RELAXED_BAND_DEG,
      latMaxDeg: RELAXED_BAND_DEG,
    };
    suggestions.push({
      label: `対象領域を全球 → 緯度 ±${RELAXED_BAND_DEG}° 帯に縮小`,
      apply: (c) => ({ ...c, region: band }),
    });
  }

  return suggestions;
}
