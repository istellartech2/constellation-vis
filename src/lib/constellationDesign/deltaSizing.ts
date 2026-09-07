/**
 * Walker Delta candidate generation.
 *
 * Unlike the Star family there is no closed form for "the smallest T that covers
 * the region", so Delta candidates have to be found by screening. The plan's
 * literal recipe — walk T upward one at a time from the cap-area bound, trying
 * every divisor P and every F — is not affordable: for a global 25° single-fold
 * request the bound is ~185, the first feasible T is 1.5–2.5× that, and
 * σ(T) ≈ 2.5·T phasing/shape combinations per T at ~1.3 ms each works out to
 * minutes of screening per (altitude, inclination) cell.
 *
 * What runs instead, and why it lands on the same answer:
 *  - **Warm start down the altitude axis.** For a fixed inclination, a higher
 *    altitude has a strictly larger θ, so its feasible set is a superset:
 *    T_min is non-increasing in h. Altitudes are therefore visited high-to-low
 *    and each cell starts its walk just below the previous cell's answer.
 *  - **Geometric ladder then bisection.** T is probed at ×1.15 steps until the
 *    first feasible value, then bisected back down towards the last infeasible
 *    one. The result is the smallest *probed* T, which the diagnostics say out
 *    loud.
 *  - **Composite snapping.** Each probe is nudged up to the most composite value
 *    within +3, so a prime T (which has almost no valid P) cannot masquerade as
 *    an infeasible one.
 *  - **Shape and phasing ordering.** Only one (P, F) needs to succeed to prove a
 *    T feasible, so shapes are tried with P nearest √T first and F starting at
 *    round(P/2); F is enumerated exhaustively only for P ≤ 6.
 *  - **A screening budget.** Per cell and overall, with a `diagnostics.warnings`
 *    entry when it binds.
 */
import {
  bandAreaFraction,
  capAreaLowerBoundCount,
  degToRad,
  earthCentralAngleDeg,
  footprintRadiusKm,
  nadirLatencyMs,
  oneWayLatencyMs,
  orbitalPeriodSec,
  slantRangeAtElevationKm,
} from "../constellationPatterns/coverageGeometry";
import { altitudeSamplesForInclination, deltaInclinationSetDeg, resolveInclinationRange } from "./searchGrid";
import {
  DEFAULT_MAX_PLANES,
  DEFAULT_MAX_SATS_PER_PLANE,
  DEFAULT_SCREEN_BUDGET_PER_CELL,
  DEFAULT_SCREEN_BUDGET_TOTAL,
  regionLatitudeBounds,
  regionMaxAbsLatitudeDeg,
  type AnalyticMetrics,
  type CandidateParameters,
  type DesignCandidate,
  type DesignConstraints,
  type DesignRequest,
  type ScreenMetrics,
} from "./types";

/** Ratio between successive rungs of the T ladder. */
const T_LADDER_RATIO = 1.15;
/** How far above a probe T the composite snap may look. */
const COMPOSITE_SNAP_SPAN = 3;
/** Shapes (P, S) tried per T before giving up on it. */
const MAX_SHAPES_PER_T = 4;
/** Bisection probes after the ladder brackets the answer. */
const MAX_BISECTION_PROBES = 7;
/** Cap on T relative to the cap-area lower bound. */
const T_CAP_MULTIPLE = 3;
/** Fraction of the previous altitude's answer a warm-started walk restarts from. */
const WARM_START_FACTOR = 0.95;
/** Same, across adjacent inclinations (not monotone, but tight in practice). */
const CROSS_INCLINATION_WARM_FACTOR = 0.85;
/** Probes used for the fixed-budget objective, walking T down from the budget. */
const FIXED_BUDGET_PROBES = 8;

export interface ScreenBudget {
  total: number;
  perCell: number;
  used: number;
  /** The *overall* budget ran out — the search stopped early everywhere. */
  exhausted: boolean;
  /** Number of (altitude, inclination) cells that hit only their own per-cell cap. */
  truncatedCells: number;
}

export function createScreenBudget(total?: number, perCell?: number): ScreenBudget {
  return {
    total: total ?? DEFAULT_SCREEN_BUDGET_TOTAL,
    perCell: perCell ?? DEFAULT_SCREEN_BUDGET_PER_CELL,
    used: 0,
    exhausted: false,
    truncatedCells: 0,
  };
}

export interface DeltaSearchHooks {
  screen: (parameters: CandidateParameters, analytic: AnalyticMetrics) => ScreenMetrics;
  /** Availability a screened candidate must reach to count as feasible. */
  screenThreshold: number;
  budget: ScreenBudget;
  warnings: string[];
  onCandidate?: (candidate: DesignCandidate) => void;
  shouldAbort?: () => boolean;
  /** Awaited between cells so a Worker can flush progress messages. */
  yieldNow?: () => Promise<void>;
}

export interface DeltaSearchResult {
  candidates: DesignCandidate[];
  rejected: DesignCandidate[];
}

export function deltaCandidateKey(parameters: CandidateParameters): string {
  return [
    "wd",
    `T${parameters.totalSatellites}`,
    `P${parameters.planes}`,
    `F${parameters.phasingF}`,
    `h${parameters.altitudeKm.toFixed(1)}`,
    `i${parameters.inclinationDeg.toFixed(2)}`,
  ].join("-");
}

/* -------------------------------------------------------------------------- */
/* Shape and phasing enumeration                                              */
/* -------------------------------------------------------------------------- */

export interface DeltaShape {
  planes: number;
  satsPerPlane: number;
}

/**
 * Every structurally valid (P, S) factorization of `T` (prefilter P3), ordered
 * with P nearest √T first — the aspect ratio real Walker constellations use, and
 * the tiebreak the ranking applies later.
 */
export function deltaShapesForT(
  totalSatellites: number,
  maxPlanes: number,
  maxSatsPerPlane: number,
): DeltaShape[] {
  const shapes: DeltaShape[] = [];
  for (let p = 1; p * p <= totalSatellites; p++) {
    if (totalSatellites % p !== 0) continue;
    const q = totalSatellites / p;
    if (p <= maxPlanes && q <= maxSatsPerPlane) shapes.push({ planes: p, satsPerPlane: q });
    if (q !== p && q <= maxPlanes && p <= maxSatsPerPlane) {
      shapes.push({ planes: q, satsPerPlane: p });
    }
  }
  const target = Math.sqrt(totalSatellites);
  shapes.sort((a, b) => Math.abs(a.planes - target) - Math.abs(b.planes - target));
  return shapes;
}

/**
 * Phasing values to try for `P` planes, most promising first. Walker's F is
 * exhaustively searched for small P; above that only the half-plane stagger and
 * its neighbours plus the degenerate 0/1/P-1 are worth the milliseconds.
 */
export function deltaPhasingCandidates(planes: number): number[] {
  if (planes <= 6) {
    const all: number[] = [];
    const half = Math.round(planes / 2) % planes;
    all.push(half);
    for (let f = 0; f < planes; f++) if (f !== half) all.push(f);
    return all;
  }
  const half = Math.round(planes / 2);
  const raw = [half, half + 1, half - 1, 0, 1, planes - 1];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const f of raw) {
    const v = ((f % planes) + planes) % planes;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Nudges a probe up to the value in `[t, min(t + span, maxT)]` with the most
 * usable (P, S) factorizations. Without this a prime probe reads as infeasible
 * purely for lack of shapes and the bisection converges on the wrong side.
 */
export function snapToComposite(
  t: number,
  maxT: number,
  maxPlanes: number,
  maxSatsPerPlane: number,
  span = COMPOSITE_SNAP_SPAN,
): number {
  let best = t;
  let bestShapes = -1;
  const limit = Math.min(t + span, maxT);
  for (let candidate = t; candidate <= limit; candidate++) {
    const n = deltaShapesForT(candidate, maxPlanes, maxSatsPerPlane).length;
    if (n > bestShapes) {
      bestShapes = n;
      best = candidate;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

interface CellContext {
  altitudeKm: number;
  inclinationDeg: number;
  thetaDeg: number;
  capBound: number;
  repeatOrbits?: number;
  repeatDays?: number;
  analytic: AnalyticMetrics;
  maxPlanes: number;
  maxSatsPerPlane: number;
}

interface ProbeResult {
  feasible: boolean;
  candidate: DesignCandidate | null;
  /** True when the probe gave up on the screening budget rather than on coverage. */
  budgetStop: boolean;
}

interface CellUsage {
  count: number;
  truncated: boolean;
}

function makeAnalytic(
  altitudeKm: number,
  constraints: DesignConstraints,
  thetaDeg: number,
): AnalyticMetrics {
  const epsRad = degToRad(constraints.minElevationDeg);
  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
  const slant = slantRangeAtElevationKm(altitudeKm, epsRad);
  return {
    centralAngleDeg: thetaDeg,
    footprintRadiusKm: footprintRadiusKm(altitudeKm, epsRad),
    capAreaLowerBoundCount: capAreaLowerBoundCount(
      bandAreaFraction(latMinDeg, latMaxDeg),
      degToRad(thetaDeg),
      constraints.fold,
    ),
    slantRangeAtEpsilonKm: slant,
    latencyAtEpsilonMs: oneWayLatencyMs(slant),
    latencyNadirMs: nadirLatencyMs(altitudeKm),
    orbitalPeriodSec: orbitalPeriodSec(altitudeKm),
    sizingMethod: "enumerated",
  };
}

function buildParameters(cell: CellContext, shape: DeltaShape, phasingF: number): CandidateParameters {
  return {
    family: "walkerDelta",
    totalSatellites: shape.planes * shape.satsPerPlane,
    planes: shape.planes,
    satsPerPlane: shape.satsPerPlane,
    phasingF,
    altitudeKm: cell.altitudeKm,
    inclinationDeg: cell.inclinationDeg,
    repeatOrbits: cell.repeatOrbits,
    repeatDays: cell.repeatDays,
    kernelFastPath: true,
  };
}

/**
 * Screens the shapes of one T until something clears `screenThreshold`. Only one
 * shape has to succeed for T to be feasible, so this returns as soon as it does;
 * otherwise it returns the best-scoring shape it managed to screen.
 */
function probeT(
  cell: CellContext,
  totalSatellites: number,
  hooks: DeltaSearchHooks,
  cellUsed: CellUsage,
): ProbeResult {
  const shapes = deltaShapesForT(totalSatellites, cell.maxPlanes, cell.maxSatsPerPlane).slice(
    0,
    MAX_SHAPES_PER_T,
  );
  let best: DesignCandidate | null = null;
  let bestAvailability = -1;

  for (const shape of shapes) {
    for (const phasingF of deltaPhasingCandidates(shape.planes)) {
      if (hooks.budget.used >= hooks.budget.total) {
        hooks.budget.exhausted = true;
        return { feasible: false, candidate: best, budgetStop: true };
      }
      if (cellUsed.count >= hooks.budget.perCell) {
        cellUsed.truncated = true;
        return { feasible: false, candidate: best, budgetStop: true };
      }
      if (hooks.shouldAbort?.()) return { feasible: false, candidate: best, budgetStop: true };

      const parameters = buildParameters(cell, shape, phasingF);
      const screen = hooks.screen(parameters, cell.analytic);
      hooks.budget.used++;
      cellUsed.count++;

      const candidate: DesignCandidate = {
        key: deltaCandidateKey(parameters),
        parameters,
        analytic: cell.analytic,
        screen,
        feasible: false,
      };
      if (screen.foldAvailability > bestAvailability) {
        bestAvailability = screen.foldAvailability;
        best = candidate;
      }
      if (screen.foldAvailability >= hooks.screenThreshold) {
        return { feasible: true, candidate, budgetStop: false };
      }
    }
  }
  return { feasible: false, candidate: best, budgetStop: false };
}

/** Smallest probed T that screens feasible in this cell, or the best near-miss. */
function searchMinimumT(
  cell: CellContext,
  startT: number,
  hooks: DeltaSearchHooks,
): { feasible: DesignCandidate | null; nearMiss: DesignCandidate | null } {
  const cellUsed: CellUsage = { count: 0, truncated: false };
  const capT = Math.max(startT, Math.ceil(T_CAP_MULTIPLE * cell.capBound));
  let lastInfeasible = startT - 1;
  let feasible: DesignCandidate | null = null;
  let nearMiss: DesignCandidate | null = null;

  let t = snapToComposite(startT, capT, cell.maxPlanes, cell.maxSatsPerPlane);
  while (t <= capT) {
    const probe = probeT(cell, t, hooks, cellUsed);
    if (probe.candidate && (!nearMiss || (probe.candidate.screen?.foldAvailability ?? 0) > (nearMiss.screen?.foldAvailability ?? 0))) {
      nearMiss = probe.candidate;
    }
    if (probe.feasible) {
      feasible = probe.candidate;
      break;
    }
    if (probe.budgetStop || hooks.shouldAbort?.()) break;
    // Only a probe that actually screened every shape proves T infeasible; a
    // budget-truncated probe must not move the bisection's lower bracket.
    lastInfeasible = t;
    const next = snapToComposite(
      Math.max(t + 1, Math.ceil(t * T_LADDER_RATIO)),
      capT,
      cell.maxPlanes,
      cell.maxSatsPerPlane,
    );
    if (next <= t) break;
    t = next;
  }

  if (!feasible) {
    if (cellUsed.truncated) hooks.budget.truncatedCells++;
    return { feasible: null, nearMiss };
  }

  // Bisect back down between the last known infeasible T and the first feasible.
  let loT = lastInfeasible;
  let hiT = feasible.parameters.totalSatellites;
  for (let probeIndex = 0; probeIndex < MAX_BISECTION_PROBES && hiT - loT > 1; probeIndex++) {
    if (hooks.budget.exhausted || hooks.shouldAbort?.()) break;
    const mid = snapToComposite(
      Math.floor((loT + hiT) / 2),
      hiT - 1,
      cell.maxPlanes,
      cell.maxSatsPerPlane,
    );
    if (mid <= loT || mid >= hiT) break;
    const probe = probeT(cell, mid, hooks, cellUsed);
    if (probe.feasible && probe.candidate) {
      feasible = probe.candidate;
      hiT = mid;
    } else {
      if (probe.candidate && (!nearMiss || (probe.candidate.screen?.foldAvailability ?? 0) > (nearMiss.screen?.foldAvailability ?? 0))) {
        nearMiss = probe.candidate;
      }
      if (probe.budgetStop) break;
      loT = mid;
    }
  }

  if (cellUsed.truncated) hooks.budget.truncatedCells++;
  return { feasible, nearMiss };
}

/** Best candidate with `T ≤ budget`, feasible or not (objective `fixedBudget`). */
function searchFixedBudget(
  cell: CellContext,
  satelliteBudget: number,
  hooks: DeltaSearchHooks,
): DesignCandidate | null {
  const cellUsed: CellUsage = { count: 0, truncated: false };
  let best: DesignCandidate | null = null;
  const seen = new Set<number>();
  for (let k = 0; k < FIXED_BUDGET_PROBES; k++) {
    if (hooks.budget.exhausted || hooks.shouldAbort?.()) break;
    const raw = Math.floor(satelliteBudget * (1 - k * 0.06));
    if (raw < 2) break;
    // Snap *down* here: T must not exceed the budget.
    let t = raw;
    let bestShapes = -1;
    for (let c = Math.max(2, raw - COMPOSITE_SNAP_SPAN); c <= raw; c++) {
      const n = deltaShapesForT(c, cell.maxPlanes, cell.maxSatsPerPlane).length;
      if (n > bestShapes) {
        bestShapes = n;
        t = c;
      }
    }
    if (seen.has(t)) continue;
    seen.add(t);
    const probe = probeT(cell, t, hooks, cellUsed);
    const candidate = probe.candidate;
    if (!candidate) continue;
    const availability = candidate.screen?.foldAvailability ?? 0;
    const bestAvailability = best?.screen?.foldAvailability ?? -1;
    if (
      availability > bestAvailability + 1e-12 ||
      (Math.abs(availability - bestAvailability) <= 1e-12 &&
        candidate.parameters.totalSatellites < (best?.parameters.totalSatellites ?? Infinity))
    ) {
      best = candidate;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function enumerateDeltaCandidates(
  request: DesignRequest,
  hooks: DeltaSearchHooks,
): Promise<DeltaSearchResult> {
  const constraints = request.constraints;
  const candidates: DesignCandidate[] = [];
  const rejected: DesignCandidate[] = [];

  const maxPlanes = Math.min(constraints.maxPlanes ?? DEFAULT_MAX_PLANES, DEFAULT_MAX_PLANES);
  const maxSatsPerPlane = Math.min(
    constraints.maxSatsPerPlane ?? DEFAULT_MAX_SATS_PER_PLANE,
    DEFAULT_MAX_SATS_PER_PLANE,
  );
  const maxAbsLat = regionMaxAbsLatitudeDeg(constraints.region);
  const inclinations = deltaInclinationSetDeg(constraints);

  if (inclinations.length === 0) {
    const range = resolveInclinationRange(constraints);
    const hiAlt = Math.max(constraints.altitudeMinKm, constraints.altitudeMaxKm);
    const thetaDeg = hiAlt > 0 ? earthCentralAngleDeg(hiAlt, constraints.minElevationDeg) : 0;
    const needed = maxAbsLat - thetaDeg;
    const reason = range.maxDeg < needed ? "reachability" : "inclinationRange";
    hooks.warnings.push(
      reason === "reachability"
        ? `対象領域の最大緯度 ${maxAbsLat.toFixed(1)}° に届く傾斜角は ${needed.toFixed(1)}° 以上必要ですが、指定範囲の上限は ${range.maxDeg.toFixed(1)}° です。Walker Delta 候補はありません。`
        : `指定した傾斜角範囲 ${range.minDeg.toFixed(1)}–${range.maxDeg.toFixed(1)}° に有効な Walker Delta 候補がありません。`,
    );
    rejected.push({
      key: `wd-rejected-${reason}`,
      parameters: {
        family: "walkerDelta",
        totalSatellites: 0,
        planes: 0,
        satsPerPlane: 0,
        phasingF: 0,
        altitudeKm: hiAlt,
        inclinationDeg: range.maxDeg,
        kernelFastPath: true,
      },
      analytic: makeAnalytic(Math.max(1, hiAlt), constraints, thetaDeg),
      feasible: false,
      rejectionReason: reason,
    });
    return { candidates, rejected };
  }

  const { latMinDeg, latMaxDeg } = regionLatitudeBounds(constraints.region);
  const regionFraction = bandAreaFraction(latMinDeg, latMaxDeg);
  let crossInclinationWarm = 0;

  for (const inclinationDeg of inclinations) {
    // Altitudes descend so each cell can warm-start from the previous (larger θ,
    // hence smaller T) answer.
    const samples = altitudeSamplesForInclination(constraints, inclinationDeg, hooks.warnings)
      .slice()
      .sort((a, b) => b.altitudeKm - a.altitudeKm);
    let warmT = crossInclinationWarm > 0 ? Math.floor(crossInclinationWarm * CROSS_INCLINATION_WARM_FACTOR) : 0;

    for (const sample of samples) {
      if (hooks.shouldAbort?.()) return { candidates, rejected };
      const thetaDeg = earthCentralAngleDeg(sample.altitudeKm, constraints.minElevationDeg);
      const analytic = makeAnalytic(sample.altitudeKm, constraints, thetaDeg);

      // Prefilter P1: a plane inclined at i never reaches beyond i + θ.
      if (maxAbsLat > inclinationDeg + thetaDeg + 1e-9) {
        rejected.push({
          key: `wd-h${sample.altitudeKm.toFixed(1)}-i${inclinationDeg.toFixed(2)}-reach`,
          parameters: buildParameters(
            {
              altitudeKm: sample.altitudeKm,
              inclinationDeg,
              thetaDeg,
              capBound: 0,
              analytic,
              maxPlanes,
              maxSatsPerPlane,
            },
            { planes: 0, satsPerPlane: 0 },
            0,
          ),
          analytic,
          feasible: false,
          rejectionReason: "reachability",
        });
        continue;
      }

      const capBound = capAreaLowerBoundCount(regionFraction, degToRad(thetaDeg), constraints.fold);
      if (!Number.isFinite(capBound)) {
        rejected.push({
          key: `wd-h${sample.altitudeKm.toFixed(1)}-i${inclinationDeg.toFixed(2)}-cap`,
          parameters: buildParameters(
            { altitudeKm: sample.altitudeKm, inclinationDeg, thetaDeg, capBound: 0, analytic, maxPlanes, maxSatsPerPlane },
            { planes: 0, satsPerPlane: 0 },
            0,
          ),
          analytic,
          feasible: false,
          rejectionReason: "capAreaBound",
        });
        continue;
      }

      const cell: CellContext = {
        altitudeKm: sample.altitudeKm,
        inclinationDeg,
        thetaDeg,
        capBound,
        repeatOrbits: sample.repeatOrbits,
        repeatDays: sample.repeatDays,
        analytic,
        maxPlanes,
        maxSatsPerPlane,
      };

      if (request.objective.kind === "fixedBudget") {
        const budgetT = Math.floor(request.objective.satelliteBudget);
        if (budgetT < capBound) {
          // P2: no arrangement of `budgetT` satellites can tile the region.
          rejected.push({
            key: `wd-h${sample.altitudeKm.toFixed(1)}-i${inclinationDeg.toFixed(2)}-bound`,
            parameters: buildParameters(cell, { planes: 0, satsPerPlane: 0 }, 0),
            analytic,
            feasible: false,
            rejectionReason: "capAreaBound",
          });
          continue;
        }
        const best = searchFixedBudget(cell, budgetT, hooks);
        if (best) {
          best.feasible = (best.screen?.foldAvailability ?? 0) >= hooks.screenThreshold;
          if (!best.feasible) best.rejectionReason = "belowThreshold";
          candidates.push(best);
          hooks.onCandidate?.(best);
        }
        await hooks.yieldNow?.();
        continue;
      }

      // Prefilter P2 sets the floor; the warm start raises it.
      const startT = Math.max(4, capBound, Math.floor(warmT * WARM_START_FACTOR));
      const { feasible, nearMiss } = searchMinimumT(cell, startT, hooks);
      if (feasible) {
        feasible.feasible = true;
        warmT = feasible.parameters.totalSatellites;
        if (crossInclinationWarm === 0 || warmT < crossInclinationWarm) crossInclinationWarm = warmT;
        candidates.push(feasible);
        hooks.onCandidate?.(feasible);
      } else if (nearMiss) {
        nearMiss.feasible = false;
        nearMiss.rejectionReason = "belowThreshold";
        candidates.push(nearMiss);
        hooks.onCandidate?.(nearMiss);
      }
      await hooks.yieldNow?.();
    }
  }

  if (hooks.budget.exhausted) {
    hooks.warnings.push(
      `Walker Delta の粗選別回数が全体上限(${hooks.budget.total} 件)に達し、探索を打ち切りました。より狭い高度・傾斜角範囲で再実行すると最小衛星数が下がる可能性があります。`,
    );
  } else if (hooks.budget.truncatedCells > 0) {
    hooks.warnings.push(
      `${hooks.budget.truncatedCells} 個の (高度, 傾斜角) 組で粗選別回数が上限(${hooks.budget.perCell} 件/組)に達しました。該当条件の最小衛星数は実際よりも大きい可能性があります。`,
    );
  }

  return { candidates, rejected };
}
