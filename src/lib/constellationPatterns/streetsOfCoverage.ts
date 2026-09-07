/**
 * Streets of Coverage — a Walker Star whose plane count, plane spacing and
 * inter-plane phase come from the coverage design equations instead of being
 * typed in. `planes` and `count` are therefore *derived* values that the
 * serializer always writes back.
 *
 * The design itself lives in `coverageGeometry.designStreetsOfCoverage`, which
 * the Phase 2 optimizer also calls, so there is exactly one implementation of
 * the sizing equations.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { designStreetsOfCoverage } from "./coverageGeometry";
import { greedyPlaneSizes } from "./emit";
import { orbitFromShell } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import { inclinationWarnings, planStarCore, starCoreInput } from "./walkerStar";
import type {
  ShellWarning,
  PatternGenerator,
  PatternShellInput,
  ShellDerived,
  ShellPlan,
  StreetsOfCoverageDesign,
  ValidationError,
} from "./types";

export function socDesign(shell: PatternShellInput): StreetsOfCoverageDesign {
  return designStreetsOfCoverage({
    altitudeKm: numberField("apogee_altitude", shell),
    minElevationDeg: numberField("soc_min_elevation", shell),
    fold: numberField("soc_coverage_fold", shell),
    targetLatitudeDeg: numberField("soc_target_latitude", shell),
    satsPerPlane: numberField("soc_sats_per_plane", shell),
  });
}

export function planStreetsOfCoverage(shell: PatternShellInput): ShellPlan {
  const design = socDesign(shell);
  const orbitInclination = numberField("inclination", shell);

  if (!design.feasible) {
    // Never throw: the editor must still show *something* while the user is
    // dialling in the numbers. Fall back to the stored planes/count.
    const plan = planStarCore(starCoreInput(shell), shell);
    return {
      ...plan,
      warnings: [...design.warnings, ...inclinationWarnings(orbitInclination)],
    };
  }

  const plan = planStarCore(
    {
      count: design.count,
      planes: design.planes,
      // Inter-plane mean-anomaly offset = (360/count)·F, so F = count·ω/360.
      phasing: (design.count * design.omegaDeg) / 360,
      raanStartDeg: numberField("raan_start", shell),
      raanRangeDeg: design.spanDeg,
      raanSpacingDeg: design.deltaCoDeg,
      meanAnomaly0Deg: numberField("mean_anomaly_0", shell),
    },
    shell,
  );

  // For n ≥ 2 at low target latitude eq. (6) demands the whole circle: the
  // planes then close on themselves (a Delta-like layout) and the seam premise
  // no longer holds, so the last→first plane link is structural again.
  const fullCircle = design.spanDeg >= 360 - 1e-6;
  const layoutWarnings: ShellWarning[] = fullCircle
    ? [
        {
          code: "full_circle_layout",
          message: `必要 RAAN 範囲が 360° になり、面が全周に並びます(シームのない Walker Delta 相当の配置)。`,
        },
      ]
    : [];

  return {
    ...plan,
    wrapPlanes: fullCircle ? true : plan.wrapPlanes,
    warnings: [...design.warnings, ...layoutWarnings, ...inclinationWarnings(orbitInclination)],
  };
}

export function deriveStreetsOfCoverage(shell: PatternShellInput): ShellDerived {
  const design = socDesign(shell);
  const orbit = orbitFromShell(shell);
  const planes = design.feasible ? design.planes : numberField("planes", shell);
  const count = design.feasible ? design.count : numberField("count", shell);
  const warnings = [...design.warnings, ...inclinationWarnings(orbit.inclinationDeg)];

  return {
    ...buildCommonDerived({
      totalSats: count,
      planes,
      planeSizes: greedyPlaneSizes(count, planes),
      orbit,
      raanSpacingDeg: design.feasible
        ? design.deltaCoDeg
        : planes > 0
          ? numberField("raan_range", shell) / planes
          : 0,
      inPlaneSpacingDeg: design.satsPerPlane > 0 ? 360 / design.satsPerPlane : 0,
      interPlaneOffsetDeg: design.feasible ? design.omegaDeg : 0,
      warnings,
    }),
    pattern: "streets_of_coverage",
    design,
  };
}

export function validateStreetsOfCoverage(
  shell: PatternShellInput,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const altitude = numberField("apogee_altitude", shell);
  const satsPerPlane = numberField("soc_sats_per_plane", shell);
  const fold = numberField("soc_coverage_fold", shell);
  const latitude = numberField("soc_target_latitude", shell);
  const minElevation = numberField("soc_min_elevation", shell);

  if (!(altitude > 0)) {
    errors.push({
      field: `shell.${index}.apogee_altitude`,
      message: "Streets of Coverage では高度は0より大きい必要があります",
    });
  }
  if (!Number.isInteger(satsPerPlane) || satsPerPlane < 1) {
    errors.push({
      field: `shell.${index}.soc_sats_per_plane`,
      message: "1軌道面あたりの衛星数は1以上の整数が必要です",
    });
  }
  if (!Number.isInteger(fold) || fold < 1) {
    errors.push({
      field: `shell.${index}.soc_coverage_fold`,
      message: "多重被覆数は1以上の整数が必要です",
    });
  }
  if (minElevation < 0 || minElevation >= 90) {
    errors.push({
      field: `shell.${index}.soc_min_elevation`,
      message: "最低仰角は0以上90未満である必要があります",
    });
  }
  if (Math.abs(latitude) > 90) {
    errors.push({
      field: `shell.${index}.soc_target_latitude`,
      message: "目標緯度は-90..90の範囲が必要です",
    });
  }

  if (errors.length === 0) {
    const design = socDesign(shell);
    for (const warning of design.warnings) {
      errors.push({
        field: `shell.${index}`,
        message: warning.message,
        severity: "warning",
      });
    }
  }

  return errors;
}

export const streetsOfCoverageGenerator: PatternGenerator = {
  id: "streets_of_coverage",
  fields: fieldKeysForPattern("streets_of_coverage"),
  plan: planStreetsOfCoverage,
  derive: deriveStreetsOfCoverage,
  validate: validateStreetsOfCoverage,
};
