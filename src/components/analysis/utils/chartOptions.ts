// Chart option builders for the station-access and global-access screens.
// Builders are pure: they take the chart theme as an argument (so charts
// repaint on the light/dark switch) and never hardcode colours.
import { graphic } from "echarts";
import type { ECBasicOption } from "echarts/types/dist/shared";
import type {
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  CustomSeriesRenderItemReturn,
} from "echarts";
import type { StationVisibilitySample } from "../../../lib/visibility";
import type { ChartTheme } from "./chartTheme";
import {
  AXIS_FONT_SIZE,
  baseOption,
  categoryAxis,
  formatNumber,
  formatUtcHHMM,
  gridBase,
  legendBase,
  timeAxis,
  tooltipBase,
  valueXAxis,
} from "./chartBase";
import { formatLatitude, type ContactSegment } from "./accessMetrics";

export type ChartData = StationVisibilitySample;

/** Slim zoom slider in theme colours; no data shadow, no detail labels. */
function sliderZoom(t: ChartTheme, overrides: Record<string, unknown> = {}) {
  return {
    type: "slider",
    xAxisIndex: 0,
    height: 14,
    bottom: 2,
    showDetail: false,
    showDataShadow: false,
    brushSelect: false,
    moveHandleSize: 0,
    borderColor: t.line,
    backgroundColor: "transparent",
    fillerColor: t.shade,
    handleSize: "100%",
    handleStyle: { color: t.raised, borderColor: t.lineStrong },
    textStyle: { color: t.fgMuted },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Station access: contact timeline with redundancy
// ---------------------------------------------------------------------------

/** Lane height (px) per ground station; the component sizes the canvas from it. */
export const TIMELINE_LANE_PX = 40;
export const TIMELINE_LANE_PX_COMPACT = 34;
/** Vertical chrome around the lanes: legend on top, axis labels + slider below. */
export const TIMELINE_CHROME_PX = 88;

/** Legend pieces for "satellites in view" (0 is drawn as an empty lane). */
function countPieces(t: ChartTheme) {
  return [
    { value: 1, label: "1機", color: t.seq[0] },
    { value: 2, label: "2機", color: t.seq[1] },
    { value: 3, label: "3機", color: t.seq[2] },
    { gte: 4, label: "4機以上", color: t.seq[3] },
  ];
}

type SegmentRow = [stationIndex: number, startMs: number, endMs: number, count: number];

function renderContactSegment(
  params: CustomSeriesRenderItemParams,
  api: CustomSeriesRenderItemAPI,
): CustomSeriesRenderItemReturn {
  const lane = api.value(0) as number;
  const start = api.coord([api.value(1), lane]);
  const end = api.coord([api.value(2), lane]);
  const size = api.size?.([0, 1]);
  const bandHeight = Array.isArray(size) ? size[1] : 20;
  const height = Math.max(4, bandHeight * 0.56);
  const coordSys = params.coordSys as unknown as { x: number; y: number; width: number; height: number };
  const rect = graphic.clipRectByRect(
    // ≥1 px wide so a single 10 s sample stays visible at full-day zoom.
    { x: start[0], y: start[1] - height / 2, width: Math.max(1, end[0] - start[0]), height },
    { x: coordSys.x, y: coordSys.y, width: coordSys.width, height: coordSys.height },
  );
  if (!rect) return null;
  return {
    type: "rect",
    shape: rect,
    style: { fill: api.visual("color") as string },
    emphasis: { style: { stroke: api.visual("color") as string, lineWidth: 1 } },
  };
}

export interface StationTimelineInput {
  segments: ContactSegment[];
  stationNames: string[];
  startMs: number;
  endMs: number;
}

export function createStationTimelineOption(
  { segments, stationNames, startMs, endMs }: StationTimelineInput,
  t: ChartTheme,
  compact = false,
): ECBasicOption {
  const rows: SegmentRow[] = segments.map((s) => [s.stationIndex, s.startMs, s.endMs, s.count]);

  return {
    ...baseOption(t),
    animation: false,
    grid: gridBase({ top: 34, bottom: 26, left: 8, right: compact ? 10 : 16 }),
    tooltip: {
      ...tooltipBase(t, "item"),
      formatter: (params: { value?: unknown }) => {
        const v = params.value as SegmentRow | undefined;
        if (!Array.isArray(v)) return "";
        const [idx, from, to, count] = v;
        const minutes = (to - from) / 60000;
        return [
          `<b>${stationNames[idx] ?? ""}</b>`,
          `${formatUtcHHMM(from)}–${formatUtcHHMM(to)} UTC（${formatNumber(minutes, 1)} 分）`,
          `同時可視数: ${count} 機`,
        ].join("<br/>");
      },
    },
    visualMap: {
      type: "piecewise",
      seriesIndex: 0,
      dimension: 3,
      pieces: countPieces(t),
      orient: "horizontal",
      top: 0,
      right: compact ? 4 : 12,
      itemWidth: 12,
      itemHeight: 10,
      itemGap: 12,
      itemSymbol: "roundRect",
      textGap: 4,
      textStyle: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE },
      inactiveColor: t.line,
    },
    xAxis: timeAxis(t, {
      min: startMs,
      max: endMs,
      splitNumber: compact ? 4 : 8,
      splitLine: { show: true, lineStyle: { color: t.line } },
    }),
    yAxis: categoryAxis(t, stationNames, {
      inverse: true,
      axisLine: { show: false },
      splitLine: { show: true, lineStyle: { color: t.line } },
      axisLabel: {
        color: t.fg,
        fontSize: compact ? 11 : 12,
        width: compact ? 72 : 140,
        overflow: "truncate",
      },
    }),
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      sliderZoom(t, { filterMode: "none", left: 8, right: compact ? 10 : 16 }),
    ],
    series: [
      {
        type: "custom",
        name: "コンタクト",
        renderItem: renderContactSegment,
        dimensions: ["station", "start", "end", "count"],
        encode: { x: [1, 2], y: 0, tooltip: [3] },
        data: rows,
        clip: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Global access: latitude × time heatmap with an availability marginal
// ---------------------------------------------------------------------------

export interface LatitudeAvailabilityRow {
  latitude: number;
  availabilityPct: number;
  redundancyPct: number;
  interruptionsPerDay: number;
  maxGapMin: number;
  avgGapMin: number;
}

export interface GlobalAccessInput {
  /** Time-bucketed (averaged) samples; one station per latitude. */
  samples: StationVisibilitySample[];
  /** Latitudes in station order (south → north). */
  latitudes: number[];
  /** Availability per latitude, same order as `latitudes`. */
  rows: LatitudeAvailabilityRow[];
  /** Bucket width (min), shown in the tooltip. */
  bucketMinutes: number;
}

type HeatCell = [timeIndex: number, latIndex: number, value: number];

/** Category indices that start a new labelled hour (every `everyHours` h). */
function hourLabelIndices(timestamps: number[], everyHours: number): Map<number, string> {
  const labels = new Map<number, string>();
  // The first bucket only counts when it sits exactly on the hour; otherwise
  // it would be labelled with an hour it does not start.
  let prevHour = timestamps.length > 0 && timestamps[0] % 3_600_000 !== 0 ? Math.floor(timestamps[0] / 3_600_000) : Number.NaN;
  timestamps.forEach((ms, index) => {
    const hour = Math.floor(ms / 3_600_000);
    if (hour !== prevHour) {
      const utcHour = new Date(hour * 3_600_000).getUTCHours();
      if (utcHour % everyHours === 0) labels.set(index, `${String(utcHour).padStart(2, "0")}:00`);
      prevHour = hour;
    }
  });
  return labels;
}

/** Marginal tooltip body for one latitude row. */
function latitudeRowTooltip(row: LatitudeAvailabilityRow): string {
  return [
    `<b>${formatLatitude(row.latitude)}</b>`,
    `時間可用率: ${formatNumber(row.availabilityPct, 1)} %`,
    `冗長率（2機以上）: ${formatNumber(row.redundancyPct, 1)} %`,
    `中断頻度: ${formatNumber(row.interruptionsPerDay, 1)} 回/日`,
    `最大中断: ${formatNumber(row.maxGapMin, 1)} 分`,
    `平均中断: ${formatNumber(row.avgGapMin, 1)} 分`,
  ].join("<br/>");
}

export function createGlobalAccessChartOption(
  { samples, latitudes, rows, bucketMinutes }: GlobalAccessInput,
  t: ChartTheme,
  compact = false,
): ECBasicOption {
  const timestamps = samples.map((s) => s.timestamp);
  const timeCategories = timestamps.map((ms) => formatUtcHHMM(ms));
  const latCategories = latitudes.map((lat) => String(lat));
  // Hourly candidates; hideOverlap thins them at full range, zooming reveals them.
  const hourLabels = hourLabelIndices(timestamps, compact ? 3 : 1);

  // Zero cells are skipped: an empty cell reads as "no satellite" against the
  // card background and the canvas has far fewer rectangles to draw.
  const cells: HeatCell[] = [];
  let maxValue = 0;
  samples.forEach((sample, ti) => {
    sample.stations.forEach((station, li) => {
      const v = station.visibleCount;
      if (v > 0) {
        cells.push([ti, li, v]);
        if (v > maxValue) maxValue = v;
      }
    });
  });
  const vmMax = Math.max(1, Math.ceil(maxValue * 10) / 10);

  const top = 30;
  // Compact: the marginal is narrow, so its legend stacks vertically below it.
  const bottom = compact ? 62 : 44;
  const heatGrid = { left: compact ? 40 : 46, right: compact ? "35%" : "27%", top, bottom, containLabel: false };
  const sideGrid = { left: compact ? "68%" : "76%", right: compact ? 8 : 16, top, bottom, containLabel: false };
  const latInterval = (_index: number, value: string) => Number(value) % 30 === 0;
  const rowByCategory = new Map(rows.map((r) => [String(r.latitude), r]));

  return {
    ...baseOption(t),
    animation: false,
    grid: [heatGrid, sideGrid],
    tooltip: {
      ...tooltipBase(t, "item"),
      formatter: (params: unknown) => {
        // Axis-pointer hover on the marginal arrives as an array.
        const first = (Array.isArray(params) ? params[0] : params) as
          | { seriesIndex?: number; value?: unknown; axisValue?: string; dataIndex?: number }
          | undefined;
        if (!first) return "";
        if (first.seriesIndex === 0 && Array.isArray(first.value)) {
          const [ti, li, v] = first.value as HeatCell;
          const from = timestamps[ti];
          return [
            `<b>${formatLatitude(latitudes[li])}</b>`,
            `${formatUtcHHMM(from)} UTC（${bucketMinutes} 分平均）`,
            `平均可視数: ${formatNumber(v, 2)} 機`,
          ].join("<br/>");
        }
        const row =
          (first.axisValue !== undefined ? rowByCategory.get(String(first.axisValue)) : undefined) ??
          (first.dataIndex !== undefined ? rows[first.dataIndex] : undefined);
        return row ? latitudeRowTooltip(row) : "";
      },
    },
    legend: legendBase(t, {
      data: ["可用率", "冗長率（2機以上）"],
      left: sideGrid.left,
      bottom: 0,
      itemGap: 10,
      textStyle: { color: t.fgMuted, fontSize: compact ? 10 : 11 },
      ...(compact ? { orient: "vertical", itemGap: 4, itemHeight: 8, itemWidth: 8 } : {}),
    }),
    visualMap: {
      type: "continuous",
      seriesIndex: 0,
      min: 0,
      max: vmMax,
      calculable: false,
      orient: "horizontal",
      top: 0,
      left: heatGrid.left,
      itemWidth: 10,
      itemHeight: compact ? 90 : 140,
      text: [`${formatNumber(vmMax, 1)} 機`, "平均可視数 0"],
      textGap: 6,
      textStyle: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE },
      inRange: { color: [...t.seq] },
    },
    xAxis: [
      categoryAxis(t, timeCategories, {
        gridIndex: 0,
        axisLabel: {
          color: t.fgMuted,
          fontSize: AXIS_FONT_SIZE,
          hideOverlap: true,
          interval: (index: number) => hourLabels.has(index),
          formatter: (_value: string, index: number) => hourLabels.get(index) ?? "",
        },
        axisTick: { show: false },
      }),
      valueXAxis(t, {
        gridIndex: 1,
        min: 0,
        // Low-coverage constellations would draw hairline bars on a fixed
        // 0–100 % scale; zoom the scale to the data, capped at 100 %.
        max: (v: { max: number }) => Math.min(100, Math.max(10, Math.ceil(v.max / 10) * 10)),
        splitNumber: 2,
        name: undefined,
        axisLabel: { color: t.fgMuted, fontSize: AXIS_FONT_SIZE, formatter: "{value}%" },
        splitLine: { show: true, lineStyle: { color: t.line } },
      }),
    ],
    yAxis: [
      categoryAxis(t, latCategories, {
        gridIndex: 0,
        axisLine: { show: false },
        axisLabel: {
          color: t.fgMuted,
          fontSize: AXIS_FONT_SIZE,
          interval: latInterval,
          formatter: (value: string) => formatLatitude(Number(value)),
        },
      }),
      categoryAxis(t, latCategories, {
        gridIndex: 1,
        axisLine: { show: true, lineStyle: { color: t.lineStrong } },
        axisLabel: { show: false },
        axisPointer: {
          show: true,
          type: "shadow",
          triggerTooltip: true,
          label: { show: false },
          shadowStyle: { color: t.shade },
        },
      }),
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: 0 },
      sliderZoom(t, { left: heatGrid.left, right: heatGrid.right }),
    ],
    series: [
      {
        type: "heatmap",
        name: "平均可視数",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: cells,
        // Draw every cell in one pass; progressive chunks were interrupted
        // part-way across the axis by re-renders.
        progressive: 0,
        animation: false,
        emphasis: { disabled: true },
      },
      {
        type: "bar",
        name: "可用率",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: rows.map((r) => r.availabilityPct),
        barCategoryGap: "25%",
        itemStyle: { color: t.series[0] },
        emphasis: { disabled: true },
      },
      {
        type: "line",
        name: "冗長率（2機以上）",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: rows.map((r) => r.redundancyPct),
        showSymbol: false,
        lineStyle: { color: t.series[1], width: 1.5 },
        itemStyle: { color: t.series[1] },
        emphasis: { disabled: true },
      },
    ],
  };
}
