import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { GroundStation } from "../../lib/groundStations";
import { downloadPNG, downloadHTML, downloadCSV } from "./utils/downloadUtils";
import {
  createStationTimelineOption,
  TIMELINE_CHROME_PX,
  TIMELINE_LANE_PX,
  TIMELINE_LANE_PX_COMPACT,
} from "./utils/chartOptions";
import { useCompactChart } from "./utils/useCompactChart";
import { useChartTheme } from "./utils/chartTheme";
import { formatNumber } from "./utils/chartBase";
import {
  buildContactSegments,
  summarizeNetwork,
  summarizeStations,
  type StationAccessSummary,
} from "./utils/accessMetrics";
import { ChartCard, EmptyState, KpiStrip, type Kpi } from "./AnalysisLayout";
import type { StationVisibilitySample } from "../../lib/visibility";
import type {
  StationAccessWorkerRequest,
  StationAccessWorkerResponse,
} from "../../workers/stationAccessWorker.types";

/** Propagation settings sent to the worker; also quoted in the empty state. */
const DURATION_HOURS = 24;
const STEP_SECONDS = 10;

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
  /**
   * The satellite sensor FOV, read straight from the shared display settings
   * (表示オプション › 衛星の視野). Shown here read-only on purpose: the
   * definition has exactly one editable home, and this panel only decides
   * whether to *apply* it as a visibility condition.
   */
  fovHalfAngleDeg: number;
  fovAlongTrackDeg: number;
  fovCrossTrackDeg: number;
}

export default function StationAccessAnalysis({
  satText,
  constText,
  gsText,
  startTime,
  fovHalfAngleDeg,
  fovAlongTrackDeg,
  fovCrossTrackDeg,
}: Props) {
  const [useSatelliteFov, setUseSatelliteFov] = useState(false);
  const compactChart = useCompactChart();
  const theme = useChartTheme();
  const [data, setData] = useState<StationVisibilitySample[]>([]);
  const [stations, setStations] = useState<GroundStation[]>([]);
  const [stepSeconds, setStepSeconds] = useState(STEP_SECONDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const latestJobId = useRef(0);
  const analyzingRef = useRef(false);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/stationAccessWorker.ts", import.meta.url),
      { type: "module" },
    );

    const handleMessage = (event: MessageEvent<StationAccessWorkerResponse>) => {
      const message = event.data;
      if (message.id !== latestJobId.current) {
        return;
      }

      if (message.type === "success") {
        const { averagedData, stations: workerStations, averagePoints } = message.payload;
        setData(averagedData);
        setStations(workerStations);
        setStepSeconds(STEP_SECONDS * Math.max(1, averagePoints));
        setError("");
      } else {
        setError(message.message);
      }
      setIsAnalyzing(false);
      analyzingRef.current = false;
    };

    const handleError = (event: ErrorEvent) => {
      if (!analyzingRef.current) return;
      setError(event.message || "解析ワーカーでエラーが発生しました");
      setIsAnalyzing(false);
      analyzingRef.current = false;
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    workerRef.current = worker;

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
      workerRef.current = null;
      analyzingRef.current = false;
    };
  }, []);

  const analyzeAccess = () => {
    const worker = workerRef.current;
    if (!worker) {
      setError("解析ワーカーが初期化されていません");
      return;
    }
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setError("");

    const id = latestJobId.current + 1;
    latestJobId.current = id;

    const request: StationAccessWorkerRequest = {
      id,
      type: "analyze",
      payload: {
        satText,
        constText,
        gsText,
        startTimeIso: startTime.toISOString(),
        durationHours: DURATION_HOURS,
        stepSeconds: STEP_SECONDS,
        // No averaging: counts must stay integers for the redundancy colours.
        averagePoints: 1,
        satelliteFov: useSatelliteFov
          ? {
              halfAngleDeg: fovHalfAngleDeg,
              alongTrackDeg: fovAlongTrackDeg,
              crossTrackDeg: fovCrossTrackDeg,
            }
          : undefined,
      },
    };

    worker.postMessage(request);
  };

  const stationNames = useMemo(() => stations.map((s) => s.name), [stations]);
  const summaries = useMemo(
    () => summarizeStations(data, stationNames, stepSeconds),
    [data, stationNames, stepSeconds],
  );
  const network = useMemo(() => summarizeNetwork(data, stepSeconds), [data, stepSeconds]);
  const kpis = useMemo(() => buildKpis(summaries, network), [summaries, network]);

  const option = useMemo(() => {
    if (data.length === 0) return null;
    const startMs = data[0].timestamp;
    const endMs = data[data.length - 1].timestamp;
    return createStationTimelineOption(
      { segments: buildContactSegments(data, stepSeconds), stationNames, startMs, endMs },
      theme,
      compactChart,
    );
  }, [data, stepSeconds, stationNames, theme, compactChart]);

  const laneHeight = compactChart ? TIMELINE_LANE_PX_COMPACT : TIMELINE_LANE_PX;
  const chartHeight = Math.max(180, stationNames.length * laneHeight + TIMELINE_CHROME_PX);
  const dateTag = startTime.toISOString().slice(0, 10);

  const downloadChartAsPNG = () => {
    downloadPNG(chartRef, `station-access-analysis-${dateTag}.png`);
  };

  const downloadChartAsHTML = () => {
    if (chartRef.current && data.length > 0) {
      // Function formatters and the custom renderItem do not survive
      // JSON serialisation; CSV carries the full data.
      const chartOption = chartRef.current.getEchartsInstance().getOption();
      downloadHTML(chartOption, "地上局コンタクトタイムライン", `station-access-analysis-${dateTag}.html`);
    }
  };

  const downloadRawData = () => {
    if (data.length > 0) {
      const headers = ["Time", "Timestamp", ...stationNames];
      const rows = data.map((timeData) => [
        timeData.time,
        timeData.timestamp,
        ...timeData.stations.map((station) => station.visibleCount),
      ]);
      downloadCSV(headers, rows, `station-access-data-${dateTag}.csv`);
    }
  };

  const downloadSummaryCSV = () => {
    if (summaries.length === 0) return;
    const headers = ["地上局", "可用率(%)", "冗長率_2機以上(%)", "パス数(回/日)", "中断頻度(回/日)", "最大断(分)", "平均断(分)"];
    const rows = summaries.map((s) => [
      s.name,
      s.availabilityPct.toFixed(1),
      s.redundancyPct.toFixed(1),
      s.passesPerDay.toFixed(1),
      s.interruptionsPerDay.toFixed(1),
      s.maxGapMin.toFixed(1),
      s.avgGapMin.toFixed(1),
    ]);
    downloadCSV(headers, rows, `station-availability-${dateTag}.csv`);
  };

  const hasResult = option !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="analysis-toolbar">
        <button onClick={analyzeAccess} disabled={isAnalyzing} className="analysis-primary-button">
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>

        {hasResult && (
          <>
            <button onClick={downloadChartAsPNG} className="analysis-secondary-button">
              PNG保存
            </button>
            <button onClick={downloadChartAsHTML} className="analysis-secondary-button">
              HTML保存
            </button>
            <button onClick={downloadRawData} className="analysis-secondary-button">
              CSV保存
            </button>
          </>
        )}

        {error && <span className="analysis-error">{error}</span>}
      </div>

      <div className="flex flex-col gap-1 px-1 py-2 text-xs text-fg-muted">
        <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-fg">
          <input
            type="checkbox"
            checked={useSatelliteFov}
            onChange={(e) => setUseSatelliteFov(e.target.checked)}
            className="accent-brand"
            disabled={isAnalyzing}
          />
          <span>衛星の視野も可視条件に加える</span>
        </label>
        <span className="text-fg-subtle">
          視野: 半角 {fovHalfAngleDeg}° ・ Along-track {fovAlongTrackDeg}° ・ Cross-track {fovCrossTrackDeg}°
          （変更は 表示オプション › 衛星の視野）
          {useSatelliteFov &&
            ` — 地上局側の最低仰角・可視判定モードとの AND 条件。傾き 0° のときは最大オフナディア ${fovHalfAngleDeg}° と同じ意味です。`}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {isAnalyzing && (
          <div className="analysis-loading-overlay">
            <div className="analysis-loading-spinner" />
            <div className="analysis-loading-text">解析中...</div>
            <div className="analysis-loading-subtext">数秒お待ちください</div>
          </div>
        )}

        <div className="h-full overflow-y-auto px-1 py-2">
          {!hasResult ? (
            <EmptyState title="地上局ごとのコンタクトタイムライン">
              開始時刻から {DURATION_HOURS} 時間を {STEP_SECONDS} 秒刻みで伝搬し、各地上局で同時に見えている衛星数を求めます。
              結果は局ごとの通信可能区間（色の濃さ = 同時可視数）と、可用率・冗長率・最大通信断の一覧で表示します。
              「解析開始」を押してください。
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              <KpiStrip items={kpis} />

              <ChartCard
                title="コンタクトタイムライン（冗長度付き）"
                caption="UTC・24 時間。帯の色が同時可視衛星数、空白は通信断。凡例クリックで機数ごとに表示切替、ホイール / ドラッグで拡大。"
              >
                <ReactECharts
                  ref={chartRef}
                  option={option}
                  notMerge
                  style={{ height: chartHeight, width: "100%" }}
                />
              </ChartCard>

              <ChartCard
                title="地上局別の可用性"
                caption="可用率 = 1 機以上可視の時間率、冗長率 = 2 機以上同時可視の時間率。断は通信不可の連続時間。"
                actions={
                  <button onClick={downloadSummaryCSV} className="analysis-secondary-button">
                    CSV保存
                  </button>
                }
              >
                <StationSummaryTable summaries={summaries} />
              </ChartCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildKpis(summaries: StationAccessSummary[], network: ReturnType<typeof summarizeNetwork>): Kpi[] {
  if (summaries.length === 0) return [];
  const best = summaries.reduce((a, b) => (b.availabilityPct > a.availabilityPct ? b : a));
  const bestRedundant = summaries.reduce((a, b) => (b.redundancyPct > a.redundancyPct ? b : a));
  const multi = summaries.length > 1;
  return [
    ...(multi
      ? [
          {
            label: "ネットワーク可用率",
            value: formatNumber(network.availabilityPct, 1),
            unit: "%",
            hint: "いずれかの局で通信可能",
          },
        ]
      : []),
    {
      label: multi ? "最良局の可用率" : "可用率",
      value: formatNumber(best.availabilityPct, 1),
      unit: "%",
      hint: best.name,
    },
    {
      label: multi ? "最良局の冗長率" : "冗長率",
      value: formatNumber(bestRedundant.redundancyPct, 1),
      unit: "%",
      hint: multi ? `${bestRedundant.name}・同時 2 機以上` : "同時 2 機以上",
    },
    {
      label: multi ? "ネットワーク最大通信断" : "最大通信断",
      value: formatNumber(multi ? network.maxGapMin : best.maxGapMin, 1),
      unit: "分",
      hint: multi ? "全局で同時に不可の最長時間" : undefined,
    },
  ];
}

function StationSummaryTable({ summaries }: { summaries: StationAccessSummary[] }) {
  const cell = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-b border-line text-xs text-fg-muted">
            <th className="px-2 py-1.5 text-left font-medium">地上局</th>
            <th className={`${cell} font-medium`}>可用率</th>
            <th className={`${cell} font-medium`}>冗長率（2機以上）</th>
            <th className={`${cell} font-medium`}>パス数/日</th>
            <th className={`${cell} font-medium`}>最大断</th>
            <th className={`${cell} font-medium`}>平均断</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s, index) => (
            <tr key={`${s.name}-${index}`} className="border-b border-line last:border-b-0">
              <td className="max-w-[12rem] truncate px-2 py-1.5 text-fg">{s.name}</td>
              <td className={cell}>{formatNumber(s.availabilityPct, 1)} %</td>
              <td className={cell}>{formatNumber(s.redundancyPct, 1)} %</td>
              <td className={cell}>{formatNumber(s.passesPerDay, 1)}</td>
              <td className={cell}>{formatNumber(s.maxGapMin, 1)} 分</td>
              <td className={cell}>{formatNumber(s.avgGapMin, 1)} 分</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
