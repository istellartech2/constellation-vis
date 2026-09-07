/**
 * Orchestration: analytic sizing → coarse screening → ranking → SGP4 verification
 * → re-ranking.
 *
 * `enumerateAnalytic` is the instant, closed-form half (Walker Star sizing) that
 * the wizard can show before any propagation happens. `runDesign` is the whole
 * pipeline and is what the Worker calls.
 *
 * The screening gate is `continuousThreshold - SCREEN_THRESHOLD_MARGIN`: the
 * coarse pass uses the spherical predicate, which under-reports coverage at LEO,
 * so gating it at the full threshold would discard candidates that verify.
 */
import { degToRad } from "../constellationPatterns/coverageGeometry";
import {
  createScreenBudget,
  enumerateDeltaCandidates,
  type ScreenBudget,
} from "./deltaSizing";
import { screenCandidate } from "./screen";
import { enumerateStarCandidates } from "./starSizing";
import {
  DEFAULT_CONTINUOUS_THRESHOLD,
  DEFAULT_TOP_K,
  SCREEN_THRESHOLD_MARGIN,
  regionLatitudeBounds,
  type AnalyticMetrics,
  type CandidateParameters,
  type DesignCandidate,
  type DesignObjective,
  type DesignRequest,
  type DesignResult,
  type PatternFamily,
} from "./types";
import { verifyCandidate } from "./verify";

/** Screens attempted per (altitude, sizing-method) Star group before moving on. */
const MAX_STAR_SCREENS_PER_GROUP = 6;
/** Upper bound on verifications for the Pareto objective (one per altitude group). */
const MAX_PARETO_VERIFICATIONS = 24;

export interface DesignProgress {
  phase: "screen" | "verify";
  done: number;
  total: number;
  message?: string;
}

export interface DesignHooks {
  onProgress?: (progress: DesignProgress) => void;
  /** Called for each candidate as soon as it has been screened or verified. */
  onPartial?: (candidate: DesignCandidate) => void;
  shouldAbort?: () => boolean;
  /** Awaited between units of work so a Worker can flush messages. */
  yieldNow?: () => Promise<void>;
}

/**
 * Rejects a request carrying the reserved `isl` hook rather than quietly
 * ignoring it — a caller that set it believes the constellation is being
 * optimized for inter-satellite connectivity, and it is not.
 */
export function assertSupportedRequest(request: DesignRequest): void {
  const { altitudeMinKm, altitudeMaxKm } = request.constraints;
  if (!(altitudeMinKm > 0) || !(altitudeMaxKm >= altitudeMinKm)) {
    throw new Error(
      `高度範囲が不正です(下限 ${altitudeMinKm} km, 上限 ${altitudeMaxKm} km)。下限は 0 より大きく、上限は下限以上にしてください。`,
    );
  }
  if ((request.constraints as { isl?: unknown }).isl !== undefined) {
    throw new Error(
      "constraints.isl は未対応です(Phase 2 の最適化エンジンは ISL 制約を扱いません)。制約から isl を外して実行してください。",
    );
  }
}

function resolveFamilies(request: DesignRequest): PatternFamily[] {
  const requested = request.constraints.families;
  if (requested && requested.length > 0) return requested;
  return ["walkerDelta", "walkerStar"];
}

export function continuousThresholdOf(request: DesignRequest): number {
  return request.constraints.continuousThreshold ?? DEFAULT_CONTINUOUS_THRESHOLD;
}

export function screenThresholdOf(request: DesignRequest): number {
  return Math.max(0, continuousThresholdOf(request) - SCREEN_THRESHOLD_MARGIN);
}

/**
 * Closed-form candidates only. Star sizing is the entire analytic stage: Walker
 * Delta has no closed form for minimum count, so it contributes nothing here.
 */
export function enumerateAnalytic(request: DesignRequest): {
  analyticCandidates: DesignCandidate[];
  rejected: DesignCandidate[];
  warnings: string[];
} {
  assertSupportedRequest(request);
  const families = resolveFamilies(request);
  if (!families.includes("walkerStar")) {
    return { analyticCandidates: [], rejected: [], warnings: [] };
  }
  const star = enumerateStarCandidates(request);
  return {
    analyticCandidates: star.candidates,
    rejected: star.rejected,
    warnings: star.warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

function availabilityOf(candidate: DesignCandidate): number {
  return candidate.verified?.foldAvailability ?? candidate.screen?.foldAvailability ?? 0;
}

function minFoldOf(candidate: DesignCandidate): number {
  return candidate.verified?.minFold ?? candidate.screen?.minFold ?? 0;
}

function aspectPenalty(parameters: CandidateParameters): number {
  return Math.abs(parameters.planes - Math.sqrt(parameters.totalSatellites));
}

function altitudeGroupKey(candidate: DesignCandidate): string {
  return candidate.parameters.altitudeKm.toFixed(1);
}

function compareMinSatellites(a: DesignCandidate, b: DesignCandidate): number {
  if (a.parameters.totalSatellites !== b.parameters.totalSatellites) {
    return a.parameters.totalSatellites - b.parameters.totalSatellites;
  }
  if (a.parameters.altitudeKm !== b.parameters.altitudeKm) {
    return a.parameters.altitudeKm - b.parameters.altitudeKm;
  }
  return aspectPenalty(a.parameters) - aspectPenalty(b.parameters);
}

function compareCoverage(a: DesignCandidate, b: DesignCandidate): number {
  const da = availabilityOf(b) - availabilityOf(a);
  if (Math.abs(da) > 1e-12) return da;
  const df = minFoldOf(b) - minFoldOf(a);
  if (df !== 0) return df;
  return a.parameters.totalSatellites - b.parameters.totalSatellites;
}

/** Best feasible candidate per altitude group, for the Pareto objective. */
function paretoSelection(candidates: DesignCandidate[]): DesignCandidate[] {
  const byAltitude = new Map<string, DesignCandidate>();
  for (const candidate of candidates) {
    if (!candidate.feasible) continue;
    const key = altitudeGroupKey(candidate);
    const current = byAltitude.get(key);
    if (!current) {
      byAltitude.set(key, candidate);
      continue;
    }
    if (candidate.parameters.totalSatellites < current.parameters.totalSatellites) {
      byAltitude.set(key, candidate);
      continue;
    }
    if (candidate.parameters.totalSatellites > current.parameters.totalSatellites) continue;
    const da = availabilityOf(candidate) - availabilityOf(current);
    if (da > 1e-12) {
      byAltitude.set(key, candidate);
      continue;
    }
    if (da < -1e-12) continue;
    if (aspectPenalty(candidate.parameters) < aspectPenalty(current.parameters)) {
      byAltitude.set(key, candidate);
    }
  }
  return [...byAltitude.values()].sort((a, b) => a.parameters.altitudeKm - b.parameters.altitudeKm);
}

/**
 * Applies the objective's ranking to a screened (or verified) candidate list and
 * returns at most `topK` entries. Exported so the re-ranking after verification
 * uses exactly the same rules as the pre-ranking.
 */
export function rankCandidates(
  candidates: DesignCandidate[],
  objective: DesignObjective,
  topK: number,
): DesignCandidate[] {
  if (objective.kind === "paretoCountVsAltitude") {
    return paretoSelection(candidates).slice(0, MAX_PARETO_VERIFICATIONS);
  }
  if (objective.kind === "fixedBudget") {
    // `T ≤ budget`, never `T == budget`: a prime budget has almost no valid
    // (P, S) factorization, so equality would return an empty list.
    return candidates
      .filter((c) => c.parameters.totalSatellites <= objective.satelliteBudget)
      .sort(compareCoverage)
      .slice(0, topK);
  }
  return candidates
    .filter((c) => c.feasible)
    .sort(compareMinSatellites)
    .slice(0, topK);
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

interface StarGroup {
  key: string;
  members: DesignCandidate[];
}

function groupStarCandidates(
  candidates: DesignCandidate[],
  objective: DesignObjective,
): StarGroup[] {
  const groups = new Map<string, DesignCandidate[]>();
  for (const candidate of candidates) {
    const key = `${altitudeGroupKey(candidate)}|${candidate.analytic.sizingMethod}`;
    const list = groups.get(key);
    if (list) list.push(candidate);
    else groups.set(key, [candidate]);
  }
  const out: StarGroup[] = [];
  for (const [key, members] of groups) {
    if (objective.kind === "fixedBudget") {
      // Maximizing coverage within a budget wants the *largest* affordable T.
      members.sort((a, b) => b.parameters.totalSatellites - a.parameters.totalSatellites);
      out.push({
        key,
        members: members.filter((c) => c.parameters.totalSatellites <= objective.satelliteBudget),
      });
    } else {
      members.sort((a, b) => a.parameters.totalSatellites - b.parameters.totalSatellites);
      out.push({ key, members });
    }
  }
  return out.filter((g) => g.members.length > 0);
}

export async function runDesign(
  request: DesignRequest,
  hooks: DesignHooks = {},
): Promise<DesignResult> {
  assertSupportedRequest(request);

  const constraints = request.constraints;
  const families = resolveFamilies(request);
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
  const threshold = continuousThresholdOf(request);
  const screenThreshold = screenThresholdOf(request);
  const topK = request.topK ?? DEFAULT_TOP_K;
  const epoch = new Date(request.epochIso);
  if (Number.isNaN(epoch.getTime())) {
    throw new Error(`epochIso が不正です: ${request.epochIso}`);
  }

  const warnings: string[] = [];
  const rejected: DesignCandidate[] = [];
  let screenMs = 0;
  let verifyMs = 0;
  let screenedCount = 0;

  const budget: ScreenBudget = createScreenBudget();
  const screen = (parameters: CandidateParameters, analytic: AnalyticMetrics) => {
    const started = performance.now();
    const metrics = screenCandidate(parameters, {
      centralAngleRad: degToRad(analytic.centralAngleDeg),
      minElevationRad: degToRad(constraints.minElevationDeg),
      fold: constraints.fold,
      latMinDeg,
      latMaxDeg,
    });
    screenMs += performance.now() - started;
    screenedCount++;
    return metrics;
  };

  // --- stage 1a: analytic Star sizing ---------------------------------------
  const analytic = enumerateAnalytic(request);
  warnings.push(...analytic.warnings);
  rejected.push(...analytic.rejected);
  const analyticCandidates = analytic.analyticCandidates;

  const screened: DesignCandidate[] = [];

  // --- stage 1b: screen the most promising Star candidates ------------------
  if (families.includes("walkerStar") && analyticCandidates.length > 0) {
    const groups = groupStarCandidates(analyticCandidates, request.objective);
    let done = 0;
    for (const group of groups) {
      if (hooks.shouldAbort?.()) break;
      let attempts = 0;
      for (const candidate of group.members) {
        if (attempts >= MAX_STAR_SCREENS_PER_GROUP) break;
        if (budget.used >= budget.total) {
          budget.exhausted = true;
          break;
        }
        attempts++;
        const metrics = screen(candidate.parameters, candidate.analytic);
        budget.used++;
        candidate.screen = metrics;
        candidate.feasible = metrics.foldAvailability >= screenThreshold;
        if (!candidate.feasible) candidate.rejectionReason = "belowThreshold";
        screened.push(candidate);
        hooks.onPartial?.(candidate);
        if (candidate.feasible && request.objective.kind !== "fixedBudget") break;
        if (request.objective.kind === "fixedBudget") break;
      }
      done++;
      hooks.onProgress?.({ phase: "screen", done, total: groups.length, message: "Walker Star" });
      await hooks.yieldNow?.();
    }
  }

  // --- stage 1b: Walker Delta search ---------------------------------------
  let deltaCount = 0;
  if (families.includes("walkerDelta") && !hooks.shouldAbort?.()) {
    const deltaResult = await enumerateDeltaCandidates(request, {
      screen,
      screenThreshold,
      budget,
      warnings,
      onCandidate: (candidate) => hooks.onPartial?.(candidate),
      shouldAbort: hooks.shouldAbort,
      yieldNow: hooks.yieldNow,
    });
    deltaCount = deltaResult.candidates.length;
    screened.push(...deltaResult.candidates);
    rejected.push(...deltaResult.rejected);
    hooks.onProgress?.({ phase: "screen", done: 1, total: 1, message: "Walker Delta" });
  }

  warnings.push(
    "Walker Delta の最小衛星数は列挙格子上の最小値です(高度・傾斜角・T の探索格子に依存します)。",
  );

  // --- stage 2: verify the ranked shortlist ---------------------------------
  const shortlist = rankCandidates(screened, request.objective, topK);
  let verifiedCount = 0;
  for (let i = 0; i < shortlist.length; i++) {
    if (hooks.shouldAbort?.()) break;
    const candidate = shortlist[i];
    const started = performance.now();
    candidate.verified = verifyCandidate(candidate.parameters, candidate.analytic, {
      epoch,
      minElevationDeg: constraints.minElevationDeg,
      fold: constraints.fold,
      latMinDeg,
      latMaxDeg,
      fidelity: request.fidelity,
    });
    verifyMs += performance.now() - started;
    verifiedCount++;
    candidate.feasible = candidate.verified.foldAvailability >= threshold;
    candidate.rejectionReason = candidate.feasible ? undefined : "belowThreshold";
    hooks.onPartial?.(candidate);
    hooks.onProgress?.({ phase: "verify", done: i + 1, total: shortlist.length });
    await hooks.yieldNow?.();
  }

  // --- re-rank on verified metrics ------------------------------------------
  // Infeasible verified candidates are kept (`feasible: false`) so the UI can
  // show "screened well, failed verification" instead of an empty table.
  const verified = shortlist.filter((c) => c.verified);
  const ranked =
    request.objective.kind === "minSatellites"
      ? [...verified].sort((a, b) => {
          if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
          return compareMinSatellites(a, b);
        })
      : request.objective.kind === "fixedBudget"
        ? [...verified].sort(compareCoverage)
        : [...verified].sort((a, b) => a.parameters.altitudeKm - b.parameters.altitudeKm);

  const candidates = ranked.length > 0 ? ranked : shortlist;
  const best = candidates.find((c) => c.feasible) ?? candidates[0];

  return {
    request,
    analyticCandidates,
    candidates,
    best,
    diagnostics: {
      // Star candidates appear in both `analyticCandidates` and `screened`, so
      // they are counted once here and the Delta total is added separately.
      generatedCount: analyticCandidates.length + deltaCount + rejected.length,
      prefilteredCount: rejected.length,
      screenedCount,
      verifiedCount,
      screenMs,
      verifyMs,
      warnings,
    },
  };
}
