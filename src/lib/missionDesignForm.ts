/**
 * Pure form-state helpers for the mission-design wizard
 * (`src/components/ui/MissionDesignPane.tsx`).
 *
 * Everything here is React-free and side-effect-free so it can be unit tested
 * (`tests/missionDesignForm.test.ts`) and so the `.tsx` files stay renderable
 * under `react-refresh/only-export-components`.
 *
 * The form is the *editable* projection of a `DesignRequest`: the wizard keeps
 * plain numbers (which `NumberField` may transiently set to `NaN` mid-edit),
 * `validateMissionForm` decides whether they can be posted to the Worker, and
 * `formToRequest` builds the request actually sent. `constraintsFromShell` is
 * the inverse for a shell that already carries `mission_*` provenance, so
 * 「設計をやり直す」 reopens the wizard with the constraints that produced it.
 */
import {
  DEFAULT_CONTINUOUS_THRESHOLD,
  DEFAULT_DESIGN_TOP_K,
  DEFAULT_SPACING_SAFETY_FACTOR,
  type DesignCandidate,
  type DesignConstraints,
  type DesignObjective,
  type DesignRequest,
  type PatternFamily,
} from "./constellationDesign";
import {
  PATTERN_SHORT_LABELS,
  bandAreaFraction,
  capAreaLowerBoundCount,
  earthCentralAngleRad,
  patternIdOf,
} from "./constellationPatterns";
import { regionLatitudeBounds } from "./constellationDesign";
import type { ConstellationShell } from "./constellationTypes";

export type MissionObjectiveKind = DesignObjective["kind"];
export type MissionRegionKind = "global" | "latitudeBand";
/** `"all"` means "let the engine pick both families" (`families` omitted). */
export type MissionFamilyChoice = "all" | PatternFamily;

export const MISSION_OBJECTIVE_KINDS: readonly MissionObjectiveKind[] = [
  "minSatellites",
  "paretoCountVsAltitude",
  "fixedBudget",
] as const;

export interface MissionDesignForm {
  objective: MissionObjectiveKind;
  minElevationDeg: number;
  /** N-fold coverage, 1..4. Kept as `number` because the input can be mid-edit. */
  fold: number;
  region: MissionRegionKind;
  latMinDeg: number;
  latMaxDeg: number;
  altitudeMinKm: number;
  altitudeMaxKm: number;
  altitudeStepKm: number;
  restrictInclination: boolean;
  inclinationMinDeg: number;
  inclinationMaxDeg: number;
  /** Force repeat-ground-track altitudes (replaces the free altitude grid). */
  rgt: boolean;
  family: MissionFamilyChoice;
  /** Only used by the `fixedBudget` objective. */
  satelliteBudget: number;
  topK: number;
}

export const MISSION_FORM_LIMITS = {
  minElevationDeg: { min: 0, max: 60 },
  fold: { min: 1, max: 4 },
  latitudeDeg: { min: -90, max: 90 },
  altitudeKm: { min: 300, max: 2000 },
  altitudeStepKm: { min: 10, max: 500 },
  inclinationDeg: { min: 0, max: 180 },
  satelliteBudget: { min: 1, max: 10000 },
  topK: { min: 1, max: 20 },
} as const;

/** Comm-payload defaults, mirroring `DEFAULT_DESIGN_CONSTRAINTS`. */
export const DEFAULT_MISSION_FORM: MissionDesignForm = {
  objective: "minSatellites",
  minElevationDeg: 25,
  fold: 1,
  region: "global",
  latMinDeg: -60,
  latMaxDeg: 60,
  altitudeMinKm: 500,
  altitudeMaxKm: 1500,
  altitudeStepKm: 50,
  restrictInclination: false,
  inclinationMinDeg: 45,
  inclinationMaxDeg: 100,
  rgt: false,
  family: "all",
  satelliteBudget: 48,
  topK: DEFAULT_DESIGN_TOP_K,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampFold(fold: number): DesignConstraints["fold"] {
  const rounded = Math.round(isFiniteNumber(fold) ? fold : 1);
  const bounded = Math.min(4, Math.max(1, rounded));
  return bounded as DesignConstraints["fold"];
}

export function isMissionObjectiveKind(value: unknown): value is MissionObjectiveKind {
  return (
    typeof value === "string" &&
    (MISSION_OBJECTIVE_KINDS as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Form → request                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Builds the `DesignRequest` posted to the Worker. Optional constraints are
 * *omitted* rather than set to `undefined` so the payload stays a minimal,
 * structured-cloneable object and is comparable in tests.
 */
export function formToRequest(form: MissionDesignForm, epochIso: string): DesignRequest {
  const altitudeMinKm = Math.min(form.altitudeMinKm, form.altitudeMaxKm);
  const altitudeMaxKm = Math.max(form.altitudeMinKm, form.altitudeMaxKm);

  const constraints: DesignConstraints = {
    minElevationDeg: form.minElevationDeg,
    fold: clampFold(form.fold),
    region:
      form.region === "latitudeBand"
        ? {
            kind: "latitudeBand",
            latMinDeg: Math.min(form.latMinDeg, form.latMaxDeg),
            latMaxDeg: Math.max(form.latMinDeg, form.latMaxDeg),
          }
        : { kind: "global" },
    altitudeMinKm,
    altitudeMaxKm,
    altitudeStepKm: form.altitudeStepKm,
    continuousThreshold: DEFAULT_CONTINUOUS_THRESHOLD,
    spacingSafetyFactor: DEFAULT_SPACING_SAFETY_FACTOR,
  };

  if (form.restrictInclination) {
    constraints.inclinationMinDeg = Math.min(form.inclinationMinDeg, form.inclinationMaxDeg);
    constraints.inclinationMaxDeg = Math.max(form.inclinationMinDeg, form.inclinationMaxDeg);
  }
  if (form.family !== "all") {
    constraints.families = [form.family];
  }
  if (form.rgt) {
    constraints.rgt = { enabled: true };
  }

  const objective: DesignObjective =
    form.objective === "fixedBudget"
      ? { kind: "fixedBudget", satelliteBudget: Math.round(form.satelliteBudget) }
      : { kind: form.objective };

  return {
    constraints,
    objective,
    epochIso,
    topK: Math.round(form.topK),
  };
}

/**
 * Blocking problems with the current form, as Japanese messages. An empty array
 * means 候補を計算 can run. Deliberately strict about `NaN`: `NumberField`
 * reports a blank input as `NaN`, and posting that to the Worker produces an
 * opaque failure deep inside the search grid.
 */
export function validateMissionForm(form: MissionDesignForm): string[] {
  const errors: string[] = [];
  const L = MISSION_FORM_LIMITS;

  const requireNumber = (value: number, label: string): boolean => {
    if (isFiniteNumber(value)) return true;
    errors.push(`${label}を入力してください`);
    return false;
  };

  if (requireNumber(form.minElevationDeg, "最低仰角")) {
    if (form.minElevationDeg < L.minElevationDeg.min || form.minElevationDeg > L.minElevationDeg.max) {
      errors.push(`最低仰角は ${L.minElevationDeg.min}–${L.minElevationDeg.max}° の範囲で指定してください`);
    }
  }

  if (requireNumber(form.fold, "多重度")) {
    if (
      !Number.isInteger(form.fold) ||
      form.fold < L.fold.min ||
      form.fold > L.fold.max
    ) {
      errors.push(`多重度は ${L.fold.min}–${L.fold.max} の整数で指定してください`);
    }
  }

  if (form.region === "latitudeBand") {
    const okMin = requireNumber(form.latMinDeg, "緯度下限");
    const okMax = requireNumber(form.latMaxDeg, "緯度上限");
    if (okMin && okMax) {
      if (form.latMinDeg >= form.latMaxDeg) {
        errors.push("緯度下限は緯度上限より小さい値にしてください");
      }
      if (
        form.latMinDeg < L.latitudeDeg.min ||
        form.latMaxDeg > L.latitudeDeg.max
      ) {
        errors.push("緯度は -90–90° の範囲で指定してください");
      }
    }
  }

  const okAltMin = requireNumber(form.altitudeMinKm, "高度下限");
  const okAltMax = requireNumber(form.altitudeMaxKm, "高度上限");
  if (okAltMin && okAltMax) {
    if (form.altitudeMinKm > form.altitudeMaxKm) {
      errors.push("高度下限は高度上限以下にしてください");
    }
    if (
      form.altitudeMinKm < L.altitudeKm.min ||
      form.altitudeMaxKm > L.altitudeKm.max
    ) {
      errors.push(`高度は ${L.altitudeKm.min}–${L.altitudeKm.max} km の範囲で指定してください`);
    }
  }

  if (requireNumber(form.altitudeStepKm, "高度刻み")) {
    if (
      form.altitudeStepKm < L.altitudeStepKm.min ||
      form.altitudeStepKm > L.altitudeStepKm.max
    ) {
      errors.push(`高度刻みは ${L.altitudeStepKm.min}–${L.altitudeStepKm.max} km の範囲で指定してください`);
    }
  }

  if (form.restrictInclination) {
    const okIncMin = requireNumber(form.inclinationMinDeg, "傾斜角下限");
    const okIncMax = requireNumber(form.inclinationMaxDeg, "傾斜角上限");
    if (okIncMin && okIncMax) {
      if (form.inclinationMinDeg > form.inclinationMaxDeg) {
        errors.push("傾斜角下限は傾斜角上限以下にしてください");
      }
      if (
        form.inclinationMinDeg < L.inclinationDeg.min ||
        form.inclinationMaxDeg > L.inclinationDeg.max
      ) {
        errors.push("傾斜角は 0–180° の範囲で指定してください");
      }
    }
  }

  if (form.objective === "fixedBudget" && requireNumber(form.satelliteBudget, "衛星数上限")) {
    if (
      !Number.isInteger(form.satelliteBudget) ||
      form.satelliteBudget < L.satelliteBudget.min ||
      form.satelliteBudget > L.satelliteBudget.max
    ) {
      errors.push(
        `衛星数上限は ${L.satelliteBudget.min}–${L.satelliteBudget.max} の整数で指定してください`,
      );
    }
  }

  if (requireNumber(form.topK, "検証件数 K")) {
    if (!Number.isInteger(form.topK) || form.topK < L.topK.min || form.topK > L.topK.max) {
      errors.push(`検証件数 K は ${L.topK.min}–${L.topK.max} の整数で指定してください`);
    }
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Shell → form (redesign)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Recovers the wizard form from a shell's `mission_*` provenance fields.
 * Anything missing or unparsable falls back to `DEFAULT_MISSION_FORM`, so a
 * hand-edited TOML file cannot put the wizard into an invalid state.
 *
 * For a `fixedBudget` shell the budget is taken from the shell's own `count`:
 * the budget itself is not part of the `mission_*` schema.
 */
export function constraintsFromShell(shell: Partial<ConstellationShell>): MissionDesignForm {
  const form: MissionDesignForm = { ...DEFAULT_MISSION_FORM };

  if (isMissionObjectiveKind(shell.mission_objective)) {
    form.objective = shell.mission_objective;
  }
  if (isFiniteNumber(shell.mission_min_elevation)) {
    form.minElevationDeg = shell.mission_min_elevation;
  }
  if (isFiniteNumber(shell.mission_fold)) {
    form.fold = clampFold(shell.mission_fold);
  }
  if (shell.mission_region === "latitudeBand") {
    form.region = "latitudeBand";
    // A global run stores ±90; only a band's bounds are meaningful here.
    if (isFiniteNumber(shell.mission_lat_min)) form.latMinDeg = shell.mission_lat_min;
    if (isFiniteNumber(shell.mission_lat_max)) form.latMaxDeg = shell.mission_lat_max;
  }
  if (isFiniteNumber(shell.mission_alt_min)) form.altitudeMinKm = shell.mission_alt_min;
  if (isFiniteNumber(shell.mission_alt_max)) form.altitudeMaxKm = shell.mission_alt_max;
  if (form.objective === "fixedBudget" && isFiniteNumber(shell.count) && shell.count > 0) {
    form.satelliteBudget = Math.round(shell.count);
  }

  return form;
}

/**
 * Folds a `relaxationSuggestions` result back into the form so the wizard's
 * inputs show what was relaxed. Only the fields those suggestions touch are
 * copied; everything else (objective, K, family, …) is preserved.
 */
export function applyRelaxedConstraints(
  form: MissionDesignForm,
  relaxed: DesignConstraints,
): MissionDesignForm {
  const band = relaxed.region.kind === "latitudeBand" ? relaxed.region : null;
  return {
    ...form,
    minElevationDeg: relaxed.minElevationDeg,
    fold: relaxed.fold,
    region: relaxed.region.kind,
    latMinDeg: band && isFiniteNumber(band.latMinDeg) ? band.latMinDeg : form.latMinDeg,
    latMaxDeg: band && isFiniteNumber(band.latMaxDeg) ? band.latMaxDeg : form.latMaxDeg,
    altitudeMinKm: relaxed.altitudeMinKm,
    altitudeMaxKm: relaxed.altitudeMaxKm,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate presentation                                                     */
/* -------------------------------------------------------------------------- */

/** Name given to a shell added from the wizard, e.g. `設計案 WΔ 84/7/3`. */
export function designShellName(shell: ConstellationShell): string {
  const label = PATTERN_SHORT_LABELS[patternIdOf(shell)];
  const third =
    shell.pattern === "streets_of_coverage"
      ? `S${shell.soc_sats_per_plane ?? "-"}`
      : `${Number((shell.phasing ?? 0).toFixed(2))}`;
  return `設計案 ${label} ${shell.count}/${shell.planes}/${third}`;
}

/** Availability actually measured for a candidate (verified beats screened). */
export function candidateAvailability(candidate: DesignCandidate): number | null {
  if (candidate.verified) return candidate.verified.foldAvailability;
  if (candidate.screen) return candidate.screen.foldAvailability;
  return null;
}

export type MissionRunPhase =
  | "idle"
  | "enumerating"
  | "verifying"
  | "done"
  | "error"
  | "cancelled"
  | "empty";

export type CandidateStatus =
  | "unverified"
  | "verifying"
  | "verifiedOk"
  | "attention"
  | "verifiedNg"
  | "cancelled";

/** Screen-vs-verify gap beyond which the row is flagged 要注意. */
export const SCREEN_VERIFY_GAP_WARN = 0.05;

/**
 * Status badge for one row. `verified` decides everything once it exists;
 * before that the badge only says whether the candidate is in flight, which is
 * why it depends on the run phase.
 */
export function candidateStatus(candidate: DesignCandidate, phase: MissionRunPhase): CandidateStatus {
  const { verified, screen } = candidate;
  if (verified) {
    if (!candidate.feasible) return "verifiedNg";
    if (screen && Math.abs(screen.foldAvailability - verified.foldAvailability) > SCREEN_VERIFY_GAP_WARN) {
      return "attention";
    }
    return "verifiedOk";
  }
  if (phase === "cancelled") return "cancelled";
  if (phase === "verifying" && screen) return "verifying";
  return "unverified";
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

function compareByCountThenAltitude(a: DesignCandidate, b: DesignCandidate): number {
  if (a.parameters.totalSatellites !== b.parameters.totalSatellites) {
    return a.parameters.totalSatellites - b.parameters.totalSatellites;
  }
  if (a.parameters.altitudeKm !== b.parameters.altitudeKm) {
    return a.parameters.altitudeKm - b.parameters.altitudeKm;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function compareByAvailability(a: DesignCandidate, b: DesignCandidate): number {
  const da = (candidateAvailability(b) ?? -1) - (candidateAvailability(a) ?? -1);
  if (Math.abs(da) > 1e-12) return da;
  return compareByCountThenAltitude(a, b);
}

/**
 * Display order for the candidate table. Verified rows sort ahead of
 * unevaluated ones within the same objective so the interesting rows stay at
 * the top while hundreds of analytic Star candidates fill the tail.
 */
export function sortCandidatesForDisplay(
  candidates: DesignCandidate[],
  objective: MissionObjectiveKind,
): DesignCandidate[] {
  // Verified-and-feasible rows lead; verified-but-infeasible ("NG") rows follow
  // them so the recommended design is never buried under same-T near misses.
  const rank = (c: DesignCandidate) =>
    c.verified ? (c.feasible ? 0 : 1) : c.screen ? 2 : 3;
  const primary =
    objective === "fixedBudget" ? compareByAvailability : compareByCountThenAltitude;
  return [...candidates].sort((a, b) => {
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return primary(a, b);
  });
}

/**
 * Keys of rows dominated in the (satellite count, altitude) plane — another row
 * is no worse on both axes and strictly better on one. Only *evaluated and
 * feasible* rows compete: an unscreened analytic candidate has no established
 * coverage, so calling it dominated would be a claim the engine never made.
 */
export function dominatedCandidateKeys(candidates: DesignCandidate[]): Set<string> {
  const pool = candidates.filter((c) => c.feasible && (c.verified || c.screen));
  const dominated = new Set<string>();
  for (const candidate of pool) {
    for (const other of pool) {
      if (other.key === candidate.key) continue;
      const dt = other.parameters.totalSatellites - candidate.parameters.totalSatellites;
      const dh = other.parameters.altitudeKm - candidate.parameters.altitudeKm;
      if (dt <= 0 && dh <= 0 && (dt < 0 || dh < 0)) {
        dominated.add(candidate.key);
        break;
      }
    }
  }
  return dominated;
}

/**
 * Extra relaxation for the `fixedBudget` objective, which `relaxationSuggestions`
 * (constraints-only) cannot express: raise the satellite budget to the smallest
 * analytic candidate that exists for these constraints, or — when nothing was
 * enumerated — to the cap-area lower bound at the highest allowed altitude.
 * Returns null when the current budget is already at/above that figure.
 */
export function budgetSuggestion(
  form: MissionDesignForm,
  constraints: DesignConstraints,
  analyticCandidates: readonly DesignCandidate[],
): { label: string; form: MissionDesignForm } | null {
  if (form.objective !== "fixedBudget") return null;
  const budget = Math.round(form.satelliteBudget);
  let target = Number.POSITIVE_INFINITY;
  for (const c of analyticCandidates) {
    if (c.feasible === false && c.rejectionReason) continue;
    target = Math.min(target, c.parameters.totalSatellites);
  }
  if (!Number.isFinite(target)) {
    if (!(constraints.altitudeMaxKm > 0)) return null;
    const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
    const theta = earthCentralAngleRad(
      constraints.altitudeMaxKm,
      (Math.max(0, constraints.minElevationDeg) * Math.PI) / 180,
    );
    target = capAreaLowerBoundCount(bandAreaFraction(latMinDeg, latMaxDeg), theta, constraints.fold);
  }
  if (!Number.isFinite(target) || target <= budget) return null;
  return {
    label: `衛星数上限を ${budget} → ${target} 機に引き上げ`,
    form: { ...form, satelliteBudget: target },
  };
}
