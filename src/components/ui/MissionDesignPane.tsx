import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  candidateToShell,
  enumerateAnalytic,
  relaxationSuggestions,
  type DesignCandidate,
  type DesignProgress,
  type DesignRequest,
  type DesignResult,
} from "../../lib/constellationDesign";
import { computeShellDerived, type ShellDerived } from "../../lib/constellationPatterns";
import type { ConstellationShell } from "../../lib/constellationTypes";
import {
  DEFAULT_MISSION_FORM,
  applyRelaxedConstraints,
  budgetSuggestion,
  designShellName,
  dominatedCandidateKeys,
  formToRequest,
  sortCandidatesForDisplay,
  validateMissionForm,
  type MissionDesignForm,
  type MissionRunPhase,
} from "../../lib/missionDesignForm";
import type { ConstellationDesignWorkerResponse } from "../../workers/constellationDesignWorker.types";
import { Button } from "./button";
import DerivedInfoStrip, { type DerivedInfoItem } from "./DerivedInfoStrip";
import DesignCandidateTable from "./DesignCandidateTable";
import MissionObjectiveForm from "./MissionObjectiveForm";
import ShellFormBanner, { type ShellFormBannerItem } from "./ShellFormBanner";

interface Props {
  /** Epoch of the constellation being edited; seeds the SGP4 verification. */
  epochIso: string;
  /** Prefilled constraints when reopened via 「設計をやり直す」. */
  initialForm?: MissionDesignForm | null;
  /** Appends the candidate as a shell; the dialog selects it and returns to the list. */
  onAddCandidate: (shell: ConstellationShell) => void;
}

/** Rows rendered before the 「残り N 件を表示」 button; analytic Star sizing alone yields ~550. */
const INITIAL_VISIBLE_ROWS = 40;
const VISIBLE_ROWS_STEP = 40;
/** Partial candidates arrive one at a time; repainting per message is wasted work. */
const PARTIAL_FLUSH_MS = 200;

/**
 * Mission-design wizard: owns the form state, the design Worker and the
 * idle → enumerating → verifying → done state machine.
 *
 * Cancellation is `terminate()` + a fresh Worker on the next run, matching
 * `StationAccessAnalysis.tsx`; there is no cancel message in the protocol. The
 * pane is conditionally rendered by `ConstellationEditorDialog`, so leaving the
 * wizard unmounts it and terminates any run in flight (and discards its
 * results — a new run starts from scratch).
 */
export default function MissionDesignPane({ epochIso, initialForm, onAddCandidate }: Props) {
  const [form, setForm] = useState<MissionDesignForm>(initialForm ?? DEFAULT_MISSION_FORM);
  const [phase, setPhase] = useState<MissionRunPhase>("idle");
  const [stale, setStale] = useState(false);
  const [progress, setProgress] = useState<DesignProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [runRequest, setRunRequest] = useState<DesignRequest | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);
  /** Snapshot of `candidatesRef`, refreshed on a timer so 150+ partials do not each repaint. */
  const [candidates, setCandidates] = useState<DesignCandidate[]>([]);

  const candidatesRef = useRef<Map<string, DesignCandidate>>(new Map());
  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `candidateToShell` is not free and the badge column needs it per row. */
  const patternCache = useRef<Map<string, string | undefined>>(new Map());

  const formErrors = useMemo(() => validateMissionForm(form), [form]);
  const running = phase === "enumerating" || phase === "verifying";

  const flushNow = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    setCandidates([...candidatesRef.current.values()]);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      setCandidates([...candidatesRef.current.values()]);
    }, PARTIAL_FLUSH_MS);
  }, []);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const handleFormChange = useCallback(
    (patch: Partial<MissionDesignForm>) => {
      setForm((prev) => ({ ...prev, ...patch }));
      // A finished run no longer describes the inputs on screen.
      setPhase((prev) => (prev === "idle" || running ? prev : "idle"));
      setStale((prev) => prev || !running);
    },
    [running],
  );

  const start = useCallback(
    (targetForm: MissionDesignForm) => {
      if (validateMissionForm(targetForm).length > 0) return;
      stopWorker();

      const request = formToRequest(targetForm, epochIso);
      candidatesRef.current = new Map();
      patternCache.current = new Map();
      setResult(null);
      setErrorMessage(null);
      setProgress(null);
      setSelectedKey(null);
      setVisibleRows(INITIAL_VISIBLE_ROWS);
      setStale(false);
      setRunRequest(request);
      setPhase("enumerating");

      // Stage 1a runs on the main thread: closed-form Star sizing is fast
      // enough to fill the table before the Worker has even started.
      try {
        const analytic = enumerateAnalytic(request);
        for (const candidate of analytic.analyticCandidates) {
          candidatesRef.current.set(candidate.key, candidate);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setPhase("error");
        flushNow();
        return;
      }
      flushNow();

      const jobId = ++jobIdRef.current;
      const worker = new Worker(
        new URL("../../workers/constellationDesignWorker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.addEventListener("message", (event: MessageEvent<ConstellationDesignWorkerResponse>) => {
        const message = event.data;
        if (message.id !== jobIdRef.current) return;
        switch (message.type) {
          case "ack":
            break;
          case "progress":
            setProgress(message.payload);
            break;
          case "partial":
            // Screening and verification post the same `key`; the later message
            // carries the richer candidate, so replacing is correct.
            candidatesRef.current.set(message.payload.candidate.key, message.payload.candidate);
            scheduleFlush();
            break;
          case "result": {
            const designResult = message.payload.result;
            for (const candidate of designResult.candidates) {
              candidatesRef.current.set(candidate.key, candidate);
            }
            setResult(designResult);
            setProgress(null);
            // `fixedBudget` deliberately ranks by availability and returns the
            // best affordable configurations even when none clears the
            // threshold — showing "nothing found" there would hide the answer
            // the objective exists to give. The other objectives filter on
            // `feasible`, so an all-infeasible table really is an empty result.
            const feasible = [...candidatesRef.current.values()].some((c) => c.feasible);
            const isEmpty =
              designResult.candidates.length === 0 ||
              (designResult.request.objective.kind !== "fixedBudget" && !feasible);
            setPhase(isEmpty ? "empty" : "done");
            setSelectedKey(
              designResult.best?.key ??
                [...candidatesRef.current.values()].find((c) => c.feasible)?.key ??
                null,
            );
            flushNow();
            stopWorker();
            break;
          }
          case "error":
            setErrorMessage(message.message);
            setPhase("error");
            setProgress(null);
            flushNow();
            stopWorker();
            break;
        }
      });

      worker.addEventListener("error", (event: ErrorEvent) => {
        if (jobId !== jobIdRef.current) return;
        setErrorMessage(event.message || "設計ワーカーでエラーが発生しました");
        setPhase("error");
        setProgress(null);
        stopWorker();
      });

      worker.postMessage({ id: jobId, type: "design", payload: request });
      setPhase("verifying");
    },
    [epochIso, flushNow, scheduleFlush, stopWorker],
  );

  const handleCancel = useCallback(() => {
    // No cancel message exists: the Worker is destroyed and the ids advanced so
    // any message already in flight is ignored.
    jobIdRef.current++;
    stopWorker();
    setProgress(null);
    setPhase("cancelled");
    flushNow();
  }, [flushNow, stopWorker]);

  const handleRelax = useCallback(
    (relaxed: MissionDesignForm) => {
      setForm(relaxed);
      start(relaxed);
    },
    [start],
  );

  /* --- derived view state -------------------------------------------------- */

  const budget =
    runRequest?.objective.kind === "fixedBudget" ? runRequest.objective.satelliteBudget : null;
  const displayObjective = runRequest?.objective.kind ?? form.objective;

  const rows = useMemo(() => {
    const filtered =
      budget === null
        ? candidates
        : candidates.filter((c) => c.parameters.totalSatellites <= budget);
    return sortCandidatesForDisplay(filtered, displayObjective);
  }, [candidates, budget, displayObjective]);

  const dominated = useMemo(
    () =>
      displayObjective === "paretoCountVsAltitude"
        ? dominatedCandidateKeys(rows)
        : new Set<string>(),
    [rows, displayObjective],
  );

  const patternOf = useCallback((candidate: DesignCandidate): string | undefined => {
    if (patternCache.current.has(candidate.key)) {
      return patternCache.current.get(candidate.key);
    }
    let pattern: string | undefined;
    try {
      pattern = candidateToShell(candidate).pattern;
    } catch {
      pattern = undefined;
    }
    patternCache.current.set(candidate.key, pattern);
    return pattern;
  }, []);

  const selected = useMemo(
    () => rows.find((c) => c.key === selectedKey) ?? null,
    [rows, selectedKey],
  );

  const selectedShell = useMemo(() => {
    if (!selected) return null;
    try {
      const base = candidateToShell(selected, { request: runRequest ?? undefined });
      return candidateToShell(selected, {
        request: runRequest ?? undefined,
        name: designShellName(base),
      });
    } catch {
      return null;
    }
  }, [selected, runRequest]);

  const selectedDerived = useMemo<ShellDerived | null>(() => {
    if (!selectedShell) return null;
    try {
      return computeShellDerived(selectedShell);
    } catch {
      return null;
    }
  }, [selectedShell]);

  const relaxations = useMemo(() => {
    if (!runRequest) return [];
    const list = relaxationSuggestions(runRequest.constraints).map((suggestion) => ({
      label: suggestion.label,
      form: applyRelaxedConstraints(form, suggestion.apply(runRequest.constraints)),
    }));
    const budget = budgetSuggestion(form, runRequest.constraints, result?.analyticCandidates ?? []);
    if (budget) list.unshift(budget);
    return list;
  }, [runRequest, form, result]);

  const banner: ShellFormBannerItem[] = [
    ...formErrors.map((message) => ({ message, severity: "error" as const })),
    ...(phase === "error" && errorMessage
      ? [{ message: errorMessage, severity: "error" as const }]
      : []),
    ...(result?.diagnostics.warnings ?? []).map((message) => ({
      message,
      severity: "warning" as const,
    })),
  ];

  const progressRatio =
    progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  // The Walker Delta search reports no intermediate progress and only posts its
  // `done === total` message when it finishes, so a full bar during the screen
  // phase means "still working" — show it as indeterminate and let the streamed
  // candidate count be the sign of life.
  const indeterminate =
    running && (!progress || (progress.phase === "screen" && progress.done >= progress.total));
  const progressLabel = !running
    ? null
    : indeterminate
      ? `候補を探索中 … 候補 ${rows.length} 件`
      : progress && progress.phase === "verify"
        ? `検証中 ${progress.done}/${progress.total} 件`
        : progress
          ? `候補列挙中 ${progress.done}/${progress.total}${progress.message ? ` … ${progress.message}` : " …"}`
          : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
      {/* Inputs */}
      <div className="md:w-72 shrink-0 overflow-y-auto max-md:max-h-[38dvh] border border-gray-600 rounded-md bg-gray-850 p-3">
        <MissionObjectiveForm form={form} onChange={handleFormChange} disabled={running} />
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => start(form)}
            disabled={running || formErrors.length > 0}
            className="bg-amber-600 hover:bg-amber-700 text-amber-50 disabled:opacity-50"
            size="sm"
          >
            候補を計算
          </Button>
          {running && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500"
            >
              中止
            </Button>
          )}
          {phase === "cancelled" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => start(form)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500"
            >
              検証を再開
            </Button>
          )}
          {phase === "error" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => start(form)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500"
            >
              再試行
            </Button>
          )}
          <span className="text-[11px] text-gray-400">候補 {rows.length} 件</span>
        </div>

        {running && (
          <div className="space-y-1">
            <div className="h-1 bg-gray-700 rounded overflow-hidden">
              <div
                className={`h-full bg-amber-500 transition-all ${indeterminate ? "animate-pulse" : ""}`}
                style={{ width: indeterminate ? "100%" : `${Math.round(progressRatio * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">{progressLabel}</p>
          </div>
        )}

        <ShellFormBanner items={banner} />

        {stale && rows.length > 0 && (
          <p className="text-[11px] text-amber-300">
            制約が変更されました。再計算してください
          </p>
        )}

        {phase === "cancelled" && (
          <p className="text-[11px] text-gray-400">
            計算を中止しました。未検証の候補は解析値のみです。
          </p>
        )}

        {phase === "empty" && (
          <div className="space-y-2 rounded border border-amber-800 bg-amber-900/20 p-2">
            <p className="text-xs text-amber-200">
              この制約を満たす候補が見つかりませんでした。制約を緩和して再計算できます。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {relaxations.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => handleRelax(suggestion.form)}
                  className="text-[11px] px-2 py-1 rounded-full border border-amber-700 text-amber-200 hover:bg-amber-900/40"
                >
                  {suggestion.label}
                </button>
              ))}
              {relaxations.length === 0 && (
                <span className="text-[11px] text-amber-300/80">
                  これ以上の自動緩和案はありません
                </span>
              )}
            </div>
          </div>
        )}

        {rows.length > 0 ? (
          <div className={stale ? "opacity-60" : undefined}>
            <DesignCandidateTable
              candidates={rows}
              phase={phase}
              dominatedKeys={dominated}
              showDominance={displayObjective === "paretoCountVsAltitude"}
              patternOf={patternOf}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              visibleCount={visibleRows}
              onShowMore={() => setVisibleRows((n) => n + VISIBLE_ROWS_STEP)}
            />
          </div>
        ) : (
          phase !== "empty" && (
            <p className="text-xs text-gray-500 border border-gray-700 rounded p-4 text-center">
              目的と制約を入力して「候補を計算」を押してください。
            </p>
          )
        )}

        {selected && (
          <CandidatePreview
            candidate={selected}
            derived={selectedDerived}
            canAdd={selectedShell !== null}
            onAdd={() => selectedShell && onAddCandidate(selectedShell)}
            shellName={selectedShell?.name ?? ""}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

function num(value: number | undefined, digits = 2, unit = ""): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${Number(value.toFixed(digits))}${unit}`;
}

function geometryItems(derived: ShellDerived): DerivedInfoItem[] {
  return [
    { label: "総衛星数", value: num(derived.totalSats, 0, " 機") },
    { label: "軌道面数", value: num(derived.planes, 0, " 面") },
    { label: "1面あたり", value: num(derived.satsPerPlane, 2, " 機") },
    { label: "軌道周期", value: num(derived.periodMin, 2, " 分") },
    { label: "RAAN間隔", value: num(derived.raanSpacingDeg, 3, "°") },
    { label: "面間位相", value: num(derived.interPlaneOffsetDeg, 3, "°") },
  ];
}

function verifiedItems(candidate: DesignCandidate): DerivedInfoItem[] {
  const verified = candidate.verified;
  return [
    {
      label: "可用率",
      value: verified ? `${(verified.foldAvailability * 100).toFixed(3)} %` : "未検証",
      tone: verified ? (candidate.feasible ? "ok" : "warn") : "normal",
      help: "多重度の条件を満たした (地点, 時刻) の割合。成立判定はこの値で行います(既定閾値 99.99%)。",
    },
    {
      label: "最小同時可視数",
      value: verified ? num(verified.minFold, 0, " 機") : "-",
      help: "分解能依存の診断値です。格子を細かくすると悪化する下界なので、成立判定には使えません。",
    },
    {
      label: "最大ギャップ",
      value: verified ? num(verified.maxGapSec, 0, " s") : "-",
      help: "固定点・24時間・ディザなしの別パスで測った連続不可視時間の最大値。",
    },
    {
      label: "片道遅延",
      value: num(candidate.analytic.latencyAtEpsilonMs, 2, " ms"),
      help: "最低仰角における斜距離 ÷ 光速。片道の伝播遅延のみで、機器遅延は含みません。",
    },
    {
      label: "最悪緯度",
      value: verified ? num(verified.worstLatitudeDeg, 1, "°") : "-",
    },
    {
      label: "解析カバレッジ",
      value: candidate.screen ? `${(candidate.screen.foldAvailability * 100).toFixed(2)} %` : "-",
      help: "粗い格子・球面判定によるスクリーニング値。検証値より悲観的になります。",
    },
  ];
}

function CandidatePreview({
  candidate,
  derived,
  canAdd,
  onAdd,
  shellName,
}: {
  candidate: DesignCandidate;
  derived: ShellDerived | null;
  canAdd: boolean;
  onAdd: () => void;
  shellName: string;
}) {
  return (
    <div className="space-y-2">
      {derived ? (
        <DerivedInfoStrip title="候補の派生情報" columns={3} items={geometryItems(derived)} />
      ) : (
        <p className="text-xs text-gray-500">この候補の派生情報を計算できませんでした</p>
      )}
      <DerivedInfoStrip title="検証結果" columns={3} items={verifiedItems(candidate)} />
      {/* Sticky so the action stays reachable while the table scrolls on a phone.
          The shell name is a separate line: inside the button it would overflow
          the 375 px viewport instead of wrapping. */}
      <div className="sticky bottom-0 bg-gray-850/95 pt-1 space-y-1 md:static md:bg-transparent">
        {shellName && <p className="text-[11px] text-gray-400 truncate">追加名: {shellName}</p>}
        <Button
          onClick={onAdd}
          disabled={!canAdd}
          size="sm"
          className="w-full md:w-auto bg-amber-600 hover:bg-amber-700 text-amber-50 disabled:opacity-50"
        >
          この候補をシェルとして追加
        </Button>
      </div>
    </div>
  );
}
