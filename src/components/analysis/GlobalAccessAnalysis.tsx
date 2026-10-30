import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, averageVisibilityData } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml } from "../../lib/config";
import type { GroundStation } from "../../lib/groundStations";
import type { StationVisibilitySample } from "../../lib/visibility";
import { downloadPNG, downloadHTML, downloadCSV } from "./utils/downloadUtils";
import { createGlobalAccessChartOption, type LatitudeAvailabilityRow } from "./utils/chartOptions";
import { useCompactChart } from "./utils/useCompactChart";
import { useChartTheme } from "./utils/chartTheme";
import { formatNumber } from "./utils/chartBase";
import {
  areaWeightedMean,
  formatLatitude,
  latitudeRanges,
  stationCounts,
  summarizeCounts,
} from "./utils/accessMetrics";
import { ChartCard, EmptyState, KpiStrip, MetricList, type Kpi } from "./AnalysisLayout";

const DURATION_HOURS = 24;
const STEP_SECONDS = 10;
/** Heatmap bucket: 12 × 10 s = 2 min → 721 columns × 181 latitudes. */
const AVERAGE_POINTS = 12;
const BUCKET_MINUTES = (STEP_SECONDS * AVERAGE_POINTS) / 60;
/** Latitude band threshold quoted in the KPI strip. */
const GOOD_AVAILABILITY_PCT = 90;

interface Props {
  satText: string;
  constText: string;
  startTime: Date;
}

interface GlobalResult {
  samples: StationVisibilitySample[];
  latitudes: number[];
  rows: LatitudeAvailabilityRow[];
  minElevationDeg: number;
  longitudeDeg: number;
}

export default function GlobalAccessAnalysis({ satText, constText, startTime }: Props) {
  const compactChart = useCompactChart();
  const theme = useChartTheme();
  const [result, setResult] = useState<GlobalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const [minElevationAngle, setMinElevationAngle] = useState(30);
  const [observationLongitude, setObservationLongitude] = useState(0);
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);

  const analyzeGlobalCoverage = async () => {
    setIsAnalyzing(true);
    setError("");

    // Allow UI to update before starting heavy computation
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      const baseSats = satText ? parseSatellitesToml(satText) : [];
      const constSats = constText ? parseConstellationToml(constText) : [];
      const allSatellites = [...baseSats, ...constSats];
      if (allSatellites.length === 0) {
        throw new Error("衛星データがありません");
      }

      // One virtual ground station per degree of latitude on the chosen meridian.
      const generatedStations: GroundStation[] = [];
      for (let lat = -90; lat <= 90; lat++) {
        generatedStations.push({
          name: formatLatitude(lat),
          latitudeDeg: lat,
          longitudeDeg: observationLongitude,
          heightKm: 0,
          minElevationDeg: minElevationAngle,
        });
      }

      const visibilityData = calculateStationAccessData(
        allSatellites,
        generatedStations,
        startTime,
        DURATION_HOURS,
        STEP_SECONDS,
      );

      // Metrics come from the raw 10 s integer counts; only the heatmap is averaged.
      const rows: LatitudeAvailabilityRow[] = generatedStations.map((station, index) => {
        const summary = summarizeCounts(stationCounts(visibilityData, index), STEP_SECONDS);
        return {
          latitude: station.latitudeDeg,
          availabilityPct: summary.availabilityPct,
          redundancyPct: summary.redundancyPct,
          interruptionsPerDay: summary.interruptionsPerDay,
          maxGapMin: summary.maxGapMin,
          avgGapMin: summary.avgGapMin,
        };
      });

      setResult({
        samples: averageVisibilityData(visibilityData, AVERAGE_POINTS),
        latitudes: generatedStations.map((s) => s.latitudeDeg),
        rows,
        minElevationDeg: minElevationAngle,
        longitudeDeg: observationLongitude,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析エラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const option = useMemo(
    () =>
      result
        ? createGlobalAccessChartOption(
            { samples: result.samples, latitudes: result.latitudes, rows: result.rows, bucketMinutes: BUCKET_MINUTES },
            theme,
            compactChart,
          )
        : null,
    [result, theme, compactChart],
  );

  const kpis = useMemo(() => (result ? buildKpis(result.rows) : []), [result]);
  const details = useMemo(() => (result ? buildDetails(result.rows) : []), [result]);

  const dateTag = startTime.toISOString().slice(0, 10);

  const downloadChartAsPNG = () => {
    downloadPNG(chartRef, `global-coverage-analysis-${dateTag}.png`);
  };

  const downloadChartAsHTML = () => {
    if (chartRef.current && result) {
      // Function formatters do not survive JSON serialisation; the data does.
      const chartOption = chartRef.current.getEchartsInstance().getOption();
      downloadHTML(chartOption, "全球アクセス解析", `global-coverage-analysis-${dateTag}.html`);
    }
  };

  const downloadRawData = () => {
    if (!result) return;
    const headers = ["Time", "Timestamp", ...result.latitudes.map((lat) => formatLatitude(lat))];
    const rows = result.samples.map((timeData) => [
      timeData.time,
      timeData.timestamp,
      ...timeData.stations.map((station) => station.visibleCount),
    ]);
    downloadCSV(headers, rows, `global-coverage-data-${dateTag}.csv`);
  };

  const downloadAvailabilityCSV = () => {
    if (!result) return;
    const headers = ["緯度(deg)", "時間可用率(%)", "冗長率_2機以上(%)", "中断頻度(回/日)", "最大中断時間(分)", "平均中断時間(分)"];
    const rows = result.rows.map((r) => [
      r.latitude,
      r.availabilityPct.toFixed(1),
      r.redundancyPct.toFixed(1),
      r.interruptionsPerDay.toFixed(1),
      r.maxGapMin.toFixed(1),
      r.avgGapMin.toFixed(1),
    ]);
    downloadCSV(headers, rows, `global-availability-${dateTag}.csv`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="analysis-toolbar">
        <button onClick={analyzeGlobalCoverage} disabled={isAnalyzing} className="analysis-primary-button">
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>

        <label className="analysis-input-label">
          最低仰角
          <input
            type="number"
            min="0"
            max="80"
            value={minElevationAngle}
            onChange={(e) => setMinElevationAngle(Number(e.target.value))}
            className="analysis-input w-14"
            disabled={isAnalyzing}
          />
          °
        </label>

        <label className="analysis-input-label">
          観測経度
          <input
            type="number"
            min="-180"
            max="180"
            value={observationLongitude}
            onChange={(e) => setObservationLongitude(Number(e.target.value))}
            className="analysis-input w-16"
            disabled={isAnalyzing}
          />
          °
        </label>

        {result && (
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

      <div className="relative min-h-0 flex-1">
        {isAnalyzing && (
          <div className="analysis-loading-overlay">
            <div className="analysis-loading-spinner" />
            <div className="analysis-loading-text">解析中...</div>
            <div className="analysis-loading-subtext">数秒お待ちください</div>
          </div>
        )}

        <div className="h-full overflow-y-auto px-1 py-2">
          {!result || !option ? (
            <EmptyState title="緯度ごとの全球アクセス">
              観測経度の子午線上に 1° 間隔で仮想地上局（90°S〜90°N の 181 点）を置き、開始時刻から {DURATION_HOURS} 時間を{" "}
              {STEP_SECONDS} 秒刻みで伝搬して、最低仰角以上に見える衛星数を求めます。結果は緯度 × 時刻のヒートマップと、緯度ごとの時間可用率・冗長率で表示します。
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              <KpiStrip items={kpis} />

              <ChartCard
                title="緯度 × 時刻の可視衛星数"
                caption={`経度 ${formatNumber(result.longitudeDeg, 0)}°・最低仰角 ${formatNumber(result.minElevationDeg, 0)}°・UTC 24 時間（${BUCKET_MINUTES} 分平均）。右は緯度ごとの時間可用率と冗長率（行にカーソルで中断の詳細）。`}
                actions={
                  <button onClick={downloadAvailabilityCSV} className="analysis-secondary-button">
                    可用率CSV
                  </button>
                }
              >
                <ReactECharts
                  ref={chartRef}
                  option={option}
                  notMerge
                  style={{ height: compactChart ? 440 : 520, width: "100%" }}
                />
              </ChartCard>

              <ChartCard title="中断の統計" caption="可用率が 0 % または 100 % の緯度は中断統計から除外。">
                <MetricList items={details} />
              </ChartCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRanges(ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return "なし";
  return ranges
    .map(([a, b]) => (a === b ? formatLatitude(a) : `${formatLatitude(a)}〜${formatLatitude(b)}`))
    .join("、");
}

function buildKpis(rows: LatitudeAvailabilityRow[]): Kpi[] {
  const meanAvailability = areaWeightedMean(rows, (r) => r.availabilityPct);
  const meanRedundancy = areaWeightedMean(rows, (r) => r.redundancyPct);
  const goodRanges = latitudeRanges(rows, (r) => r.availabilityPct >= GOOD_AVAILABILITY_PCT);
  const goodCount = rows.filter((r) => r.availabilityPct >= GOOD_AVAILABILITY_PCT).length;
  const covered = rows.filter((r) => r.availabilityPct > 0);
  const worst = covered.reduce<LatitudeAvailabilityRow | null>((a, b) => (!a || b.maxGapMin > a.maxGapMin ? b : a), null);

  return [
    {
      label: "全球平均可用率",
      value: formatNumber(meanAvailability, 1),
      unit: "%",
      hint: "緯度の面積（cos φ）で加重",
    },
    {
      label: `可用率 ${GOOD_AVAILABILITY_PCT}% 以上の緯度帯`,
      value:
        goodRanges.length === 0 ? "なし" : goodRanges.length <= 2 ? formatRanges(goodRanges) : `${goodRanges.length} 帯`,
      hint: goodRanges.length === 0 ? undefined : `${goodCount} / ${rows.length} 緯度（1° 刻み）`,
    },
    {
      label: "全球平均冗長率",
      value: formatNumber(meanRedundancy, 1),
      unit: "%",
      hint: "同時 2 機以上・面積加重",
    },
    {
      label: "最大通信断",
      value: worst ? formatNumber(worst.maxGapMin, 1) : "—",
      unit: worst ? "分" : undefined,
      hint: worst ? `${formatLatitude(worst.latitude)}（可視のある緯度で最長）` : "可視のある緯度なし",
    },
  ];
}

function buildDetails(rows: LatitudeAvailabilityRow[]): Array<[string, string]> {
  const interrupted = rows.filter((r) => r.availabilityPct > 0 && r.availabilityPct < 100);
  const uncovered = latitudeRanges(rows, (r) => r.availabilityPct === 0);
  const full = latitudeRanges(rows, (r) => r.availabilityPct >= 100);
  if (interrupted.length === 0) {
    return [
      ["常時可視の緯度帯", formatRanges(full)],
      ["不可視の緯度帯", formatRanges(uncovered)],
    ];
  }
  const maxFreq = interrupted.reduce((a, b) => (b.interruptionsPerDay > a.interruptionsPerDay ? b : a));
  const meanFreq = interrupted.reduce((s, r) => s + r.interruptionsPerDay, 0) / interrupted.length;
  const meanAvgGap = interrupted.reduce((s, r) => s + r.avgGapMin, 0) / interrupted.length;
  const longestAvg = interrupted.reduce((a, b) => (b.avgGapMin > a.avgGapMin ? b : a));
  return [
    ["中断頻度（緯度平均）", `${formatNumber(meanFreq, 1)} 回/日`],
    ["中断頻度（最多）", `${formatNumber(maxFreq.interruptionsPerDay, 1)} 回/日・${formatLatitude(maxFreq.latitude)}`],
    ["平均中断時間（緯度平均）", `${formatNumber(meanAvgGap, 1)} 分`],
    ["平均中断時間（最長）", `${formatNumber(longestAvg.avgGapMin, 1)} 分・${formatLatitude(longestAvg.latitude)}`],
    ["常時可視の緯度帯", formatRanges(full)],
    ["不可視の緯度帯", formatRanges(uncovered)],
  ];
}
