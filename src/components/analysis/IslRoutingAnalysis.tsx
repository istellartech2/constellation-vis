import { useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { downloadCSV, downloadPNG } from "./utils/downloadUtils";
import type { SatelliteSpec } from "../../lib/satellites";
import type { IslPathResult, IslSettings, IslShellRange } from "../../lib/isl/types";
import { numericInputValue, parseNumericInput } from "../../lib/numericInput";
import {
  buildIslWorkerSettingsPayload,
  type IslRoutingWorkerInitRequest,
  type IslRoutingWorkerResponse,
  type IslRoutingWorkerSweepRequest,
} from "../../workers/islRoutingWorker.types";
import { useChartTheme } from "./utils/chartTheme";
import { baseOption, categoryAxis, formatNumber, gridBase, lineSeries, tooltipBase, valueAxis } from "./utils/chartBase";
import { ChartCard, EmptyState, KpiStrip } from "./AnalysisLayout";

interface Props {
  /** The currently active (committed) satellite array — matches islShellRanges exactly. */
  satellites: SatelliteSpec[];
  islSettings: IslSettings;
  islShellRanges: IslShellRange[];
  startTime: Date;
}

/**
 * Time-window sweep analysis for the ISL routing feature.
 * Runs entirely in a dedicated ISL routing worker instance (one "init" +
 * "sweep" round trip), independent of the live scene's own worker. Takes the
 * same committed `satellites`/`islShellRanges` the live scene uses, rather
 * than re-parsing the (possibly newer, not-yet-"Update"d) editor text — this
 * makes the "new TOML + stale ISL snapshot" combination structurally
 * impossible instead of merely avoided.
 */
export default function IslRoutingAnalysis({ satellites, islSettings, islShellRanges, startTime }: Props) {
  // Held as raw text rather than a coerced number: a plain
  // `Number(e.target.value) || 1` immediately snapped the field back to 1 the
  // moment it was cleared while typing, since the coerced value round-trips
  // straight back into this controlled input's `value`.
  const [durationMinDraft, setDurationMinDraft] = useState("10");
  const [stepSDraft, setStepSDraft] = useState("10");
  const durationMin = Math.max(1, parseNumericInput(durationMinDraft) || 1);
  const stepS = Math.max(1, parseNumericInput(stepSDraft) || 1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<IslPathResult[] | null>(null);
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);

  const endpointsConfigured = !!islSettings.endpointA && !!islSettings.endpointB;

  async function runSweep() {
    if (!islSettings.endpointA || !islSettings.endpointB) {
      setError("ISL タブで地点 A・B を設定してください。");
      return;
    }
    setRunning(true);
    setError("");
    setResults(null);

    let worker: Worker | null = null;
    try {
      if (satellites.length === 0) throw new Error("衛星データがありません");

      worker = new Worker(new URL("../../workers/islRoutingWorker.ts", import.meta.url), {
        type: "module",
      });
      const activeWorker = worker;

      const sweepResults = await new Promise<IslPathResult[]>((resolve, reject) => {
        const handleMessage = (event: MessageEvent<IslRoutingWorkerResponse>) => {
          const message = event.data;
          if (message.type === "ack") return;
          if (message.type === "error") {
            reject(new Error(message.message));
            return;
          }
          if (message.type === "sweepResult") {
            resolve(message.payload.results);
          }
        };
        const handleError = (event: ErrorEvent) => {
          reject(new Error(event.message || "解析ワーカーでエラーが発生しました"));
        };
        activeWorker.addEventListener("message", handleMessage);
        activeWorker.addEventListener("error", handleError);

        const initRequest: IslRoutingWorkerInitRequest = {
          id: 0,
          type: "init",
          payload: { satellites },
        };
        activeWorker.postMessage(initRequest);

        // Message order is preserved per worker, so "sweep" is guaranteed to
        // be processed after "init" even though we don't wait for the ack.
        const sweepRequest: IslRoutingWorkerSweepRequest = {
          id: 1,
          type: "sweep",
          payload: {
            startIso: startTime.toISOString(),
            durationS: durationMin * 60,
            stepS,
            ...buildIslWorkerSettingsPayload(islSettings, islShellRanges, islSettings.endpointA!, islSettings.endpointB!),
          },
        };
        activeWorker.postMessage(sweepRequest);
      });

      setResults(sweepResults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析に失敗しました");
    } finally {
      worker?.terminate();
      setRunning(false);
    }
  }

  const reachableCount = results?.filter((r) => r.reachable).length ?? 0;
  const reachabilityRate = results && results.length > 0 ? (reachableCount / results.length) * 100 : null;
  const switchCount = results?.filter((r) => r.switchedFromPrevious).length ?? 0;

  const t = useChartTheme();
  const elapsedS = results
    ? results.map((r, i) => (i === 0 ? 0 : Math.round((r.computedAtSimMs - results[0].computedAtSimMs) / 1000)))
    : [];
  const reachableResults = results?.filter((r) => r.reachable) ?? [];
  const avgDelay =
    reachableResults.length > 0
      ? reachableResults.reduce((sum, r) => sum + r.totalDelayMs, 0) / reachableResults.length
      : null;
  const maxDelay = reachableResults.length > 0 ? Math.max(...reachableResults.map((r) => r.totalDelayMs)) : null;
  const avgHops =
    reachableResults.length > 0
      ? reachableResults.reduce((sum, r) => sum + r.hopCount, 0) / reachableResults.length
      : null;
  const outageCount = results ? results.length - reachableCount : 0;

  // One canvas with two stacked grids (delay on top, hops below) sharing the
  // same x axis; axisPointer.link keeps the cursor in sync across both.
  const GRID_LEFT = 56;
  const GRID_RIGHT = 16;
  const DELAY_TOP = 28;
  const DELAY_H = 190;
  const HOPS_TOP = DELAY_TOP + DELAY_H + 36;
  const HOPS_H = 120;
  const CHART_H = HOPS_TOP + HOPS_H + 44;
  const switchMarks = results
    ? results.flatMap((r, i) => (r.switchedFromPrevious ? [{ xAxis: i }] : []))
    : [];
  const chartOption = results && {
    ...baseOption(t),
    tooltip: {
      ...tooltipBase(t),
      valueFormatter: (v: unknown) => (typeof v === "number" ? formatNumber(v, 2) : "—"),
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      gridBase({ left: GRID_LEFT, right: GRID_RIGHT, top: DELAY_TOP, height: DELAY_H, containLabel: false }),
      gridBase({ left: GRID_LEFT, right: GRID_RIGHT, top: HOPS_TOP, height: HOPS_H, containLabel: false }),
    ],
    xAxis: [
      categoryAxis(t, elapsedS, { gridIndex: 0, axisLabel: { show: false }, boundaryGap: false }),
      categoryAxis(t, elapsedS, { name: "経過時間 (s)", gridIndex: 1, boundaryGap: false }),
    ],
    yAxis: [
      valueAxis(t, { name: "総遅延 (ms)", gridIndex: 0, scale: true }),
      valueAxis(t, { name: "ホップ数", gridIndex: 1, minInterval: 1, min: 0 }),
    ],
    series: [
      lineSeries(t.series[0], {
        name: "総遅延 (ms)",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: results.map((r) => (r.reachable ? r.totalDelayMs : null)),
        connectNulls: false,
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { color: t.warning, type: "dashed", width: 1 },
          label: { show: false },
          data: switchMarks,
        },
      }),
      lineSeries(t.series[1], {
        name: "ホップ数",
        xAxisIndex: 1,
        yAxisIndex: 1,
        step: "middle",
        data: results.map((r) => (r.reachable ? r.hopCount : null)),
        connectNulls: false,
      }),
    ],
  };

  function handleDownloadCSV() {
    if (!results) return;
    downloadCSV(
      ["elapsedS", "reachable", "totalDelayMs", "hopCount", "totalDistanceKm", "switchedFromPrevious"],
      results.map((r, i) => [
        elapsedS[i],
        r.reachable ? 1 : 0,
        r.totalDelayMs.toFixed(3),
        r.hopCount,
        r.totalDistanceKm.toFixed(2),
        r.switchedFromPrevious ? 1 : 0,
      ]),
      `isl-routing-sweep-${startTime.toISOString().slice(0, 19).replace(/[:]/g, "-")}.csv`,
    );
  }

  function handleDownloadPNG() {
    downloadPNG(chartRef, `isl-routing-sweep-${startTime.toISOString().slice(0, 10)}.png`);
  }

  return (
    <div className="flex flex-col h-full gap-3 overflow-auto">
      {!endpointsConfigured && (
        <p className="text-sm text-brand-text">
          ISL タブで地点 A・B を設定すると、この解析を実行できます。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="analysis-input-label">
          期間:
          <input
            type="number"
            min={1}
            step={1}
            className="analysis-input"
            style={{ width: "64px" }}
            value={numericInputValue(parseNumericInput(durationMinDraft))}
            onChange={(e) => setDurationMinDraft(e.target.value)}
            disabled={running}
          />
          分
        </label>
        <label className="analysis-input-label">
          刻み:
          <input
            type="number"
            min={1}
            step={1}
            className="analysis-input"
            style={{ width: "64px" }}
            value={numericInputValue(parseNumericInput(stepSDraft))}
            onChange={(e) => setStepSDraft(e.target.value)}
            disabled={running}
          />
          秒
        </label>
        <button
          type="button"
          onClick={runSweep}
          disabled={running || !endpointsConfigured}
          className="analysis-primary-button"
        >
          {running ? "計算中..." : "スイープ実行"}
        </button>
        {results && (
          <>
            <button type="button" onClick={handleDownloadCSV} className="analysis-secondary-button">
              CSV
            </button>
            <button type="button" onClick={handleDownloadPNG} className="analysis-secondary-button">
              PNG
            </button>
          </>
        )}
      </div>

      {error && <div className="text-danger text-xs bg-danger-soft p-2 rounded">{error}</div>}

      {!results && !running && (
        <EmptyState title="ISL 経路のタイムスイープ">
          ISL タブで設定した地点 A・B 間の最短経路を、指定した期間・刻みで繰り返し計算し、
          総遅延・ホップ数・経路切替・到達不能区間の時間変化を表示します。期間と刻みを指定して「スイープ実行」を押してください。
        </EmptyState>
      )}

      {results && (
        <>
          <KpiStrip
            items={[
              {
                label: "平均遅延",
                value: avgDelay === null ? "—" : formatNumber(avgDelay, 2),
                unit: avgDelay === null ? undefined : "ms",
                hint: `到達可能率 ${formatNumber(reachabilityRate ?? 0, 1)} %`,
              },
              {
                label: "最大遅延",
                value: maxDelay === null ? "—" : formatNumber(maxDelay, 2),
                unit: maxDelay === null ? undefined : "ms",
              },
              {
                label: "平均ホップ数",
                value: avgHops === null ? "—" : formatNumber(avgHops, 1),
                hint: `経路切替 ${switchCount} 回`,
              },
              {
                label: "経路断",
                value: outageCount === 0 ? "なし" : String(outageCount),
                unit: outageCount === 0 ? undefined : "ステップ",
                hint: `全 ${results.length} ステップ`,
                tone: outageCount === 0 ? "ok" : "ng",
              },
            ]}
          />
          {chartOption && (
            <ChartCard
              title="総遅延とホップ数の推移"
              caption="黄色の破線は経路切替(フラッピング)が起きた時刻です。到達不能な区間は線が途切れます。"
            >
              <ReactECharts
                ref={chartRef}
                option={chartOption}
                style={{ height: CHART_H, width: "100%" }}
                notMerge
              />
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
