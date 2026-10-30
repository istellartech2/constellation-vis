import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  analyzeSolarPower,
  buildSelectableSatellites,
  createDefaultSolarPowerInput,
  type SolarPowerAnalysisInput,
  type SolarPowerAnalysisResult,
  type SolarPowerKpi,
  type SolarPowerSample,
  type SolarSweepParameter,
} from "../../lib/solarPowerAnalysis";
import {
  downloadCSV,
  downloadJSON,
  downloadMultiChartHTML,
  downloadPNG,
} from "./utils/downloadUtils";
import { useChartTheme, type ChartTheme } from "./utils/chartTheme";
import {
  bandMarkArea,
  barSeries,
  baseOption,
  categoryAxis,
  formatNumber,
  gridBase,
  legendBase,
  lineSeries,
  thresholdMarkLine,
  timeAxis,
  tooltipBase,
  valueAxis,
  valueXAxis,
} from "./utils/chartBase";
import {
  ChartCard,
  EmptyState,
  KpiStrip,
  MetricList,
  Verdict,
  type Kpi,
  type VerdictTone,
} from "./AnalysisLayout";

interface Props {
  satText: string;
  constText: string;
  startTime: Date;
}

type InputSection = "発電系" | "負荷系" | "バッテリ系" | "解析設定" | "感度解析";

interface InputFieldDefinition {
  key: keyof SolarPowerAnalysisInput;
  label: string;
  help: string;
  type?: "number";
  step?: number;
  section: InputSection;
}

type ComparisonMode = "representative" | "sweep";

const SECTIONS: InputSection[] = ["発電系", "負荷系", "バッテリ系", "解析設定"];

const SWEEP_LABELS: Record<SolarSweepParameter, string> = {
  solarArrayPowerBOL_W: "BOL太陽電池出力 [W]",
  batteryCapacityWh: "バッテリ容量 [Wh]",
  baseLoadW: "ベース負荷 [W]",
  payloadLoadW: "ペイロード負荷 [W]",
  missionYears: "運用年数 [年]",
};

const INPUT_FIELDS: InputFieldDefinition[] = [
  {
    key: "solarArrayPowerBOL_W",
    label: "BOL太陽電池出力 [W]",
    help: "衛星寿命初期に取り出せる太陽電池の最大出力です。100kg級小型衛星の初期値として250Wを置いています。",
    section: "発電系",
  },
  {
    key: "sunTrackingFactor",
    label: "追尾/姿勢係数",
    help: "姿勢制約、入射角損失、実運用のパネル向きの悪化をまとめて表す係数です。1.0で理想追尾です。",
    step: 0.01,
    section: "発電系",
  },
  {
    key: "powerPathEfficiency",
    label: "電力経路効率",
    help: "太陽電池から電力バスまでの変換・配電損失を含んだ効率です。",
    step: 0.01,
    section: "発電系",
  },
  {
    key: "degradationPerYear",
    label: "年間劣化率",
    help: "太陽電池出力が毎年どれだけ低下するかの近似値です。0.025 は年2.5%を意味します。",
    step: 0.001,
    section: "発電系",
  },
  {
    key: "missionYears",
    label: "運用年数 [年]",
    help: "寿命末期条件を見るための年数です。劣化率と組み合わせてEOL発電能力に反映します。",
    step: 0.1,
    section: "発電系",
  },
  {
    key: "baseLoadW",
    label: "ベース負荷 [W]",
    help: "常時ONのバス機器、OBC、ADCS、TT&C などの基本消費電力です。",
    section: "負荷系",
  },
  {
    key: "sunlightExtraLoadW",
    label: "日照時追加負荷 [W]",
    help: "太陽指向運用や発電時のみ有効な系の追加負荷です。",
    section: "負荷系",
  },
  {
    key: "eclipseExtraLoadW",
    label: "日陰時追加負荷 [W]",
    help: "ヒータや夜間運用など、日陰中に増える追加負荷です。",
    section: "負荷系",
  },
  {
    key: "payloadLoadW",
    label: "ペイロード負荷 [W]",
    help: "観測機器や通信ミッション機器がONのときの追加消費電力です。",
    section: "負荷系",
  },
  {
    key: "payloadDutyCycle",
    label: "ペイロードDuty",
    help: "ペイロード負荷が有効な時間率です。0.25なら平均25%稼働として扱います。",
    step: 0.01,
    section: "負荷系",
  },
  {
    key: "batteryCapacityWh",
    label: "バッテリ容量 [Wh]",
    help: "バッテリの総エネルギー容量です。日陰通過時の成立性に強く効きます。",
    section: "バッテリ系",
  },
  {
    key: "initialSocPercent",
    label: "初期SOC [%]",
    help: "解析開始時点のバッテリ残量です。通常は高めから評価を始めます。",
    section: "バッテリ系",
  },
  {
    key: "minSocPercent",
    label: "最低SOC [%]",
    help: "バッテリ保護や寿命の観点で下回りたくない残量下限です。",
    section: "バッテリ系",
  },
  {
    key: "chargeEfficiency",
    label: "充電効率",
    help: "太陽電池の余剰電力がバッテリに充電されるときの効率です。",
    step: 0.01,
    section: "バッテリ系",
  },
  {
    key: "dischargeEfficiency",
    label: "放電効率",
    help: "バッテリから負荷へ電力を供給する際の効率です。",
    step: 0.01,
    section: "バッテリ系",
  },
  {
    key: "designMarginPercent",
    label: "設計マージン [%]",
    help: "負荷見積りに対して上乗せする余裕です。不確定性の吸収に使います。",
    section: "バッテリ系",
  },
  {
    key: "orbitStepSeconds",
    label: "周回刻み [s]",
    help: "周回タイムラインのサンプリング刻みです。細かいほど滑らかですが重くなります。",
    section: "解析設定",
  },
  {
    key: "dayStepSeconds",
    label: "1日刻み [s]",
    help: "24時間SOC推移と日次KPIの計算刻みです。",
    section: "解析設定",
  },
  {
    key: "sweepStart",
    label: "掃引開始値",
    help: "感度解析で最初に試す入力値です。現在の比較グラフが感度モードのときに使います。",
    section: "感度解析",
  },
  {
    key: "sweepEnd",
    label: "掃引終了値",
    help: "感度解析で最後に試す入力値です。",
    section: "感度解析",
  },
  {
    key: "sweepSteps",
    label: "分割数",
    help: "開始値から終了値まで何点評価するかです。大きいほど滑らかですが計算量が増えます。",
    section: "感度解析",
  },
];

type ChartRef = InstanceType<typeof ReactECharts>;

interface TooltipParam {
  dataIndex: number;
  seriesName?: string;
  marker?: string;
  value?: unknown;
}

/** Signed value with a real minus sign, e.g. "+12.3" / "−923.0". */
function formatSigned(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = formatNumber(Math.abs(value), digits);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}

function statusTone(status: SolarPowerKpi["designStatus"]): VerdictTone {
  switch (status) {
    case "critical":
      return "ng";
    case "warning":
      return "warn";
    default:
      return "ok";
  }
}

function statusLabel(status: SolarPowerKpi["designStatus"]): string {
  switch (status) {
    case "critical":
      return "不成立";
    case "warning":
      return "要注意";
    default:
      return "成立";
  }
}

/** One sentence explaining the verdict, mirroring the lib's status criteria. */
function verdictDetail(result: SolarPowerAnalysisResult): string {
  const kpi = result.currentDay;
  const minSoc = result.analysisInput.minSocPercent;
  let detail: string;
  if (kpi.designStatus === "critical") {
    detail = `最小SOC ${formatNumber(kpi.minSocPercent)} % ≤ 下限 ${formatNumber(minSoc, 0)} %`;
  } else if (kpi.designStatus === "warning") {
    detail = `正味収支 ${formatSigned(kpi.dailyNetWh)} Wh/day（発電が消費を下回る）`;
  } else {
    detail = `最小SOC ${formatNumber(kpi.minSocPercent)} %（下限 ${formatNumber(minSoc, 0)} %）・正味収支 ${formatSigned(kpi.dailyNetWh)} Wh/day`;
  }
  const worst = result.worstRepresentativeDay;
  if (worst.kpi.designStatus !== "nominal" && worst.kpi.designStatus !== kpi.designStatus) {
    detail += ` ／ 最悪代表日 ${worst.label}: ${statusLabel(worst.kpi.designStatus)}`;
  }
  return detail;
}

/** Eclipse intervals [start, end] in epoch ms from consecutive !inSunlight samples. */
function eclipseBands(samples: SolarPowerSample[]): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let start: number | null = null;
  for (const sample of samples) {
    if (!sample.inSunlight && start === null) {
      start = sample.timestamp;
    } else if (sample.inSunlight && start !== null) {
      bands.push([start, sample.timestamp]);
      start = null;
    }
  }
  const last = samples.at(-1);
  if (start !== null && last) bands.push([start, last.timestamp]);
  return bands;
}

function sampleHeader(sample: SolarPowerSample | undefined): string {
  if (!sample) return "";
  return `${sample.timeLabel.slice(0, 5)} UTC・${sample.inSunlight ? "日照" : "日陰"}`;
}

function createSocOption(result: SolarPowerAnalysisResult, t: ChartTheme) {
  const samples = result.daySamples;
  const minSoc = result.analysisInput.minSocPercent;
  return {
    ...baseOption(t),
    grid: gridBase({ top: 32, bottom: 8 }),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TooltipParam[]) => {
        const first = params[0];
        const sample = first ? samples[first.dataIndex] : undefined;
        if (!sample) return "";
        return `${sampleHeader(sample)}<br/>SOC: <b>${formatNumber(sample.socPercent)} %</b>`;
      },
    },
    xAxis: timeAxis(t, {
      min: samples[0]?.timestamp,
      max: samples.at(-1)?.timestamp,
    }),
    yAxis: valueAxis(t, { name: "SOC [%]", min: 0, max: 100, interval: 25 }),
    // A piecewise visualMap on a time-axis line crashes ECharts' gradient
    // builder, so the below-limit stretches are a second, red overlay series.
    series: [
      lineSeries(t.series[0], {
        name: "SOC",
        data: samples.map((sample) => [sample.timestamp, sample.socPercent]),
        markLine: thresholdMarkLine(t, minSoc, `下限 ${formatNumber(minSoc, 0)} %`),
        markArea: bandMarkArea(t, eclipseBands(samples)),
      }),
      lineSeries(t.danger, {
        name: "下限以下",
        silent: true,
        tooltip: { show: false },
        data: samples.map((sample) => [sample.timestamp, sample.socPercent <= minSoc ? sample.socPercent : null]),
      }),
    ],
  };
}

function createPowerOption(result: SolarPowerAnalysisResult, t: ChartTheme) {
  const samples = result.orbitSamples;
  const toSeries = (pick: (sample: SolarPowerSample) => number) =>
    samples.map((sample) => [sample.timestamp, pick(sample)]);
  return {
    ...baseOption(t),
    grid: gridBase({ top: 32, bottom: 32 }),
    legend: legendBase(t),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TooltipParam[]) => {
        const first = params[0];
        const sample = first ? samples[first.dataIndex] : undefined;
        if (!sample) return "";
        const lines = params.map((param) => {
          const value = Array.isArray(param.value) ? Number(param.value[1]) : Number.NaN;
          return `${param.marker ?? ""}${param.seriesName}: ${formatNumber(value)} W`;
        });
        return [sampleHeader(sample), ...lines].join("<br/>");
      },
    },
    xAxis: timeAxis(t, {
      min: samples[0]?.timestamp,
      max: samples.at(-1)?.timestamp,
      axisLine: { onZero: false, lineStyle: { color: t.lineStrong } },
    }),
    yAxis: valueAxis(t, { name: "電力 [W]" }),
    series: [
      lineSeries(t.series[0], {
        name: "発電電力",
        data: toSeries((sample) => sample.generationW),
        markArea: bandMarkArea(t, eclipseBands(samples)),
      }),
      lineSeries(t.series[1], {
        name: "消費電力",
        data: toSeries((sample) => sample.loadW),
      }),
      lineSeries(t.series[2], {
        name: "正味電力",
        data: toSeries((sample) => sample.netPowerW),
        markLine: zeroMarkLine(t),
      }),
    ],
  };
}

/** Unlabelled zero baseline for charts whose values can go negative. */
function zeroMarkLine(t: ChartTheme) {
  return {
    symbol: "none",
    silent: true,
    label: { show: false },
    lineStyle: { color: t.fgSubtle, type: "solid", width: 1 },
    data: [{ yAxis: 0 }],
  };
}

/** Bars coloured per datum (threshold / sign) without losing the bar defaults. */
function coloredBars(values: number[], colorOf: (value: number) => string) {
  return values.map((value) => ({ value, itemStyle: { color: colorOf(value) } }));
}

function createRepresentativeMinSocOption(result: SolarPowerAnalysisResult, t: ChartTheme) {
  const minSoc = result.analysisInput.minSocPercent;
  const days = result.representativeDays;
  return {
    ...baseOption(t),
    grid: gridBase({ top: 32 }),
    tooltip: {
      ...tooltipBase(t),
      axisPointer: { type: "shadow" },
      formatter: (params: TooltipParam[]) => {
        const day = params[0] ? days[params[0].dataIndex] : undefined;
        if (!day) return "";
        return `${day.label}<br/>最小SOC: <b>${formatNumber(day.kpi.minSocPercent)} %</b>（${statusLabel(day.kpi.designStatus)}）`;
      },
    },
    xAxis: categoryAxis(t, days.map((day) => day.label)),
    yAxis: valueAxis(t, { name: "最小SOC [%]", min: 0, max: 100, interval: 25 }),
    series: [
      barSeries(t.series[0], {
        name: "最小SOC",
        data: coloredBars(
          days.map((day) => day.kpi.minSocPercent),
          (value) => (value <= minSoc ? t.danger : t.series[0]),
        ),
        markLine: thresholdMarkLine(t, minSoc, `下限 ${formatNumber(minSoc, 0)} %`),
      }),
    ],
  };
}

function createRepresentativeNetOption(result: SolarPowerAnalysisResult, t: ChartTheme) {
  const days = result.representativeDays;
  return {
    ...baseOption(t),
    grid: gridBase({ top: 32 }),
    tooltip: {
      ...tooltipBase(t),
      axisPointer: { type: "shadow" },
      formatter: (params: TooltipParam[]) => {
        const day = params[0] ? days[params[0].dataIndex] : undefined;
        if (!day) return "";
        return `${day.label}<br/>正味収支: <b>${formatSigned(day.kpi.dailyNetWh)} Wh/day</b>`;
      },
    },
    xAxis: categoryAxis(t, days.map((day) => day.label), {
      axisLine: { onZero: false, lineStyle: { color: t.lineStrong } },
    }),
    yAxis: valueAxis(t, { name: "正味収支 [Wh/day]" }),
    series: [
      barSeries(t.series[0], {
        name: "正味収支",
        data: coloredBars(
          days.map((day) => day.kpi.dailyNetWh),
          (value) => (value < 0 ? t.danger : t.success),
        ),
        markLine: zeroMarkLine(t),
      }),
    ],
  };
}

function sweepDesignValue(result: SolarPowerAnalysisResult): number | null {
  const input = result.analysisInput;
  const value = input[input.sweepParameter];
  const lo = Math.min(input.sweepStart, input.sweepEnd);
  const hi = Math.max(input.sweepStart, input.sweepEnd);
  return Number.isFinite(value) && value >= lo && value <= hi ? value : null;
}

function createSweepOption(
  result: SolarPowerAnalysisResult,
  t: ChartTheme,
  metric: "minSoc" | "net",
) {
  const input = result.analysisInput;
  const xName = SWEEP_LABELS[input.sweepParameter];
  const designValue = sweepDesignValue(result);
  const isSoc = metric === "minSoc";
  const unit = isSoc ? "%" : "Wh/day";
  const markLineData: Array<Record<string, unknown>> = [];
  if (designValue !== null) {
    markLineData.push({
      xAxis: designValue,
      lineStyle: { color: t.fgMuted, type: "dashed", width: 1 },
      label: { formatter: "現設計", position: "insideEndTop", color: t.fgMuted, fontSize: 11 },
    });
  }
  if (isSoc) {
    markLineData.push({
      yAxis: input.minSocPercent,
      lineStyle: { color: t.danger, type: "solid", width: 1 },
      label: { formatter: `下限 ${formatNumber(input.minSocPercent, 0)} %`, position: "insideEndTop", color: t.danger, fontSize: 11 },
    });
  } else {
    markLineData.push({
      yAxis: 0,
      lineStyle: { color: t.fgSubtle, type: "solid", width: 1 },
      label: { show: false },
    });
  }
  return {
    ...baseOption(t),
    grid: gridBase({ top: 32, bottom: 28 }),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TooltipParam[]) => {
        const point = params[0] ? result.sweep[params[0].dataIndex] : undefined;
        if (!point) return "";
        const value = isSoc ? formatNumber(point.minSocPercent) : formatSigned(point.dailyNetWh);
        return `${xName}: ${formatNumber(point.inputValue)}<br/>${isSoc ? "最小SOC" : "正味収支"}: <b>${value} ${unit}</b>`;
      },
    },
    xAxis: valueXAxis(t, { name: xName, scale: true }),
    yAxis: isSoc
      ? valueAxis(t, { name: "最小SOC [%]", min: 0, max: 100, interval: 25 })
      : valueAxis(t, { name: "正味収支 [Wh/day]" }),
    series: [
      lineSeries(isSoc ? t.series[0] : t.series[2], {
        name: isSoc ? "最小SOC" : "正味収支",
        showSymbol: true,
        symbolSize: 5,
        data: result.sweep.map((point) => [point.inputValue, isSoc ? point.minSocPercent : point.dailyNetWh]),
        markLine: { symbol: "none", silent: true, data: markLineData },
      }),
    ],
  };
}

function createSummaryHtml(result: SolarPowerAnalysisResult): string {
  const kpi = result.currentDay;
  const rows = [
    ["判定", `${statusLabel(kpi.designStatus)}（${verdictDetail(result)}）`],
    ["衛星", result.satelliteLabel],
    ["最小SOC", `${formatNumber(kpi.minSocPercent)} %（下限 ${formatNumber(result.analysisInput.minSocPercent, 0)} %）`],
    ["正味収支", `${formatSigned(kpi.dailyNetWh)} Wh/day`],
    ["日陰時間/周回", `${formatNumber(kpi.eclipseMinutesPerOrbit)} min`],
    ["日照率", `${formatNumber(kpi.sunlightRatio * 100)} %`],
    ["1日発電量", `${formatNumber(kpi.dailyGenerationWh)} Wh`],
    ["1日消費量", `${formatNumber(kpi.dailyLoadWh)} Wh`],
    ["推奨最小バッテリ", `${formatNumber(kpi.minBatteryRequiredWh)} Wh`],
    ["推奨最小太陽電池出力", `${formatNumber(kpi.minSolarArrayPowerRequiredW)} W`],
    ["最悪代表日", `${result.worstRepresentativeDay.label}（${statusLabel(result.worstRepresentativeDay.kpi.designStatus)}）`],
  ];

  return `
    <table>
      <thead>
        <tr><th>項目</th><th>値</th></tr>
      </thead>
      <tbody>
        ${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function buildKpis(result: SolarPowerAnalysisResult): Kpi[] {
  const kpi = result.currentDay;
  const input = result.analysisInput;
  const socLow = kpi.minSocPercent <= input.minSocPercent;
  const batteryShort = kpi.minBatteryRequiredWh > input.batteryCapacityWh;
  return [
    {
      label: "最小SOC",
      value: formatNumber(kpi.minSocPercent),
      unit: "%",
      hint: `下限 ${formatNumber(input.minSocPercent, 0)} %`,
      tone: socLow ? "ng" : undefined,
    },
    {
      label: "正味収支/日",
      value: formatSigned(kpi.dailyNetWh),
      unit: "Wh",
      hint: `発電 ${formatNumber(kpi.dailyGenerationWh, 0)} / 消費 ${formatNumber(kpi.dailyLoadWh, 0)} Wh`,
      tone: kpi.dailyNetWh < 0 ? "warn" : undefined,
    },
    {
      label: "日陰/周回",
      value: formatNumber(kpi.eclipseMinutesPerOrbit),
      unit: "min",
      hint: `周期 ${formatNumber(kpi.orbitPeriodMinutes)} min`,
    },
    {
      label: "必要電池",
      value: formatNumber(kpi.minBatteryRequiredWh, 0),
      unit: "Wh",
      hint: `搭載 ${formatNumber(input.batteryCapacityWh, 0)} Wh`,
      tone: batteryShort ? "warn" : undefined,
    },
  ];
}

function buildMetrics(result: SolarPowerAnalysisResult): Array<[string, string]> {
  const kpi = result.currentDay;
  const worst = result.worstRepresentativeDay;
  return [
    ["衛星", result.satelliteLabel],
    ["日照率", `${formatNumber(kpi.sunlightRatio * 100)} %`],
    ["最大連続日陰", `${formatNumber(kpi.maxContinuousEclipseMinutes)} min`],
    ["発電量/日", `${formatNumber(kpi.dailyGenerationWh)} Wh`],
    ["消費量/日", `${formatNumber(kpi.dailyLoadWh)} Wh`],
    ["エネルギー不足/日", `${formatNumber(kpi.energyDeficitWh)} Wh`],
    ["最大SOC", `${formatNumber(kpi.maxSocPercent)} %`],
    ["24h後SOC", `${formatNumber(kpi.endSocPercent)} %`],
    ["必要太陽電池", `${formatNumber(kpi.minSolarArrayPowerRequiredW)} W（BOL ${formatNumber(result.analysisInput.solarArrayPowerBOL_W, 0)} W）`],
    ["最悪代表日", `${worst.label}（${statusLabel(worst.kpi.designStatus)}・最小SOC ${formatNumber(worst.kpi.minSocPercent)} %）`],
  ];
}

function HelpLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="solar-input-label">
      <span>{label}</span>
      <span className="solar-help">
        <button type="button" className="solar-help-button" aria-label={`${label}の説明`}>
          ?
        </button>
        <span className="solar-help-tooltip">{help}</span>
      </span>
    </div>
  );
}

function NumberInputRow({
  label,
  help,
  value,
  onChange,
  step,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
}) {
  return (
    <div className="solar-input-row">
      <HelpLabel label={label} help={help} />
      <input
        className="analysis-input solar-number-input"
        type="number"
        step={step}
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

const SOC_CHART_HEIGHT = 280;
const POWER_CHART_HEIGHT = 260;
const SMALL_CHART_HEIGHT = 220;

export default function SolarImpactAnalysis({ satText, constText, startTime }: Props) {
  const satellites = useMemo(() => buildSelectableSatellites(satText, constText), [satText, constText]);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string>(satellites[0]?.id ?? "");
  const [input, setInput] = useState<SolarPowerAnalysisInput>(createDefaultSolarPowerInput);
  const [result, setResult] = useState<SolarPowerAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("representative");
  const theme = useChartTheme();
  const socChartRef = useRef<ChartRef | null>(null);
  const powerChartRef = useRef<ChartRef | null>(null);
  const compareSocChartRef = useRef<ChartRef | null>(null);
  const compareNetChartRef = useRef<ChartRef | null>(null);

  const selectedSatellite = satellites.find((item) => item.id === selectedSatelliteId) ?? satellites[0];

  const resolvedSatelliteId = selectedSatellite?.id ?? "";
  if (selectedSatelliteId !== resolvedSatelliteId) setSelectedSatelliteId(resolvedSatelliteId);

  const groupedFields = useMemo(() => ({
    発電系: INPUT_FIELDS.filter((field) => field.section === "発電系"),
    負荷系: INPUT_FIELDS.filter((field) => field.section === "負荷系"),
    バッテリ系: INPUT_FIELDS.filter((field) => field.section === "バッテリ系"),
    解析設定: INPUT_FIELDS.filter((field) => field.section === "解析設定"),
    感度解析: INPUT_FIELDS.filter((field) => field.section === "感度解析"),
  }), []);

  const updateInput = <K extends keyof SolarPowerAnalysisInput>(field: K, value: SolarPowerAnalysisInput[K]) => {
    setInput((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const runAnalysis = async () => {
    if (!selectedSatellite) {
      setError("解析対象の衛星がありません");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      const analysis = analyzeSolarPower(selectedSatellite.spec, selectedSatellite.label, startTime, input);
      setResult(analysis);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "太陽光影響解析でエラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const dateStr = startTime.toISOString().slice(0, 10);

  const mountedCharts = (): ChartRef[] =>
    [socChartRef, powerChartRef, compareSocChartRef, compareNetChartRef]
      .map((ref) => ref.current)
      .filter((chart): chart is ChartRef => chart !== null);

  const downloadChartSetAsHTML = () => {
    if (!result) return;
    const charts = mountedCharts();
    if (charts.length === 0) return;
    downloadMultiChartHTML(
      charts.map((chart) => chart.getEchartsInstance().getOption()),
      "太陽光影響解析",
      `solar-impact-analysis-${dateStr}.html`,
      createSummaryHtml(result),
    );
  };

  const downloadDataCsv = () => {
    if (!result) return;
    const headers = [
      "timestamp",
      "time",
      "elapsedMinutes",
      "inSunlight",
      "generationW",
      "loadW",
      "netPowerW",
      "socPercent",
      "batteryEnergyWh",
    ];
    const rows = result.daySamples.map((sample) => [
      sample.timestamp,
      sample.timeLabel,
      sample.elapsedMinutes,
      sample.inSunlight ? 1 : 0,
      sample.generationW,
      sample.loadW,
      sample.netPowerW,
      sample.socPercent,
      sample.batteryEnergyWh,
    ]);
    downloadCSV(headers, rows, `solar-impact-data-${dateStr}.csv`);
  };

  const downloadReportJson = () => {
    if (!result) return;
    downloadJSON(result, `solar-impact-report-${dateStr}.json`);
  };

  const handleDownloadPng = () => {
    const suffix = comparisonMode === "representative" ? "seasons" : "sweep";
    downloadPNG(socChartRef, `solar-power-soc-${dateStr}.png`);
    downloadPNG(powerChartRef, `solar-power-orbit-${dateStr}.png`);
    downloadPNG(compareSocChartRef, `solar-power-${suffix}-min-soc-${dateStr}.png`);
    downloadPNG(compareNetChartRef, `solar-power-${suffix}-net-${dateStr}.png`);
  };

  const socOption = useMemo(() => (result ? createSocOption(result, theme) : null), [result, theme]);
  const powerOption = useMemo(() => (result ? createPowerOption(result, theme) : null), [result, theme]);
  const compareSocOption = useMemo(() => {
    if (!result) return null;
    return comparisonMode === "representative"
      ? createRepresentativeMinSocOption(result, theme)
      : createSweepOption(result, theme, "minSoc");
  }, [result, theme, comparisonMode]);
  const compareNetOption = useMemo(() => {
    if (!result) return null;
    return comparisonMode === "representative"
      ? createRepresentativeNetOption(result, theme)
      : createSweepOption(result, theme, "net");
  }, [result, theme, comparisonMode]);

  const kpis = useMemo(() => (result ? buildKpis(result) : []), [result]);
  const metrics = useMemo(() => (result ? buildMetrics(result) : []), [result]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="analysis-toolbar">
        <label className="analysis-input-label">
          衛星:
          <select
            className="analysis-input"
            value={selectedSatellite?.id ?? ""}
            onChange={(event) => setSelectedSatelliteId(event.target.value)}
            disabled={isAnalyzing || satellites.length === 0}
            style={{ minWidth: 220, maxWidth: "100%" }}
          >
            {satellites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <button onClick={runAnalysis} disabled={isAnalyzing || satellites.length === 0} className="analysis-primary-button">
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>

        {result && (
          <>
            <button onClick={handleDownloadPng} className="analysis-secondary-button">PNG保存</button>
            <button onClick={downloadChartSetAsHTML} className="analysis-secondary-button">HTML保存</button>
            <button onClick={downloadDataCsv} className="analysis-secondary-button">CSV保存</button>
            <button onClick={downloadReportJson} className="analysis-secondary-button">JSON保存</button>
          </>
        )}

        {error && <span className="analysis-error">{error}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto", padding: 12 }}>
        {isAnalyzing && (
          <div className="analysis-loading-overlay">
            <div className="analysis-loading-spinner" />
            <div className="analysis-loading-text">解析中...</div>
            <div className="analysis-loading-subtext">数秒お待ちください</div>
          </div>
        )}

        {!selectedSatellite && (
          <div className="analysis-error">解析対象の衛星がありません</div>
        )}

        <div className="analysis-split" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)", gap: 12 }}>
          <section className="solar-panel">
            <div className="solar-panel-header">
              <div>
                <h4 className="solar-panel-title">設計入力</h4>
                <div className="solar-panel-subtitle">100kg級衛星の初期仮定値を入れています。必要に応じて更新してください。</div>
              </div>
            </div>

            {SECTIONS.map((section) => (
              <div key={section} className="solar-section-block">
                <div className="solar-section-title">{section}</div>
                <div className="solar-form-grid">
                  {groupedFields[section].map((field) => (
                    <NumberInputRow
                      key={field.key}
                      label={field.label}
                      help={field.help}
                      value={Number(input[field.key])}
                      step={field.step}
                      onChange={(next) => updateInput(field.key, next)}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="solar-section-block">
              <div className="solar-section-title">感度解析</div>
              <div className="solar-section-note">比較グラフを「感度解析」に切り替えたときに使用します。</div>
              <div className="solar-form-grid">
                <div className="solar-input-row">
                  <HelpLabel
                    label="掃引対象"
                    help="どの設計変数を動かしたときに成立性がどう変わるかを調べます。"
                  />
                  <select
                    className="analysis-input solar-number-input"
                    value={input.sweepParameter}
                    onChange={(event) => updateInput("sweepParameter", event.target.value as SolarSweepParameter)}
                  >
                    {Object.entries(SWEEP_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                {groupedFields["感度解析"].map((field) => (
                  <NumberInputRow
                    key={field.key}
                    label={field.label}
                    help={field.help}
                    value={Number(input[field.key])}
                    step={field.step}
                    onChange={(next) => updateInput(field.key, next)}
                  />
                ))}
              </div>
            </div>
          </section>

          <div className="grid min-w-0 content-start gap-3">
            {!result || !socOption || !powerOption || !compareSocOption || !compareNetOption ? (
              <EmptyState title="解析結果はまだありません">
                左の設計入力を確認して「解析開始」を押すと、24時間の電力収支とSOC推移、日陰区間、
                代表日（春分・夏至・秋分・冬至）比較と感度解析を計算します。
              </EmptyState>
            ) : (
              <>
                <Verdict
                  tone={statusTone(result.currentDay.designStatus)}
                  label={statusLabel(result.currentDay.designStatus)}
                  detail={verdictDetail(result)}
                />

                <KpiStrip items={kpis} />

                <ChartCard
                  title="SOC 24時間推移"
                  caption={`網掛けは日陰区間。下限 ${formatNumber(result.analysisInput.minSocPercent, 0)} % 以下は赤で表示します。`}
                >
                  <ReactECharts
                    ref={socChartRef}
                    option={socOption}
                    notMerge
                    style={{ height: SOC_CHART_HEIGHT, width: "100%" }}
                  />
                </ChartCard>

                <ChartCard
                  title="周回電力"
                  caption="解析開始から1周回分の発電・消費・正味電力。網掛けは日陰区間。"
                >
                  <ReactECharts
                    ref={powerChartRef}
                    option={powerOption}
                    notMerge
                    style={{ height: POWER_CHART_HEIGHT, width: "100%" }}
                  />
                </ChartCard>

                <ChartCard
                  title={comparisonMode === "representative" ? "代表日比較" : "感度解析"}
                  caption={comparisonMode === "representative"
                    ? "春分・夏至・秋分・冬至付近での成立性を比較します。"
                    : `${SWEEP_LABELS[result.analysisInput.sweepParameter]} を掃引したときの成立性変化。破線は現設計値です。`}
                  actions={(
                    <div className="solar-segmented-control" role="group" aria-label="比較モード">
                      <button
                        type="button"
                        aria-pressed={comparisonMode === "representative"}
                        className={`solar-segment-button ${comparisonMode === "representative" ? "is-active" : ""}`}
                        onClick={() => setComparisonMode("representative")}
                      >
                        代表日比較
                      </button>
                      <button
                        type="button"
                        aria-pressed={comparisonMode === "sweep"}
                        className={`solar-segment-button ${comparisonMode === "sweep" ? "is-active" : ""}`}
                        onClick={() => setComparisonMode("sweep")}
                      >
                        感度解析
                      </button>
                    </div>
                  )}
                >
                  <div className="analysis-chart-pair grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="min-w-0">
                      <div className="solar-section-title">最小SOC</div>
                      <ReactECharts
                        key={`soc-${comparisonMode}`}
                        ref={compareSocChartRef}
                        option={compareSocOption}
                        notMerge
                        style={{ height: SMALL_CHART_HEIGHT, width: "100%" }}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="solar-section-title">正味収支/日</div>
                      <ReactECharts
                        key={`net-${comparisonMode}`}
                        ref={compareNetChartRef}
                        option={compareNetOption}
                        notMerge
                        style={{ height: SMALL_CHART_HEIGHT, width: "100%" }}
                      />
                    </div>
                  </div>
                </ChartCard>

                <ChartCard title="その他の指標">
                  <MetricList items={metrics} />
                </ChartCard>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
