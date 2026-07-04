import { useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { Button } from "../ui/button";
import { downloadCSV, downloadPNG } from "./utils/downloadUtils";
import type { SatelliteSpec } from "../../lib/satellites";
import type { IslPathResult, IslSettings, IslShellRange } from "../../lib/isl/types";
import type {
  IslRoutingWorkerInitRequest,
  IslRoutingWorkerResponse,
  IslRoutingWorkerSweepRequest,
} from "../../workers/islRoutingWorker.types";

interface Props {
  /** The currently active (committed) satellite array — matches islShellRanges exactly (H-4). */
  satellites: SatelliteSpec[];
  islSettings: IslSettings;
  islShellRanges: IslShellRange[];
  startTime: Date;
}

/**
 * Time-window sweep analysis for the ISL routing feature (§2.5.4, Phase 4).
 * Runs entirely in a dedicated ISL routing worker instance (one "init" +
 * "sweep" round trip), independent of the live scene's own worker. Takes the
 * same committed `satellites`/`islShellRanges` the live scene uses, rather
 * than re-parsing the (possibly newer, not-yet-"Update"d) editor text — this
 * makes the "new TOML + stale ISL snapshot" combination structurally
 * impossible instead of merely avoided (isl-routing-review.md H-4).
 */
export default function IslRoutingAnalysis({ satellites, islSettings, islShellRanges, startTime }: Props) {
  const [durationMin, setDurationMin] = useState(10);
  const [stepS, setStepS] = useState(10);
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
            excludedShellKeys: islSettings.excludedShellKeys,
            includeBaseSatellites: islSettings.includeBaseSatellites,
            endpointA: islSettings.endpointA!,
            endpointB: islSettings.endpointB!,
            linkModel: islSettings.linkModel,
            shellRanges: islShellRanges,
            shellLinkModels: islSettings.shellLinkModels,
            cost: islSettings.cost,
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

  const chartOption = results && {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { data: ["総遅延 (ms)", "ホップ数"], textStyle: { color: "#d1d5db" } },
    grid: { left: 60, right: 60, top: 40, bottom: 60 },
    xAxis: {
      type: "category",
      name: "経過時間 (s)",
      data: results.map((r, i) => (i === 0 ? 0 : Math.round((r.computedAtSimMs - results[0].computedAtSimMs) / 1000))),
      axisLabel: { color: "#9ca3af" },
      axisLine: { lineStyle: { color: "#4b5563" } },
    },
    yAxis: [
      {
        type: "value",
        name: "総遅延 (ms)",
        axisLabel: { color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#4b5563" } },
        splitLine: { lineStyle: { color: "#374151" } },
      },
      {
        type: "value",
        name: "ホップ数",
        axisLabel: { color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#4b5563" } },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "総遅延 (ms)",
        type: "line",
        yAxisIndex: 0,
        data: results.map((r) => (r.reachable ? r.totalDelayMs : null)),
        connectNulls: false,
        color: "#ff33cc",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#facc15", type: "dashed" },
          data: results
            .map((r, i) => (r.switchedFromPrevious ? i : null))
            .filter((i): i is number => i !== null)
            .map((i) => ({ xAxis: i })),
        },
      },
      {
        name: "ホップ数",
        type: "line",
        yAxisIndex: 1,
        step: "middle",
        data: results.map((r) => (r.reachable ? r.hopCount : null)),
        connectNulls: false,
        color: "#33e0ff",
      },
    ],
  };

  function handleDownloadCSV() {
    if (!results) return;
    downloadCSV(
      ["elapsedS", "reachable", "totalDelayMs", "hopCount", "totalDistanceKm", "switchedFromPrevious"],
      results.map((r, i) => [
        i === 0 ? 0 : Math.round((r.computedAtSimMs - results[0].computedAtSimMs) / 1000),
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
        <p className="text-sm text-amber-400">
          ISL タブで地点 A・B を設定すると、この解析を実行できます。
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-400">
          期間(分)
          <input
            type="number"
            min={1}
            step={1}
            className="w-20 bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5 block"
            value={durationMin}
            onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="text-xs text-gray-400">
          刻み(秒)
          <input
            type="number"
            min={1}
            step={1}
            className="w-20 bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5 block"
            value={stepS}
            onChange={(e) => setStepS(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <Button onClick={runSweep} disabled={running || !endpointsConfigured} variant="secondary">
          {running ? "計算中..." : "スイープ実行"}
        </Button>
        {results && (
          <>
            <Button onClick={handleDownloadCSV} variant="outline" size="sm">
              CSV
            </Button>
            <Button onClick={handleDownloadPNG} variant="outline" size="sm">
              PNG
            </Button>
          </>
        )}
      </div>

      {error && <div className="text-red-400 text-xs bg-red-900/20 p-2 rounded">{error}</div>}

      {results && (
        <div className="text-sm text-gray-200 flex flex-wrap gap-4">
          <span>到達可能率: {reachabilityRate?.toFixed(1)}%</span>
          <span>切替回数: {switchCount}</span>
          <span>ステップ数: {results.length}</span>
        </div>
      )}

      {chartOption && (
        <div className="flex-1 min-h-[360px]">
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            theme="dark"
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      )}

      <p className="text-xs text-gray-500">
        黄色の破線は経路切替(フラッピング)が起きた時刻を示します。到達不能な区間は線が途切れます。
      </p>
    </div>
  );
}
