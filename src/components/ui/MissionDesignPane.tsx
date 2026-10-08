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
  active?: boolean;
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
 * pane stays mounted within the editing session so switching to the shell
 * list preserves the draft and results. Leaving the wizard cancels a run;
 * closing the dialog unmounts it and disposes the Worker.
 */
export default function MissionDesignPane({ epochIso, initialForm, onAddCandidate, active = true }: Props) {
  const [form, setForm] = useState<MissionDesignForm>(initialForm ?? DEFAULT_MISSION_FORM);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const stepTitleRef = useRef<HTMLHeadingElement | null>(null);
  const stepBodyRef = useRef<HTMLDivElement | null>(null);
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
      setStep(3);

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

  useEffect(() => {
    stepTitleRef.current?.focus();
    if (stepBodyRef.current) stepBodyRef.current.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    if (!active && running) handleCancel();
  }, [active, running, handleCancel]);

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

  const resultsStale = stale || (runRequest !== null && runRequest.epochIso !== epochIso);
  const stepLabels = ["目的と対象地域", "条件を設定", "候補を比較"];
  const objectiveLabel = form.objective === "minSatellites" ? "最小機数で連続カバレッジ"
    : form.objective === "fixedBudget" ? `衛星 ${form.satelliteBudget} 機以内でカバレッジ最大`
    : "機数と高度のトレードオフ";

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <nav aria-label="ミッション設計の手順" className="grid grid-cols-3 gap-2 shrink-0">
        {stepLabels.map((label, index) => {
          const target = (index + 1) as 1 | 2 | 3;
          return (
            <button key={label} type="button" disabled={running || (target === 3 && !runRequest)}
              aria-current={step === target ? "step" : undefined}
              onClick={() => setStep(target)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs sm:text-sm disabled:opacity-40 ${step === target ? "border-brand bg-brand-soft text-fg" : "border-line bg-raised text-fg-muted hover:border-line-strong"}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">{target}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div ref={stepBodyRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-line bg-raised p-4">
        <h3 ref={stepTitleRef} tabIndex={-1} className="text-base font-semibold text-fg outline-none mb-1">{stepLabels[step - 1]}</h3>
        <p className="text-xs text-fg-muted mb-4">{step === 1 ? "設計の目的と、カバーしたい地域を選びます。" : step === 2 ? "必要なカバレッジと高度の範囲を設定します。細かな探索条件は詳細設定から変更できます。" : "候補を選んで、検証結果を確認してからシェルに追加します。"}</p>
        {step !== 3 ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <MissionObjectiveForm form={form} onChange={handleFormChange} disabled={running}
                section={step === 1 ? "objective" : "constraints"} />
              <ShellFormBanner items={formErrors.map((message) => ({message, severity: "error" as const}))} />
            </div>
            <aside aria-label="設計条件の確認" className="space-y-3 rounded-lg border border-line bg-sunken p-4 self-start">
              <h4 className="text-sm font-semibold text-fg">設計条件の確認</h4>
              <p className="text-sm text-brand-text">{objectiveLabel}</p>
              <dl className="space-y-2 text-sm text-fg-muted">
                <div><dt className="text-xs text-fg-muted">目標可用率 / 評価基準</dt><dd>{form.targetAvailabilityPercent}% / {form.availabilityBasis === "worstLatitude" ? "最も条件の悪い緯度" : "領域全体の平均"}</dd></div>
                <div><dt className="text-xs text-fg-muted">対象地域</dt><dd>{form.region === "global" ? "全球" : `緯度 ${form.latMinDeg}〜${form.latMaxDeg}°`}</dd></div>
                <div><dt className="text-xs text-fg-muted">高度の範囲</dt><dd>{form.altitudeMinKm}〜{form.altitudeMaxKm} km</dd></div>
                <div><dt className="text-xs text-fg-muted">最低仰角 / 同時に見える衛星数</dt><dd>{form.minElevationDeg}° / {form.fold} 機以上</dd></div>
              </dl>
              <p className="text-xs text-fg-muted">候補を追加した後も、シェルの設定画面で調整できます。</p>
            </aside>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-fg-muted">候補 {rows.length} 件 <span className="text-fg-muted">・{objectiveLabel}</span></p>
              {running ? (
                <Button variant="outline" size="sm" onClick={handleCancel} className="bg-raised hover:bg-raised-hover text-fg border-line-strong">計算を中止</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStep(2)} className="bg-sunken hover:bg-raised-hover text-fg border-line-strong">条件を変更</Button>
                  {(resultsStale || phase === "error" || phase === "cancelled") && (
                    <Button size="sm" onClick={() => start(form)} disabled={formErrors.length > 0}
                      className="bg-brand hover:bg-brand-hover text-brand-fg">再計算</Button>
                  )}
                </div>
              )}
            </div>
        {running && (
          <div className="space-y-1">
            <div className="h-1 bg-raised rounded overflow-hidden">
              <div
                className={`h-full bg-brand transition-all ${indeterminate ? "animate-pulse" : ""}`}
                style={{ width: indeterminate ? "100%" : `${Math.round(progressRatio * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-fg-muted">{progressLabel}</p>
          </div>
        )}

        <ShellFormBanner items={banner} />

        {resultsStale && rows.length > 0 && (
          <p className="text-[11px] text-brand-text">
            制約が変更されました。再計算してください
          </p>
        )}

        {phase === "cancelled" && (
          <p className="text-[11px] text-fg-muted">
            計算を中止しました。未検証の候補は解析値のみです。
          </p>
        )}

        {phase === "empty" && (
          <div className="space-y-2 rounded border border-brand/40 bg-brand-soft p-2">
            <p className="text-xs text-brand-text">
              この制約を満たす候補が見つかりませんでした。制約を緩和して再計算できます。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {relaxations.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => handleRelax(suggestion.form)}
                  className="text-[11px] px-2 py-1 rounded-full border border-brand/40 text-brand-text hover:bg-brand-soft"
                >
                  {suggestion.label}
                </button>
              ))}
              {relaxations.length === 0 && (
                <span className="text-[11px] text-brand-text">
                  これ以上の自動緩和案はありません
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] items-start">
        {rows.length > 0 ? (
          <div className={resultsStale ? "opacity-60" : undefined}>
            <DesignCandidateTable
              targetAvailability={runRequest?.constraints.continuousThreshold ?? 0.9999}
              availabilityBasis={runRequest?.constraints.availabilityBasis ?? "areaAverage"}
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
            <p className="text-xs text-fg-muted border border-line-strong bg-raised rounded p-4 text-center">
              目的と制約を入力して「候補を計算」を押してください。
            </p>
          )
        )}

        {selected && (
          <CandidatePreview
            candidate={selected}
            derived={selectedDerived}
          />
        )}
        </div>
          </div>
        )}
      </div>
      {step === 3 && (
        <div className="shrink-0 border-t border-line pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-fg-muted min-w-0 break-words">{selectedShell ? `選択中: ${selectedShell.name}` : "比較表から候補を選択してください。"}</p>
          <Button onClick={() => selectedShell && onAddCandidate(selectedShell)}
            disabled={!selectedShell || resultsStale || running} className="bg-brand hover:bg-brand-hover text-brand-fg shrink-0">
            この候補をシェルとして追加
          </Button>
        </div>
      )}
      {step !== 3 && (
        <div className="flex items-center justify-end gap-3 border-t border-line pt-3 shrink-0">
          {(step === 2 || runRequest) && (
            <Button variant="outline" onClick={() => setStep(step === 2 ? 1 : 3)}
              className="mr-auto bg-sunken hover:bg-raised-hover text-fg border-line-strong">{step === 2 ? "目的に戻る" : "前の候補を見る"}</Button>
          )}
          <Button onClick={() => step === 1 ? setStep(2) : start(form)} disabled={step === 2 && formErrors.length > 0}
            className="bg-brand hover:bg-brand-hover text-brand-fg">{step === 1 ? "条件を設定する" : "この条件で候補を計算"}</Button>
        </div>
      )}
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
      value: verified ? `${((verified.evaluationAvailability ?? verified.foldAvailability) * 100).toFixed(4)} %` : "未検証",
      tone: verified ? (candidate.feasible ? "ok" : "warn") : "normal",
      help: "選択した評価基準に基づく可用率です。目標可用率との比較で達成を判定します。格子・時間分解能に依存します。",
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
      label: "粗選別可用率",
      value: candidate.screen ? `${((candidate.screen.evaluationAvailability ?? candidate.screen.foldAvailability) * 100).toFixed(4)} %` : "-",
      help: "粗い格子・球面判定によるスクリーニング値。検証値より悲観的になります。",
    },
  ];
}

function CandidatePreview({ candidate, derived }: { candidate: DesignCandidate; derived: ShellDerived | null }) {
  return (
    <aside aria-label="選択した候補の詳細" className="space-y-3 rounded-lg border border-line bg-sunken p-3">
      <h4 className="text-sm font-semibold text-fg">選択した候補</h4>
      {derived ? (
        <DerivedInfoStrip title="配置と軌道" columns={1} items={geometryItems(derived)} />
      ) : (
        <p className="text-xs text-fg-muted">この候補の計算結果を表示できませんでした。</p>
      )}
      <DerivedInfoStrip title="検証結果" columns={1} items={verifiedItems(candidate)} />
    </aside>
  );
}
