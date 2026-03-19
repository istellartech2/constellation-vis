import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ECBasicOption } from "echarts/types/dist/shared";
import {
  analyzeSolarPower,
  buildSelectableSatellites,
  createDefaultSolarPowerInput,
  type SolarPowerAnalysisInput,
  type SolarPowerAnalysisResult,
  type SolarSweepParameter,
} from "../../lib/solarPowerAnalysis";
import {
  downloadCSV,
  downloadJSON,
  downloadMultiChartHTML,
  downloadPNG,
} from "./utils/downloadUtils";

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

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function formatEngineeringValue(value: number, unit: string, digits = 1): string {
  return `${formatNumber(value, digits)} ${unit}`;
}

function getTooltipValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const candidate = value.at(-1);
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  }
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function createPowerTimelineOption(result: SolarPowerAnalysisResult): ECBasicOption {
  return {
    title: {
      text: "周回電力タイムライン",
      textStyle: { color: "#ed6d00", fontSize: 14 },
      left: "center",
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    legend: {
      top: 28,
      textStyle: { color: "#999faa" },
      data: ["発電電力", "消費電力", "正味電力"],
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params
          .map((param) => {
            const numericValue = getTooltipValue(param.value);
            if (numericValue === null) return null;
            return `${param.seriesName}: ${formatEngineeringValue(numericValue, "W", 1)}`;
          })
          .filter(Boolean);
        return [`時刻: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    grid: { left: 50, right: 20, top: 80, bottom: 45 },
    xAxis: {
      type: "category",
      data: result.orbitSamples.map((sample) => sample.timeLabel.slice(0, 5)),
      axisLabel: { color: "#999faa" },
      name: "時刻 (UTC)",
      nameTextStyle: { color: "#999faa" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#999faa" },
      name: "電力 [W]",
      nameTextStyle: { color: "#999faa" },
    },
    series: [
      {
        name: "発電電力",
        type: "line",
        smooth: true,
        data: result.orbitSamples.map((sample) => sample.generationW),
        lineStyle: { color: "#38a169", width: 2 },
        itemStyle: { color: "#38a169" },
        areaStyle: { color: "rgba(56, 161, 105, 0.15)" },
      },
      {
        name: "消費電力",
        type: "line",
        smooth: true,
        data: result.orbitSamples.map((sample) => sample.loadW),
        lineStyle: { color: "#ed8936", width: 2 },
        itemStyle: { color: "#ed8936" },
      },
      {
        name: "正味電力",
        type: "line",
        smooth: true,
        data: result.orbitSamples.map((sample) => sample.netPowerW),
        lineStyle: { color: "#63b3ed", width: 2 },
        itemStyle: { color: "#63b3ed" },
      },
    ],
  };
}

function createSocTimelineOption(result: SolarPowerAnalysisResult): ECBasicOption {
  return {
    title: {
      text: "24時間SOC推移",
      textStyle: { color: "#ed6d00", fontSize: 14 },
      left: "center",
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params
          .map((param) => {
            const numericValue = getTooltipValue(param.value);
            if (numericValue === null) return null;
            return `${param.seriesName}: ${formatEngineeringValue(numericValue, "%", 1)}`;
          })
          .filter(Boolean);
        return [`時刻: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    grid: { left: 50, right: 20, top: 50, bottom: 45 },
    xAxis: {
      type: "category",
      data: result.daySamples.map((sample) => sample.timeLabel.slice(0, 5)),
      axisLabel: { color: "#999faa" },
      name: "時刻 (UTC)",
      nameTextStyle: { color: "#999faa" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { color: "#999faa" },
      name: "SOC [%]",
      nameTextStyle: { color: "#999faa" },
    },
    series: [
      {
        name: "SOC",
        type: "line",
        smooth: true,
        data: result.daySamples.map((sample) => sample.socPercent),
        lineStyle: { color: "#9f7aea", width: 2 },
        itemStyle: { color: "#9f7aea" },
        areaStyle: { color: "rgba(159, 122, 234, 0.18)" },
        markLine: {
          symbol: "none",
          lineStyle: { color: "#e53e3e", type: "dashed" },
          data: [{ yAxis: result.analysisInput.minSocPercent, name: "最低SOC" }],
        },
      },
    ],
  };
}

function createComparisonOption(result: SolarPowerAnalysisResult, mode: ComparisonMode): ECBasicOption {
  if (mode === "sweep") {
    return {
      title: {
        text: "感度解析",
        textStyle: { color: "#ed6d00", fontSize: 14 },
        left: "center",
      },
      backgroundColor: "rgba(30, 32, 36, 0.95)",
      textStyle: { color: "#f1f1f1" },
      legend: {
        top: 28,
        textStyle: { color: "#999faa" },
        data: ["最小SOC", "正味収支"],
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
          const lines = params
            .map((param) => {
              const numericValue = getTooltipValue(param.value);
              if (numericValue === null) return null;
              const unit = param.seriesName === "最小SOC" ? "%" : "Wh/day";
              const digits = param.seriesName === "最小SOC" ? 1 : 1;
              return `${param.seriesName}: ${formatEngineeringValue(numericValue, unit, digits)}`;
            })
            .filter(Boolean);
          return [`${SWEEP_LABELS[result.analysisInput.sweepParameter]}: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
        },
      },
      grid: { left: 50, right: 50, top: 80, bottom: 55 },
      xAxis: {
        type: "category",
        data: result.sweep.map((point) => formatNumber(point.inputValue, 1)),
        axisLabel: { color: "#999faa" },
        name: SWEEP_LABELS[result.analysisInput.sweepParameter],
        nameLocation: "middle",
        nameGap: 35,
        nameTextStyle: { color: "#999faa" },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          max: 100,
          axisLabel: { color: "#999faa" },
          name: "最小SOC [%]",
          nameTextStyle: { color: "#999faa" },
        },
        {
          type: "value",
          axisLabel: { color: "#999faa" },
          name: "正味収支 [Wh/day]",
          nameTextStyle: { color: "#999faa" },
        },
      ],
      series: [
        {
          name: "最小SOC",
          type: "line",
          smooth: true,
          data: result.sweep.map((point) => point.minSocPercent),
          lineStyle: { color: "#63b3ed", width: 2 },
          itemStyle: { color: "#63b3ed" },
        },
        {
          name: "正味収支",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          data: result.sweep.map((point) => point.dailyNetWh),
          lineStyle: { color: "#38a169", width: 2 },
          itemStyle: { color: "#38a169" },
        },
      ],
    };
  }

  return {
    title: {
      text: "年代表点比較",
      textStyle: { color: "#ed6d00", fontSize: 14 },
      left: "center",
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    legend: {
      top: 28,
      textStyle: { color: "#999faa" },
      data: ["最小SOC", "正味収支"],
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params
          .map((param) => {
            const numericValue = getTooltipValue(param.value);
            if (numericValue === null) return null;
            const unit = param.seriesName === "最小SOC" ? "%" : "Wh/day";
            return `${param.seriesName}: ${formatEngineeringValue(numericValue, unit, 1)}`;
          })
          .filter(Boolean);
        return [`代表日: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    grid: { left: 50, right: 50, top: 80, bottom: 45 },
    xAxis: {
      type: "category",
      data: result.representativeDays.map((entry) => entry.label),
      axisLabel: { color: "#999faa" },
    },
    yAxis: [
      {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: "#999faa" },
        name: "最小SOC [%]",
        nameTextStyle: { color: "#999faa" },
      },
      {
        type: "value",
        axisLabel: { color: "#999faa" },
        name: "正味収支 [Wh/day]",
        nameTextStyle: { color: "#999faa" },
      },
    ],
    series: [
      {
        name: "最小SOC",
        type: "bar",
        data: result.representativeDays.map((entry) => entry.kpi.minSocPercent),
        itemStyle: { color: "#63b3ed" },
      },
      {
        name: "正味収支",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        data: result.representativeDays.map((entry) => entry.kpi.dailyNetWh),
        lineStyle: { color: "#38a169", width: 2 },
        itemStyle: { color: "#38a169" },
      },
    ],
  };
}

function createSummaryHtml(result: SolarPowerAnalysisResult): string {
  const rows = [
    ["衛星", result.satelliteLabel],
    ["日陰時間/周回", `${formatNumber(result.currentDay.eclipseMinutesPerOrbit, 1)} min`],
    ["日照率", `${formatNumber(result.currentDay.sunlightRatio * 100, 1)} %`],
    ["1日発電量", `${formatNumber(result.currentDay.dailyGenerationWh, 1)} Wh`],
    ["1日消費量", `${formatNumber(result.currentDay.dailyLoadWh, 1)} Wh`],
    ["正味収支", `${formatNumber(result.currentDay.dailyNetWh, 1)} Wh/day`],
    ["最小SOC", `${formatNumber(result.currentDay.minSocPercent, 1)} %`],
    ["推奨最小バッテリ", `${formatNumber(result.currentDay.minBatteryRequiredWh, 1)} Wh`],
    ["推奨最小太陽電池出力", `${formatNumber(result.currentDay.minSolarArrayPowerRequiredW, 1)} W`],
    ["最悪代表日", result.worstRepresentativeDay.label],
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

function statusLabel(status: SolarPowerAnalysisResult["currentDay"]["designStatus"]): string {
  switch (status) {
    case "nominal":
      return "成立";
    case "warning":
      return "要調整";
    case "critical":
      return "不成立";
    default:
      return status;
  }
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

export default function SolarImpactAnalysis({ satText, constText, startTime }: Props) {
  const satellites = useMemo(() => buildSelectableSatellites(satText, constText), [satText, constText]);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string>(satellites[0]?.id ?? "");
  const [input, setInput] = useState<SolarPowerAnalysisInput>(createDefaultSolarPowerInput);
  const [result, setResult] = useState<SolarPowerAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("representative");
  const powerChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const socChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const comparisonChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);

  const selectedSatellite = satellites.find((item) => item.id === selectedSatelliteId) ?? satellites[0];

  useEffect(() => {
    if (!satellites.length) {
      setSelectedSatelliteId("");
      return;
    }
    if (!satellites.some((item) => item.id === selectedSatelliteId)) {
      setSelectedSatelliteId(satellites[0].id);
    }
  }, [satellites, selectedSatelliteId]);

  const groupedFields = useMemo(() => ({
    発電系: INPUT_FIELDS.filter((field) => field.section === "発電系"),
    負荷系: INPUT_FIELDS.filter((field) => field.section === "負荷系"),
    バッテリ系: INPUT_FIELDS.filter((field) => field.section === "バッテリ系"),
    解析設定: INPUT_FIELDS.filter((field) => field.section === "解析設定"),
    感度解析: INPUT_FIELDS.filter((field) => field.section === "感度解析"),
  }), []);

  const primaryKpis = result ? [
    ["日陰/周回", `${formatNumber(result.currentDay.eclipseMinutesPerOrbit, 1)} min`],
    ["日照率", `${formatNumber(result.currentDay.sunlightRatio * 100, 1)} %`],
    ["発電量/日", `${formatNumber(result.currentDay.dailyGenerationWh, 1)} Wh`],
    ["消費量/日", `${formatNumber(result.currentDay.dailyLoadWh, 1)} Wh`],
    ["正味収支", `${formatNumber(result.currentDay.dailyNetWh, 1)} Wh/day`],
    ["最小SOC", `${formatNumber(result.currentDay.minSocPercent, 1)} %`],
  ] : [];

  const secondaryKpis = result ? [
    ["軌道周期", `${formatNumber(result.currentDay.orbitPeriodMinutes, 1)} min`],
    ["最大連続日陰", `${formatNumber(result.currentDay.maxContinuousEclipseMinutes, 1)} min`],
    ["必要電池", `${formatNumber(result.currentDay.minBatteryRequiredWh, 1)} Wh`],
    ["必要太陽電池", `${formatNumber(result.currentDay.minSolarArrayPowerRequiredW, 1)} W`],
    ["最悪代表日", result.worstRepresentativeDay.label],
    ["状態", statusLabel(result.currentDay.designStatus)],
  ] : [];

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

  const downloadChartSetAsHTML = () => {
    if (!powerChartRef.current || !socChartRef.current || !comparisonChartRef.current || !result) return;
    downloadMultiChartHTML(
      [
        powerChartRef.current.getEchartsInstance().getOption(),
        socChartRef.current.getEchartsInstance().getOption(),
        comparisonChartRef.current.getEchartsInstance().getOption(),
      ],
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

  const dateStr = useMemo(() => startTime.toISOString().slice(0, 10), [startTime]);

  const downloadReportJson = () => {
    if (!result) return;
    downloadJSON(result, `solar-impact-report-${dateStr}.json`);
  };

  const handleDownloadPng = () => {
    downloadPNG(powerChartRef, `solar-power-orbit-${dateStr}.png`);
    downloadPNG(socChartRef, `solar-power-soc-${dateStr}.png`);
    downloadPNG(comparisonChartRef, `solar-power-comparison-${dateStr}.png`);
  };

  const powerOption = useMemo(() => result ? createPowerTimelineOption(result) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result]);
  const socOption = useMemo(() => result ? createSocTimelineOption(result) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result]);
  const comparisonOption = useMemo(() => result ? createComparisonOption(result, comparisonMode) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result, comparisonMode]);

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
            style={{ minWidth: 220 }}
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

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 12 }}>
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

          <div style={{ display: "grid", gridTemplateRows: "auto auto auto", gap: 12, minWidth: 0 }}>
            <section className="solar-panel">
              <div className="solar-panel-header">
                <div>
                  <h4 className="solar-panel-title">KPI</h4>
                  <div className="solar-panel-subtitle">主要指標を上段、補助指標を下段にまとめています。</div>
                </div>
              </div>
              {result ? (
                <>
                  <div className="solar-kpi-grid">
                    {primaryKpis.map(([label, value]) => (
                      <div key={label} className="solar-kpi-card">
                        <div className="solar-kpi-label">{label}</div>
                        <div className="solar-kpi-value">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="solar-kpi-grid solar-kpi-grid-secondary">
                    {secondaryKpis.map(([label, value]) => (
                      <div key={label} className="solar-kpi-card solar-kpi-card-secondary">
                        <div className="solar-kpi-label">{label}</div>
                        {label === "状態" ? (
                          <div className={`solar-status-badge solar-status-${result.currentDay.designStatus}`}>{value}</div>
                        ) : (
                          <div className="solar-kpi-value solar-kpi-value-secondary">{value}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ color: "#9ca3af" }}>解析開始後に指標を表示します。</div>
              )}
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minWidth: 0 }}>
              <div style={{ minHeight: 280 }}>
                <ReactECharts ref={powerChartRef} option={powerOption} style={{ height: 280, width: "100%" }} theme="dark" />
              </div>
              <div style={{ minHeight: 280 }}>
                <ReactECharts ref={socChartRef} option={socOption} style={{ height: 280, width: "100%" }} theme="dark" />
              </div>
            </div>

            <section className="solar-panel">
              <div className="solar-compare-header">
                <div>
                  <h4 className="solar-panel-title">{comparisonMode === "representative" ? "年代表点比較" : "感度解析"}</h4>
                  <div className="solar-panel-subtitle">
                    {comparisonMode === "representative"
                      ? "春分・夏至・秋分・冬至付近での成立性を比較します。"
                      : "選択した設計変数を掃引したときの成立性変化を表示します。"}
                  </div>
                </div>
                <div className="solar-segmented-control">
                  <button
                    type="button"
                    className={`solar-segment-button ${comparisonMode === "representative" ? "is-active" : ""}`}
                    onClick={() => setComparisonMode("representative")}
                  >
                    代表日比較
                  </button>
                  <button
                    type="button"
                    className={`solar-segment-button ${comparisonMode === "sweep" ? "is-active" : ""}`}
                    onClick={() => setComparisonMode("sweep")}
                  >
                    感度解析
                  </button>
                </div>
              </div>
              <div style={{ minHeight: 320 }}>
                <ReactECharts ref={comparisonChartRef} option={comparisonOption} style={{ height: 320, width: "100%" }} theme="dark" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
