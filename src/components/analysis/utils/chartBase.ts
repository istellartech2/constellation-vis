// Shared ECharts building blocks so every analysis chart has the same chrome:
// no in-canvas title (the card header names the chart), one y-axis, hairline
// grid, muted axis text, a tooltip on every chart and the legend at the bottom.
import type { ChartTheme } from "./chartTheme";

export const AXIS_FONT_SIZE = 11;

/** "HH:MM" in UTC for an epoch-ms value. */
export function formatUtcHHMM(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

/** Round for display; drops float noise such as 0.30000000000000004. */
export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Axis tick label without float noise (a computed max such as 6.6000000000000005). */
function tidyTick(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

export function baseOption(t: ChartTheme) {
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.fg, fontFamily: "inherit" },
    animationDuration: 250,
    aria: { enabled: true },
  };
}

export function gridBase(overrides: Record<string, unknown> = {}) {
  return { left: 8, right: 16, top: 28, bottom: 8, containLabel: true, ...overrides };
}

export function tooltipBase(t: ChartTheme, trigger: "axis" | "item" = "axis") {
  return {
    trigger,
    confine: true,
    backgroundColor: t.surface,
    borderColor: t.lineStrong,
    textStyle: { color: t.fg, fontSize: 12 },
    axisPointer: { type: "line", lineStyle: { color: t.lineStrong } },
  };
}

export function legendBase(t: ChartTheme, overrides: Record<string, unknown> = {}) {
  return {
    bottom: 0,
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 16,
    textStyle: { color: t.fgMuted, fontSize: 12 },
    ...overrides,
  };
}

interface AxisOptions {
  name?: string;
  min?: number | string | ((v: { min: number; max: number }) => number);
  max?: number | string | ((v: { min: number; max: number }) => number);
  [key: string]: unknown;
}

/** Axis name sits above the y-axis (nameLocation "end"), never rotated. */
export function valueAxis(t: ChartTheme, { name, ...rest }: AxisOptions = {}) {
  return {
    type: "value",
    name,
    nameLocation: "end",
    nameGap: 10,
    nameTextStyle: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE, align: "left" },
    axisLabel: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE, formatter: tidyTick },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.line } },
    ...rest,
  };
}

/** Horizontal value axis (x) with its name centred under the ticks. */
export function valueXAxis(t: ChartTheme, { name, ...rest }: AxisOptions = {}) {
  return {
    type: "value",
    name,
    nameLocation: "middle",
    nameGap: 26,
    nameTextStyle: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE },
    axisLabel: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE, formatter: tidyTick },
    axisLine: { lineStyle: { color: t.lineStrong } },
    axisTick: { show: false },
    splitLine: { show: false },
    ...rest,
  };
}

export function categoryAxis(t: ChartTheme, data: Array<string | number>, { name, ...rest }: AxisOptions = {}) {
  return {
    type: "category",
    data,
    name,
    nameLocation: "middle",
    nameGap: 26,
    nameTextStyle: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE },
    axisLabel: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE },
    axisLine: { lineStyle: { color: t.lineStrong } },
    axisTick: { show: false },
    splitLine: { show: false },
    ...rest,
  };
}

/** UTC time axis with "HH:MM" ticks and no vertical gridlines. */
export function timeAxis(t: ChartTheme, rest: AxisOptions = {}) {
  return {
    type: "time",
    axisLabel: {
      color: t.fgMuted,
      fontSize: AXIS_FONT_SIZE,
      hideOverlap: true,
      formatter: (value: number) => formatUtcHHMM(value),
    },
    axisLine: { lineStyle: { color: t.lineStrong } },
    axisTick: { show: false },
    splitLine: { show: false },
    ...rest,
  };
}

/** Horizontal limit/threshold line with a label at the right end. */
export function thresholdMarkLine(t: ChartTheme, value: number, label: string, color = t.danger) {
  return {
    symbol: "none",
    silent: true,
    lineStyle: { color, type: "solid", width: 1 },
    label: { position: "insideEndTop", color, fontSize: AXIS_FONT_SIZE, formatter: label },
    data: [{ yAxis: value }],
  };
}

/** Shaded background bands, e.g. eclipse intervals, as [startX, endX] pairs. */
export function bandMarkArea(t: ChartTheme, bands: Array<[number | string, number | string]>, color = t.shade) {
  return {
    silent: true,
    itemStyle: { color },
    data: bands.map(([from, to]) => [{ xAxis: from }, { xAxis: to }]),
  };
}

/** Line series defaults: 2px, no per-point markers, end dot on hover only. */
export function lineSeries(color: string, rest: Record<string, unknown> = {}) {
  return {
    type: "line",
    showSymbol: false,
    symbolSize: 8,
    lineStyle: { width: 2, color, cap: "round", join: "round" },
    itemStyle: { color },
    emphasis: { focus: "series" },
    ...rest,
  };
}

/** Bar series defaults: thin bars with a rounded data end. */
export function barSeries(color: string, rest: Record<string, unknown> = {}) {
  return {
    type: "bar",
    barMaxWidth: 24,
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    ...rest,
  };
}
