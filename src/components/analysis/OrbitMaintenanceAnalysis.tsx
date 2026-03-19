import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ECBasicOption } from "echarts/types/dist/shared";
import {
  analyzeOrbitMaintenance,
  buildSelectableSatellites,
  createDefaultMaintenanceInput,
  createDesignSatelliteSpec,
  getAtmospherePresetDefaults,
  getAtmosphereScenarioLabel,
  getDefaultReferenceAltitudeKm,
  type AtmospherePresetKey,
  type MaintenanceAnalysisInput,
  type MaintenanceAnalysisResult,
  type MaintenanceSweepParameter,
  type OrbitType,
} from "../../lib/orbitMaintenanceAnalysis";
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

type InputSection = "軌道条件" | "機体条件" | "大気モデル" | "推進系";
type ComparisonMode = "scenario" | "sweep";

interface InputFieldDefinition {
  key: keyof MaintenanceAnalysisInput;
  label: string;
  help: string;
  step?: number;
  section: InputSection;
}

const SECTIONS: InputSection[] = ["軌道条件", "機体条件", "大気モデル", "推進系"];

const SWEEP_LABELS: Record<MaintenanceSweepParameter, string> = {
  ballisticCoefficient: "弾道係数 [m^2/kg]",
  f107: "F10.7",
  ap: "Ap",
  specificImpulseSec: "比推力 [s]",
  propellantMassKg: "搭載推進剤 [kg]",
  missionYears: "運用年数 [年]",
  meanAltitudeKm: "平均高度 [km]",
  eccentricity: "離心率 e",
};

const INPUT_FIELDS: InputFieldDefinition[] = [
  {
    key: "missionYears",
    label: "運用年数 [年]",
    help: "この期間に必要な軌道維持ΔVと推進剤量を見積もります。概念設計用の既定値は3年です。",
    step: 0.1,
    section: "軌道条件",
  },
  {
    key: "meanAltitudeKm",
    label: "平均高度 [km]",
    help: "概念設計の主入力です。ここで与えた平均高度から半長軸を設定します。",
    step: 1,
    section: "軌道条件",
  },
  {
    key: "inclinationDeg",
    label: "傾斜角 [deg]",
    help: "J2/J3 摂動と軌道形状の初期条件に使います。",
    step: 0.1,
    section: "軌道条件",
  },
  {
    key: "eccentricity",
    label: "離心率 e",
    help: "楕円軌道を選んだときの初期離心率です。密度は近地点高度で評価します。",
    step: 0.001,
    section: "軌道条件",
  },
  {
    key: "deorbitAltitudeKm",
    label: "寿命判定高度 [km]",
    help: "近地点高度がこの値に達したら自然寿命終端とみなします。",
    step: 1,
    section: "軌道条件",
  },
  {
    key: "timelineStepDays",
    label: "タイムライン刻み [day]",
    help: "高度低下タイムラインの刻みです。細かいほど滑らかですが計算は重くなります。",
    step: 1,
    section: "軌道条件",
  },
  {
    key: "dryMassKg",
    label: "ドライ質量 [kg]",
    help: "推進剤を除いた衛星質量です。100kg級小型衛星の既定値として100kgを入れています。",
    step: 1,
    section: "機体条件",
  },
  {
    key: "ballisticCoefficient",
    label: "弾道係数 [m^2/kg]",
    help: "CdA/m です。値が大きいほど抗力で落ちやすくなります。",
    step: 0.001,
    section: "機体条件",
  },
  {
    key: "f107",
    label: "F10.7",
    help: "10.7cm 太陽電波フラックスです。太陽活動が高いほど一般に高層大気密度は増えます。",
    step: 1,
    section: "大気モデル",
  },
  {
    key: "ap",
    label: "Ap",
    help: "地磁気活動指数です。磁気嵐が強いほど短期的な大気膨張を大きく見積もります。",
    step: 1,
    section: "大気モデル",
  },
  {
    key: "specificImpulseSec",
    label: "比推力 [s]",
    help: "推進系効率を表します。高いほど同じΔVに必要な推進剤量は減ります。",
    step: 1,
    section: "推進系",
  },
  {
    key: "propellantMassKg",
    label: "搭載推進剤 [kg]",
    help: "設計上搭載できる推進剤量です。必要量と比較して成立性を判定します。",
    step: 0.1,
    section: "推進系",
  },
  {
    key: "propellantMarginPercent",
    label: "推進剤マージン [%]",
    help: "見積り誤差や運用余裕分として必要推進剤に上乗せします。",
    step: 1,
    section: "推進系",
  },
];

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function formatDensity(value: number): string {
  return Number.isFinite(value) ? value.toExponential(2) : "N/A";
}

function formatLifetime(years: number, reached: boolean): string {
  if (!Number.isFinite(years)) return "N/A";
  return reached ? `${formatNumber(years, 1)} yr` : `${formatNumber(years, 1)}+ yr`;
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

function createAltitudeTimelineOption(result: MaintenanceAnalysisResult): ECBasicOption {
  return {
    title: { text: "自然減衰による高度低下", textStyle: { color: "#ed6d00", fontSize: 14 }, left: "center" },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params.map((param) => {
          const numericValue = getTooltipValue(param.value);
          if (numericValue === null) return null;
          return `${param.seriesName}: ${formatNumber(numericValue, 1)} km`;
        }).filter(Boolean);
        return [`経過年: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    legend: { top: 28, textStyle: { color: "#999faa" }, data: ["平均高度", "近地点高度", "遠地点高度"] },
    grid: { left: 55, right: 24, top: 80, bottom: 50 },
    xAxis: {
      type: "category",
      data: result.timeline.map((point) => formatNumber(point.elapsedYears, 1)),
      axisLabel: { color: "#999faa" },
      name: "経過年 [yr]",
      nameTextStyle: { color: "#999faa" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#999faa" },
      name: "高度 [km]",
      nameTextStyle: { color: "#999faa" },
    },
    series: [
      {
        name: "平均高度",
        type: "line",
        smooth: true,
        data: result.timeline.map((point) => point.altitudeKm),
        lineStyle: { color: "#63b3ed", width: 2 },
        itemStyle: { color: "#63b3ed" },
        areaStyle: { color: "rgba(99, 179, 237, 0.12)" },
        markLine: {
          symbol: "none",
          data: [{ yAxis: result.analysisInput.deorbitAltitudeKm, name: "寿命判定高度", lineStyle: { color: "#e53e3e", type: "dashed" } }],
        },
      },
      {
        name: "近地点高度",
        type: "line",
        smooth: true,
        data: result.timeline.map((point) => point.perigeeAltitudeKm),
        lineStyle: { color: "#f56565", width: 1.5 },
        itemStyle: { color: "#f56565" },
      },
      {
        name: "遠地点高度",
        type: "line",
        smooth: true,
        data: result.timeline.map((point) => point.apogeeAltitudeKm),
        lineStyle: { color: "#38a169", width: 1.5 },
        itemStyle: { color: "#38a169" },
      },
    ],
  };
}

function createBudgetOption(result: MaintenanceAnalysisResult): ECBasicOption {
  return {
    title: { text: "年次ΔVと推進剤消費", textStyle: { color: "#ed6d00", fontSize: 14 }, left: "center" },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    legend: { top: 28, textStyle: { color: "#999faa" }, data: ["年間ΔV", "累積推進剤"] },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params.map((param) => {
          const numericValue = getTooltipValue(param.value);
          if (numericValue === null) return null;
          return `${param.seriesName}: ${formatNumber(numericValue, 2)} ${param.seriesName === "年間ΔV" ? "m/s" : "kg"}`;
        }).filter(Boolean);
        return [`年次: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    grid: { left: 55, right: 55, top: 80, bottom: 45 },
    xAxis: { type: "category", data: result.annualBudget.map((point) => point.label), axisLabel: { color: "#999faa" } },
    yAxis: [
      { type: "value", axisLabel: { color: "#999faa" }, name: "年間ΔV [m/s]", nameTextStyle: { color: "#999faa" } },
      { type: "value", axisLabel: { color: "#999faa" }, name: "累積推進剤 [kg]", nameTextStyle: { color: "#999faa" } },
    ],
    series: [
      { name: "年間ΔV", type: "bar", data: result.annualBudget.map((point) => point.deltaV_mps), itemStyle: { color: "#ed8936" } },
      {
        name: "累積推進剤",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        data: result.annualBudget.map((_, index) => result.annualBudget.slice(0, index + 1).reduce((sum, point) => sum + point.propellantKg, 0)),
        lineStyle: { color: "#38a169", width: 2 },
        itemStyle: { color: "#38a169" },
      },
    ],
  };
}

function createComparisonOption(result: MaintenanceAnalysisResult, mode: ComparisonMode): ECBasicOption {
  if (mode === "sweep") {
    return {
      title: { text: "感度解析", textStyle: { color: "#ed6d00", fontSize: 14 }, left: "center" },
      backgroundColor: "rgba(30, 32, 36, 0.95)",
      textStyle: { color: "#f1f1f1" },
      legend: { top: 28, textStyle: { color: "#999faa" }, data: ["年間ΔV", "必要推進剤"] },
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
          const lines = params.map((param) => {
            const numericValue = getTooltipValue(param.value);
            if (numericValue === null) return null;
            return `${param.seriesName}: ${formatNumber(numericValue, 2)} ${param.seriesName === "年間ΔV" ? "m/s" : "kg"}`;
          }).filter(Boolean);
          return [`${SWEEP_LABELS[result.analysisInput.sweepParameter]}: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
        },
      },
      grid: { left: 55, right: 55, top: 80, bottom: 55 },
      xAxis: {
        type: "category",
        data: result.sweep.map((point) => formatNumber(point.inputValue, 2)),
        axisLabel: { color: "#999faa" },
        name: SWEEP_LABELS[result.analysisInput.sweepParameter],
        nameLocation: "middle",
        nameGap: 35,
        nameTextStyle: { color: "#999faa" },
      },
      yAxis: [
        { type: "value", axisLabel: { color: "#999faa" }, name: "年間ΔV [m/s]", nameTextStyle: { color: "#999faa" } },
        { type: "value", axisLabel: { color: "#999faa" }, name: "必要推進剤 [kg]", nameTextStyle: { color: "#999faa" } },
      ],
      series: [
        { name: "年間ΔV", type: "line", smooth: true, data: result.sweep.map((point) => point.annualDeltaV_mps), lineStyle: { color: "#63b3ed", width: 2 }, itemStyle: { color: "#63b3ed" } },
        { name: "必要推進剤", type: "line", smooth: true, yAxisIndex: 1, data: result.sweep.map((point) => point.requiredPropellantKg), lineStyle: { color: "#38a169", width: 2 }, itemStyle: { color: "#38a169" } },
      ],
    };
  }

  return {
    title: { text: "大気プリセット比較", textStyle: { color: "#ed6d00", fontSize: 14 }, left: "center" },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    legend: { top: 28, textStyle: { color: "#999faa" }, data: ["年間ΔV", "必要推進剤"] },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: unknown }>) => {
        const lines = params.map((param) => {
          const numericValue = getTooltipValue(param.value);
          if (numericValue === null) return null;
          return `${param.seriesName}: ${formatNumber(numericValue, 2)} ${param.seriesName === "年間ΔV" ? "m/s" : "kg"}`;
        }).filter(Boolean);
        return [`シナリオ: ${params[0]?.axisValueLabel ?? ""}`, ...lines].join("<br/>");
      },
    },
    grid: { left: 55, right: 55, top: 80, bottom: 45 },
    xAxis: { type: "category", data: result.scenarioComparisons.map((entry) => entry.label), axisLabel: { color: "#999faa" } },
    yAxis: [
      { type: "value", axisLabel: { color: "#999faa" }, name: "年間ΔV [m/s]", nameTextStyle: { color: "#999faa" } },
      { type: "value", axisLabel: { color: "#999faa" }, name: "必要推進剤 [kg]", nameTextStyle: { color: "#999faa" } },
    ],
    series: [
      { name: "年間ΔV", type: "bar", data: result.scenarioComparisons.map((entry) => entry.missionDeltaV_mps / Math.max(result.analysisInput.missionYears, 1e-6)), itemStyle: { color: "#ed8936" } },
      { name: "必要推進剤", type: "line", smooth: true, yAxisIndex: 1, data: result.scenarioComparisons.map((entry) => entry.requiredPropellantKg), lineStyle: { color: "#38a169", width: 2 }, itemStyle: { color: "#38a169" } },
    ],
  };
}

function createSummaryHtml(result: MaintenanceAnalysisResult): string {
  const rows = [
    ["設計ケース", result.satelliteLabel],
    ["大気モデル", result.kpi.atmosphereModelLabel],
    ["大気プリセット", result.currentScenarioLabel],
    ["F10.7", `${formatNumber(result.kpi.f107, 0)}`],
    ["Ap", `${formatNumber(result.kpi.ap, 0)}`],
    ["平均高度", `${formatNumber(result.kpi.initialAltitudeKm, 1)} km`],
    ["初期近地点", `${formatNumber(result.kpi.initialPerigeeAltitudeKm, 1)} km`],
    ["初期遠地点", `${formatNumber(result.kpi.initialApogeeAltitudeKm, 1)} km`],
    ["初期離心率", `${formatNumber(result.kpi.initialEccentricity, 4)}`],
    ["年間高度低下", `${formatNumber(result.kpi.annualAltitudeLossKm, 2)} km/yr`],
    ["年間ΔV", `${formatNumber(result.kpi.annualDeltaV_mps, 2)} m/s`],
    ["総ΔV", `${formatNumber(result.kpi.missionDeltaV_mps, 2)} m/s`],
    ["必要推進剤", `${formatNumber(result.kpi.requiredPropellantWithMarginKg, 2)} kg`],
    ["自然寿命", formatLifetime(result.kpi.naturalLifetimeYears, result.kpi.naturalLifetimeReached)],
  ];
  return `<table><thead><tr><th>項目</th><th>値</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("")}</tbody></table>`;
}

function statusLabel(status: MaintenanceAnalysisResult["kpi"]["designStatus"]): string {
  switch (status) {
    case "nominal": return "成立";
    case "warning": return "要調整";
    case "critical": return "不成立";
    default: return status;
  }
}

function createAtmosphereModelSummary(result: MaintenanceAnalysisResult): string {
  return [
    "Harris-Priester 系の簡易大気モデルを使用しています。",
    `現在は F10.7=${formatNumber(result.kpi.f107, 0)}、Ap=${formatNumber(result.kpi.ap, 0)} を入力として使っています。`,
    "高度依存は高層大気密度テーブルを対数補間し、太陽活動と地磁気活動で密度を補正しています。",
    "抗力密度は各時刻の近地点高度で評価しています。",
    result.kpi.initialEccentricity > 0.01
      ? "楕円軌道では半長軸 a と離心率 e を時間発展させています。ΔV は平均高度へ戻す等価リブースト近似です。"
      : "近円軌道の概念設計用近似として使えます。",
  ].join(" ");
}

function HelpLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="solar-input-label">
      <span>{label}</span>
      <span className="solar-help">
        <button type="button" className="solar-help-button" aria-label={`${label}の説明`}>?</button>
        <span className="solar-help-tooltip">{help}</span>
      </span>
    </div>
  );
}

function NumberInputRow({ label, help, value, onChange, step, disabled }: { label: string; help: string; value: number; onChange: (next: number) => void; step?: number; disabled?: boolean }) {
  return (
    <div className="solar-input-row">
      <HelpLabel label={label} help={help} />
      <input className="analysis-input solar-number-input" type="number" step={step} value={String(value)} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export default function OrbitMaintenanceAnalysis({ satText, constText, startTime }: Props) {
  const templates = useMemo(() => buildSelectableSatellites(satText, constText), [satText, constText]);
  const [templateId, setTemplateId] = useState("");
  const [caseName, setCaseName] = useState("100kg級LEO設計ケース");
  const [input, setInput] = useState<MaintenanceAnalysisInput>(() => createDefaultMaintenanceInput());
  const [result, setResult] = useState<MaintenanceAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("scenario");
  const altitudeChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const budgetChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const comparisonChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);

  const groupedFields = useMemo(() => ({
    "軌道条件": INPUT_FIELDS.filter((field) => field.section === "軌道条件"),
    "機体条件": INPUT_FIELDS.filter((field) => field.section === "機体条件"),
    "大気モデル": INPUT_FIELDS.filter((field) => field.section === "大気モデル"),
    "推進系": INPUT_FIELDS.filter((field) => field.section === "推進系"),
  }), []);

  const primaryKpis = result ? [
    ["平均高度", `${formatNumber(result.kpi.initialAltitudeKm, 1)} km`],
    ["高度低下/年", `${formatNumber(result.kpi.annualAltitudeLossKm, 2)} km`],
    ["年間ΔV", `${formatNumber(result.kpi.annualDeltaV_mps, 2)} m/s`],
    ["総ΔV", `${formatNumber(result.kpi.missionDeltaV_mps, 2)} m/s`],
    ["必要推進剤", `${formatNumber(result.kpi.requiredPropellantKg, 2)} kg`],
    ["自然寿命", formatLifetime(result.kpi.naturalLifetimeYears, result.kpi.naturalLifetimeReached)],
  ] : [];

  const secondaryKpis = result ? [
    ["初期e", `${formatNumber(result.kpi.initialEccentricity, 4)}`],
    ["近地点", `${formatNumber(result.kpi.initialPerigeeAltitudeKm, 1)} km`],
    ["遠地点", `${formatNumber(result.kpi.initialApogeeAltitudeKm, 1)} km`],
    ["F10.7 / Ap", `${formatNumber(result.kpi.f107, 0)} / ${formatNumber(result.kpi.ap, 0)}`],
    ["平均密度", `${formatDensity(result.kpi.meanDensityKgPerM3)} kg/m^3`],
    ["必要量+マージン", `${formatNumber(result.kpi.requiredPropellantWithMarginKg, 2)} kg`],
    ["最悪プリセット", result.worstScenario.label],
    ["状態", statusLabel(result.kpi.designStatus)],
  ] : [];

  const updateInput = <K extends keyof MaintenanceAnalysisInput>(field: K, value: MaintenanceAnalysisInput[K]) => {
    setInput((current) => ({ ...current, [field]: value }));
  };

  const applyTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    const selected = templates.find((item) => item.id === nextTemplateId);
    if (!selected) return;
    const meanAltitudeKm = Number(getDefaultReferenceAltitudeKm(selected.spec, startTime).toFixed(1));
    const eccentricity = selected.spec.type === "elements" ? selected.spec.elements.eccentricity : 0;
    const inclinationDeg = selected.spec.type === "elements" ? selected.spec.elements.inclinationDeg : 0;
    setCaseName(`${selected.label} ベース設計ケース`);
    setInput((current) => ({
      ...current,
      orbitType: eccentricity > 0.001 ? "elliptical" : "circular",
      meanAltitudeKm,
      eccentricity,
      inclinationDeg: Number((inclinationDeg || 0).toFixed(2)),
      missionYears: current.missionYears,
      deorbitAltitudeKm: current.deorbitAltitudeKm,
      timelineStepDays: current.timelineStepDays,
    }));
  };

  const applyAtmospherePreset = (preset: AtmospherePresetKey) => {
    const defaults = getAtmospherePresetDefaults(preset);
    setInput((current) => ({
      ...current,
      atmospherePreset: preset,
      f107: defaults.f107,
      ap: defaults.ap,
    }));
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      const designSpec = createDesignSatelliteSpec(
        {
          meanAltitudeKm: input.meanAltitudeKm,
          eccentricity: input.orbitType === "circular" ? 0 : input.eccentricity,
          inclinationDeg: input.inclinationDeg,
        },
        startTime,
      );
      const analysis = analyzeOrbitMaintenance(designSpec, caseName, startTime, input);
      setResult(analysis);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "軌道維持燃料解析でエラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const dateStr = useMemo(() => startTime.toISOString().slice(0, 10), [startTime]);
  const altitudeOption = useMemo(() => result ? createAltitudeTimelineOption(result) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result]);
  const budgetOption = useMemo(() => result ? createBudgetOption(result) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result]);
  const comparisonOption = useMemo(() => result ? createComparisonOption(result, comparisonMode) : { backgroundColor: "rgba(30, 32, 36, 0.95)" }, [result, comparisonMode]);

  const downloadChartSetAsHTML = () => {
    if (!altitudeChartRef.current || !budgetChartRef.current || !comparisonChartRef.current || !result) return;
    downloadMultiChartHTML(
      [
        altitudeChartRef.current.getEchartsInstance().getOption(),
        budgetChartRef.current.getEchartsInstance().getOption(),
        comparisonChartRef.current.getEchartsInstance().getOption(),
      ],
      "軌道維持燃料解析",
      `orbit-maintenance-analysis-${dateStr}.html`,
      createSummaryHtml(result),
    );
  };

  const downloadDataCsv = () => {
    if (!result) return;
    const headers = ["section", "label", "atmosphereModel", "preset", "f107", "ap", "altitudeKm", "perigeeAltitudeKm", "apogeeAltitudeKm", "eccentricity", "densityReferenceAltitudeKm", "densityKgPerM3", "deltaV_mps", "propellantKg"];
    const metadataRows = [
      ["metadata", result.satelliteLabel, result.kpi.atmosphereModelLabel, result.currentScenarioLabel, result.kpi.f107, result.kpi.ap, "", "", "", "", "", "", "", ""],
    ];
    const timelineRows = result.timeline.map((point) => ["timeline", formatNumber(point.elapsedYears, 3), result.kpi.atmosphereModelLabel, result.currentScenarioLabel, result.kpi.f107, result.kpi.ap, point.altitudeKm, point.perigeeAltitudeKm, point.apogeeAltitudeKm, point.eccentricity, point.densityReferenceAltitudeKm, point.densityKgPerM3, "", ""]);
    const budgetRows = result.annualBudget.map((point) => ["annualBudget", point.label, result.kpi.atmosphereModelLabel, result.currentScenarioLabel, result.kpi.f107, result.kpi.ap, point.altitudeLossKm, "", "", "", "", "", point.deltaV_mps, point.propellantKg]);
    const scenarioRows = result.scenarioComparisons.map((point) => ["scenario", point.label, "Harris-Priester", point.label, "", "", point.annualAltitudeLossKm, "", "", "", "", "", point.missionDeltaV_mps, point.requiredPropellantKg]);
    downloadCSV(headers, [...metadataRows, ...timelineRows, ...budgetRows, ...scenarioRows], `orbit-maintenance-data-${dateStr}.csv`);
  };

  const downloadReportJson = () => {
    if (!result) return;
    downloadJSON(result, `orbit-maintenance-report-${dateStr}.json`);
  };

  const handleDownloadPng = () => {
    downloadPNG(altitudeChartRef, `orbit-maintenance-altitude-${dateStr}.png`);
    downloadPNG(budgetChartRef, `orbit-maintenance-budget-${dateStr}.png`);
    downloadPNG(comparisonChartRef, `orbit-maintenance-comparison-${dateStr}.png`);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="analysis-toolbar">
        <label className="analysis-input-label">
          ケース名:
          <input className="analysis-input" value={caseName} onChange={(event) => setCaseName(event.target.value)} style={{ minWidth: 220 }} />
        </label>
        <label className="analysis-input-label">
          テンプレート:
          <select className="analysis-input" value={templateId} onChange={(event) => applyTemplate(event.target.value)} style={{ minWidth: 220 }}>
            <option value="">未使用</option>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button onClick={runAnalysis} disabled={isAnalyzing} className="analysis-primary-button">{isAnalyzing ? "解析中..." : "解析開始"}</button>
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

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 12 }}>
          <section className="solar-panel">
            <div className="solar-panel-header">
              <div>
                <h4 className="solar-panel-title">設計入力</h4>
                <div className="solar-panel-subtitle">概念設計用に、軌道条件と機体条件を直接入力するツールへ整理しています。テンプレート読込は初期値投入用です。</div>
              </div>
            </div>

            <div className="solar-section-block">
              <div className="solar-section-title">軌道タイプ</div>
              <div className="solar-form-grid">
                <div className="solar-input-row">
                  <HelpLabel label="軌道種別" help="円軌道なら e=0 固定、楕円軌道なら離心率 e を入力します。" />
                  <select className="analysis-input solar-number-input" value={input.orbitType} onChange={(event) => updateInput("orbitType", event.target.value as OrbitType)}>
                    <option value="circular">円軌道</option>
                    <option value="elliptical">楕円軌道</option>
                  </select>
                </div>
                <div className="solar-input-row">
                  <HelpLabel label="大気プリセット" help="Quiet / Nominal / Active / Storm の代表条件です。選ぶと F10.7 と Ap の初期値を更新します。" />
                  <select className="analysis-input solar-number-input" value={input.atmospherePreset} onChange={(event) => applyAtmospherePreset(event.target.value as AtmospherePresetKey)}>
                    {(["quiet", "nominal", "active", "storm"] as AtmospherePresetKey[]).map((key) => (
                      <option key={key} value={key}>{getAtmosphereScenarioLabel(key)}</option>
                    ))}
                  </select>
                </div>
                <div className="solar-input-row">
                  <HelpLabel label="モデル" help="現在は Harris-Priester 系簡易モデルを使います。LEO 概念設計向けです。" />
                  <input className="analysis-input solar-number-input" value="Harris-Priester" disabled />
                </div>
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
                      disabled={field.key === "eccentricity" && input.orbitType === "circular"}
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
                  <HelpLabel label="掃引対象" help="どの設計変数を変えたときに年間ΔVと必要推進剤がどう変わるかを見ます。" />
                  <select className="analysis-input solar-number-input" value={input.sweepParameter} onChange={(event) => updateInput("sweepParameter", event.target.value as MaintenanceSweepParameter)}>
                    {Object.entries(SWEEP_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <NumberInputRow label="掃引開始値" help="感度解析で最初に試す値です。" value={input.sweepStart} step={0.1} onChange={(next) => updateInput("sweepStart", next)} />
                <NumberInputRow label="掃引終了値" help="感度解析で最後に試す値です。" value={input.sweepEnd} step={0.1} onChange={(next) => updateInput("sweepEnd", next)} />
                <NumberInputRow label="分割数" help="何点評価するかです。" value={input.sweepSteps} step={1} onChange={(next) => updateInput("sweepSteps", next)} />
              </div>
            </div>

            {result && (
              <div className="solar-section-block">
                <div className="solar-section-title">大気モデル</div>
                <div className="solar-section-note">{createAtmosphereModelSummary(result)}</div>
              </div>
            )}
          </section>

          <div style={{ display: "grid", gridTemplateRows: "auto auto auto", gap: 12, minWidth: 0 }}>
            <section className="solar-panel">
              <div className="solar-panel-header">
                <div>
                  <h4 className="solar-panel-title">KPI</h4>
                  <div className="solar-panel-subtitle">概念設計に必要な寿命、年間ΔV、必要推進剤をまとめています。</div>
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
                        {label === "状態" ? <div className={`solar-status-badge solar-status-${result.kpi.designStatus}`}>{value}</div> : <div className="solar-kpi-value solar-kpi-value-secondary">{value}</div>}
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
                <ReactECharts ref={altitudeChartRef} option={altitudeOption} style={{ height: 280, width: "100%" }} theme="dark" />
              </div>
              <div style={{ minHeight: 280 }}>
                <ReactECharts ref={budgetChartRef} option={budgetOption} style={{ height: 280, width: "100%" }} theme="dark" />
              </div>
            </div>

            <section className="solar-panel">
              <div className="solar-compare-header">
                <div>
                  <h4 className="solar-panel-title">{comparisonMode === "scenario" ? "大気プリセット比較" : "感度解析"}</h4>
                  <div className="solar-panel-subtitle">
                    {comparisonMode === "scenario"
                      ? "Quiet / Nominal / Active / Storm で軌道維持要求がどう変わるかを比較します。"
                      : "選択した設計変数を掃引したときの年間ΔVと必要推進剤の変化を表示します。"}
                  </div>
                </div>
                <div className="solar-segmented-control">
                  <button type="button" className={`solar-segment-button ${comparisonMode === "scenario" ? "is-active" : ""}`} onClick={() => setComparisonMode("scenario")}>シナリオ比較</button>
                  <button type="button" className={`solar-segment-button ${comparisonMode === "sweep" ? "is-active" : ""}`} onClick={() => setComparisonMode("sweep")}>感度解析</button>
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
