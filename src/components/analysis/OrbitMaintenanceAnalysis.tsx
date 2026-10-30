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
import { useChartTheme, type ChartTheme } from "./utils/chartTheme";
import {
  baseOption,
  barSeries,
  categoryAxis,
  gridBase,
  legendBase,
  lineSeries,
  thresholdMarkLine,
  tooltipBase,
  valueAxis,
  valueXAxis,
} from "./utils/chartBase";
import { ChartCard, EmptyState, KpiStrip, MetricList, Verdict, type Kpi, type VerdictTone } from "./AnalysisLayout";

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

type TipParam = { axisValueLabel?: string; seriesName?: string; value?: unknown; dataIndex?: number; name?: string };

/** Perigee/apogee count as distinct lines only when they leave the mean by more than this. */
const CIRCULAR_TOLERANCE_KM = 1;

function isEffectivelyCircular(result: MaintenanceAnalysisResult): boolean {
  return result.timeline.every(
    (p) =>
      Math.abs(p.perigeeAltitudeKm - p.altitudeKm) <= CIRCULAR_TOLERANCE_KM &&
      Math.abs(p.apogeeAltitudeKm - p.altitudeKm) <= CIRCULAR_TOLERANCE_KM,
  );
}

function createAltitudeTimelineOption(result: MaintenanceAnalysisResult, t: ChartTheme): ECBasicOption {
  const color = t.series[0];
  const circular = isEffectivelyCircular(result);
  const timeline = result.timeline;
  const threshold = result.analysisInput.deorbitAltitudeKm;
  const lifetime = result.kpi.naturalLifetimeYears;
  const lastYear = timeline.at(-1)?.elapsedYears ?? 0;
  const showLifetime = result.kpi.naturalLifetimeReached && Number.isFinite(lifetime) && lifetime <= lastYear + 1e-6;

  const meanSeries = lineSeries(color, {
    name: "平均高度",
    data: timeline.map((p) => [p.elapsedYears, p.altitudeKm]),
    markLine: thresholdMarkLine(t, threshold, `寿命判定高度 ${formatNumber(threshold, 0)} km`),
    ...(showLifetime
      ? {
          markPoint: {
            silent: true,
            symbol: "circle",
            symbolSize: 9,
            itemStyle: { color: t.danger, borderColor: t.surface, borderWidth: 2 },
            label: {
              show: true,
              position: "top",
              color: t.fg,
              fontSize: 11,
              formatter: `自然寿命 ${formatNumber(lifetime, 1)} yr`,
            },
            data: [{ coord: [lifetime, threshold] }],
          },
        }
      : {}),
  });

  const bandSeries = circular
    ? []
    : [
        // Invisible base at perigee; the stacked span up to apogee is the light band.
        lineSeries(color, {
          name: "近地点",
          data: timeline.map((p) => [p.elapsedYears, p.perigeeAltitudeKm]),
          stack: "band",
          lineStyle: { width: 0, opacity: 0 },
          tooltip: { show: false },
        }),
        lineSeries(color, {
          name: "近地点〜遠地点",
          data: timeline.map((p) => [p.elapsedYears, p.apogeeAltitudeKm - p.perigeeAltitudeKm]),
          stack: "band",
          lineStyle: { width: 0, opacity: 0 },
          areaStyle: { color, opacity: 0.18 },
        }),
      ];

  return {
    ...baseOption(t),
    grid: gridBase({ top: 24, bottom: circular ? 36 : 44, right: 24 }),
    legend: circular ? { show: false } : legendBase(t, { data: ["平均高度", "近地点〜遠地点"] }),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TipParam[]) => {
        const idx = params[0]?.dataIndex ?? 0;
        const p = timeline[idx];
        if (!p) return "";
        const lines = [`経過 ${formatNumber(p.elapsedYears, 2)} yr`, `平均高度: ${formatNumber(p.altitudeKm, 1)} km`];
        if (!circular) {
          lines.push(`近地点: ${formatNumber(p.perigeeAltitudeKm, 1)} km`, `遠地点: ${formatNumber(p.apogeeAltitudeKm, 1)} km`);
        }
        return lines.join("<br/>");
      },
    },
    xAxis: valueXAxis(t, { name: "経過年 [yr]", min: 0, max: lastYear }),
    yAxis: valueAxis(t, {
      name: "高度 [km]",
      scale: true,
      min: (v: { min: number; max: number }) => Math.floor(Math.min(v.min, threshold) - 5),
    }),
    series: [...bandSeries, meanSeries],
  };
}

function cumulativePropellant(result: MaintenanceAnalysisResult): number[] {
  let sum = 0;
  return result.annualBudget.map((p) => (sum += p.propellantKg));
}

function createDeltaVOption(result: MaintenanceAnalysisResult, t: ChartTheme): ECBasicOption {
  return {
    ...baseOption(t),
    grid: gridBase({ bottom: 36 }),
    tooltip: {
      ...tooltipBase(t),
      axisPointer: { type: "shadow" },
      formatter: (params: TipParam[]) => {
        const p = params[0];
        const v = getTooltipValue(p?.value);
        return `${p?.axisValueLabel ?? ""}<br/>年間ΔV: ${v === null ? "—" : formatNumber(v, 2)} m/s`;
      },
    },
    xAxis: categoryAxis(t, result.annualBudget.map((p) => p.label)),
    yAxis: valueAxis(t, { name: "年間ΔV [m/s]" }),
    series: [barSeries(t.series[1], { name: "年間ΔV", data: result.annualBudget.map((p) => p.deltaV_mps) })],
  };
}

function createCumulativePropellantOption(result: MaintenanceAnalysisResult, t: ChartTheme): ECBasicOption {
  const capacity = result.kpi.availablePropellantKg;
  const cumulative = cumulativePropellant(result);
  return {
    ...baseOption(t),
    grid: gridBase({ bottom: 36 }),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TipParam[]) => {
        const p = params[0];
        const v = getTooltipValue(p?.value);
        return `${p?.axisValueLabel ?? ""}<br/>累積推進剤: ${v === null ? "—" : formatNumber(v, 2)} kg`;
      },
    },
    xAxis: categoryAxis(t, result.annualBudget.map((p) => p.label), { boundaryGap: false }),
    yAxis: valueAxis(t, {
      name: "累積推進剤 [kg]",
      min: 0,
      max: (v: { min: number; max: number }) => Math.max(v.max, capacity) * 1.1,
    }),
    series: [
      lineSeries(t.series[2], {
        name: "累積推進剤",
        data: cumulative,
        areaStyle: { color: t.series[2], opacity: 0.15 },
        markLine: thresholdMarkLine(t, capacity, `搭載推進剤 ${formatNumber(capacity, 1)} kg`),
      }),
    ],
  };
}

function createScenarioOption(result: MaintenanceAnalysisResult, t: ChartTheme): ECBasicOption {
  const capacity = result.kpi.availablePropellantKg;
  const years = Math.max(result.analysisInput.missionYears, 1e-6);
  const entries = result.scenarioComparisons;
  return {
    ...baseOption(t),
    grid: gridBase({ top: 12, bottom: 36, right: 24 }),
    tooltip: {
      ...tooltipBase(t, "item"),
      axisPointer: { type: "shadow" },
      formatter: (param: { dataIndex: number }) => {
        const e = entries[param.dataIndex];
        if (!e) return "";
        return [
          e.label,
          `必要推進剤(+マージン): ${formatNumber(e.requiredPropellantKg, 2)} kg`,
          `年間ΔV: ${formatNumber(e.missionDeltaV_mps / years, 2)} m/s`,
          `総ΔV: ${formatNumber(e.missionDeltaV_mps, 1)} m/s`,
          `高度低下: ${formatNumber(e.annualAltitudeLossKm, 2)} km/yr`,
          `自然寿命: ${formatLifetime(e.naturalLifetimeYears, e.naturalLifetimeReached)}`,
        ].join("<br/>");
      },
    },
    xAxis: valueXAxis(t, {
      name: "必要推進剤(+マージン) [kg]",
      min: 0,
      max: (v: { min: number; max: number }) => Math.max(v.max, capacity) * 1.1,
    }),
    yAxis: { ...categoryAxis(t, entries.map((e) => e.label)), inverse: true, nameGap: 0 },
    series: [
      barSeries(t.series[0], {
        name: "必要推進剤",
        barMaxWidth: 28,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.fgMuted, fontSize: 11, formatter: (p: { value: number }) => `${formatNumber(p.value, 2)} kg` },
        data: entries.map((e) => ({
          value: e.requiredPropellantKg,
          itemStyle: { color: e.requiredPropellantKg > capacity ? t.danger : t.series[0], borderRadius: [0, 4, 4, 0] },
        })),
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { color: t.danger, type: "dashed", width: 1 },
          label: { position: "insideEndTop", color: t.danger, fontSize: 11, formatter: `搭載 ${formatNumber(capacity, 1)} kg` },
          data: [{ xAxis: capacity }],
        },
      }),
    ],
  };
}

function createSweepOption(
  result: MaintenanceAnalysisResult,
  t: ChartTheme,
  metric: "annualDeltaV_mps" | "requiredPropellantKg",
): ECBasicOption {
  const param = result.analysisInput.sweepParameter;
  const isDv = metric === "annualDeltaV_mps";
  const current = result.analysisInput[param];
  const unit = isDv ? "m/s" : "kg";
  const name = isDv ? "年間ΔV" : "必要推進剤(+マージン)";
  const xs = result.sweep.map((p) => p.inputValue);
  const inRange = xs.length > 0 && current >= Math.min(...xs) && current <= Math.max(...xs);
  return {
    ...baseOption(t),
    grid: gridBase({ bottom: 44, right: 24 }),
    tooltip: {
      ...tooltipBase(t),
      formatter: (params: TipParam[]) => {
        const p = params[0];
        const v = getTooltipValue(p?.value);
        const x = Array.isArray(p?.value) ? Number(p.value[0]) : NaN;
        return `${SWEEP_LABELS[param]}: ${formatNumber(x, 2)}<br/>${name}: ${v === null ? "—" : formatNumber(v, 2)} ${unit}`;
      },
    },
    xAxis: valueXAxis(t, { name: SWEEP_LABELS[param], scale: true }),
    yAxis: valueAxis(t, { name: `${name} [${unit}]` }),
    series: [
      lineSeries(isDv ? t.series[1] : t.series[0], {
        name,
        data: result.sweep.map((p) => [p.inputValue, p[metric]]),
        ...(inRange
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                lineStyle: { color: t.fgMuted, type: "dashed", width: 1 },
                label: { position: "insideEndTop", color: t.fgMuted, fontSize: 11, formatter: `現在 ${formatNumber(current, 2)}` },
                data: [{ xAxis: current }],
              },
            }
          : {}),
      }),
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
  const theme = useChartTheme();
  const altitudeChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const budgetChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const propellantChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const comparisonChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const sweepDvChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const sweepPropChartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);

  const groupedFields = useMemo(() => ({
    "軌道条件": INPUT_FIELDS.filter((field) => field.section === "軌道条件"),
    "機体条件": INPUT_FIELDS.filter((field) => field.section === "機体条件"),
    "大気モデル": INPUT_FIELDS.filter((field) => field.section === "大気モデル"),
    "推進系": INPUT_FIELDS.filter((field) => field.section === "推進系"),
  }), []);

  const circularOrbit = result ? isEffectivelyCircular(result) : true;
  const verdictTone: VerdictTone = result?.kpi.designStatus === "critical" ? "ng" : result?.kpi.designStatus === "warning" ? "warn" : "ok";
  const verdictLabel = verdictTone === "ng" ? "不成立" : verdictTone === "warn" ? "要注意" : "成立";
  const verdictDetail = result ? (() => {
    const need = result.kpi.requiredPropellantWithMarginKg;
    const have = result.kpi.availablePropellantKg;
    const reserve = have > 0 ? ((have - need) / have) * 100 : NaN;
    if (need > have) return `必要推進剤 ${formatNumber(need, 2)} kg > 搭載 ${formatNumber(have, 1)} kg（不足 ${formatNumber(need - have, 2)} kg）`;
    return `必要推進剤 ${formatNumber(need, 2)} kg ≤ 搭載 ${formatNumber(have, 1)} kg（余裕 ${formatNumber(reserve, 0)} %${verdictTone === "warn" ? "、余裕が小さい" : ""}）`;
  })() : undefined;

  const kpiItems: Kpi[] = result ? [
    {
      label: "自然寿命",
      value: Number.isFinite(result.kpi.naturalLifetimeYears) ? `${formatNumber(result.kpi.naturalLifetimeYears, 1)}${result.kpi.naturalLifetimeReached ? "" : "+"}` : "N/A",
      unit: "yr",
      hint: `判定高度 ${formatNumber(result.analysisInput.deorbitAltitudeKm, 0)} km`,
    },
    { label: "年間ΔV", value: formatNumber(result.kpi.annualDeltaV_mps, 2), unit: "m/s", hint: `総ΔV ${formatNumber(result.kpi.missionDeltaV_mps, 1)} m/s` },
    {
      label: "必要推進剤",
      value: formatNumber(result.kpi.requiredPropellantWithMarginKg, 2),
      unit: "kg",
      hint: `搭載 ${formatNumber(result.kpi.availablePropellantKg, 1)} kg（マージン込み）`,
      tone: verdictTone,
    },
    { label: "高度低下", value: formatNumber(result.kpi.annualAltitudeLossKm, 2), unit: "km/yr", hint: `平均高度 ${formatNumber(result.kpi.initialAltitudeKm, 1)} km` },
  ] : [];

  const metricItems: Array<[string, string]> = result ? [
    ["総ΔV", `${formatNumber(result.kpi.missionDeltaV_mps, 2)} m/s`],
    ["必要推進剤（マージン前）", `${formatNumber(result.kpi.requiredPropellantKg, 2)} kg`],
    ["初期近地点 / 遠地点", `${formatNumber(result.kpi.initialPerigeeAltitudeKm, 1)} / ${formatNumber(result.kpi.initialApogeeAltitudeKm, 1)} km`],
    ["初期離心率", formatNumber(result.kpi.initialEccentricity, 4)],
    ["F10.7 / Ap", `${formatNumber(result.kpi.f107, 0)} / ${formatNumber(result.kpi.ap, 0)}`],
    ["平均密度", `${formatDensity(result.kpi.meanDensityKgPerM3)} kg/m^3`],
    ["最悪プリセット", result.worstScenario.label],
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
  const altitudeOption = useMemo(() => result ? createAltitudeTimelineOption(result, theme) : {}, [result, theme]);
  const deltaVOption = useMemo(() => result ? createDeltaVOption(result, theme) : {}, [result, theme]);
  const propellantOption = useMemo(() => result ? createCumulativePropellantOption(result, theme) : {}, [result, theme]);
  const scenarioOption = useMemo(() => result ? createScenarioOption(result, theme) : {}, [result, theme]);
  const sweepDvOption = useMemo(() => result ? createSweepOption(result, theme, "annualDeltaV_mps") : {}, [result, theme]);
  const sweepPropOption = useMemo(() => result ? createSweepOption(result, theme, "requiredPropellantKg") : {}, [result, theme]);

  const downloadChartSetAsHTML = () => {
    if (!result) return;
    const refs = comparisonMode === "scenario"
      ? [altitudeChartRef, budgetChartRef, propellantChartRef, comparisonChartRef]
      : [altitudeChartRef, budgetChartRef, propellantChartRef, sweepDvChartRef, sweepPropChartRef];
    const options = refs.flatMap((ref) => (ref.current ? [ref.current.getEchartsInstance().getOption()] : []));
    if (options.length === 0) return;
    downloadMultiChartHTML(
      options,
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
    downloadPNG(budgetChartRef, `orbit-maintenance-deltav-${dateStr}.png`);
    downloadPNG(propellantChartRef, `orbit-maintenance-propellant-${dateStr}.png`);
    downloadPNG(comparisonChartRef, `orbit-maintenance-scenarios-${dateStr}.png`);
    downloadPNG(sweepDvChartRef, `orbit-maintenance-sweep-deltav-${dateStr}.png`);
    downloadPNG(sweepPropChartRef, `orbit-maintenance-sweep-propellant-${dateStr}.png`);
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

        <div className="analysis-split" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 12 }}>
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

          <div className="flex min-w-0 flex-col gap-3">
            {result ? (
              <>
                <Verdict tone={verdictTone} label={verdictLabel} detail={verdictDetail} />
                <KpiStrip items={kpiItems} />

                <ChartCard
                  title="高度推移（自然減衰）"
                  caption={circularOrbit
                    ? "ほぼ円軌道のため近地点・遠地点は平均高度と重なるので、平均高度のみ表示しています。"
                    : "実線は平均高度、帯は近地点〜遠地点の範囲です。"}
                >
                  <ReactECharts ref={altitudeChartRef} option={altitudeOption} notMerge style={{ height: 280, width: "100%" }} />
                </ChartCard>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <ChartCard title="年間ΔV" caption="運用年ごとの軌道維持ΔV（平均高度へ戻す等価リブースト）。">
                    <ReactECharts ref={budgetChartRef} option={deltaVOption} notMerge style={{ height: 240, width: "100%" }} />
                  </ChartCard>
                  <ChartCard title="累積推進剤" caption="マージン込みの必要量は上の判定を参照。破線が搭載推進剤です。">
                    <ReactECharts ref={propellantChartRef} option={propellantOption} notMerge style={{ height: 240, width: "100%" }} />
                  </ChartCard>
                </div>

                <ChartCard
                  title={comparisonMode === "scenario" ? "大気シナリオ別 必要推進剤" : `感度解析（${SWEEP_LABELS[result.analysisInput.sweepParameter]}）`}
                  caption={comparisonMode === "scenario"
                    ? "Quiet / Nominal / Active / Storm で搭載推進剤に収まるかを比較します。赤は搭載量を超過。"
                    : "掃引対象を変えたときの年間ΔVと必要推進剤の変化です。"}
                  actions={(
                    <div className="solar-segmented-control">
                      <button type="button" className={`solar-segment-button ${comparisonMode === "scenario" ? "is-active" : ""}`} onClick={() => setComparisonMode("scenario")}>シナリオ比較</button>
                      <button type="button" className={`solar-segment-button ${comparisonMode === "sweep" ? "is-active" : ""}`} onClick={() => setComparisonMode("sweep")}>感度解析</button>
                    </div>
                  )}
                >
                  {comparisonMode === "scenario" ? (
                    <ReactECharts ref={comparisonChartRef} option={scenarioOption} notMerge style={{ height: 220, width: "100%" }} />
                  ) : (
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      <ReactECharts ref={sweepDvChartRef} option={sweepDvOption} notMerge style={{ height: 240, width: "100%" }} />
                      <ReactECharts ref={sweepPropChartRef} option={sweepPropOption} notMerge style={{ height: 240, width: "100%" }} />
                    </div>
                  )}
                </ChartCard>

                <ChartCard title="詳細指標">
                  <MetricList items={metricItems} />
                </ChartCard>
              </>
            ) : (
              <EmptyState title="解析結果がありません">
                左の設計入力を確認し、上部の「解析開始」を押すと、成立性の判定・高度推移・推進剤の見積りを表示します。
              </EmptyState>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
