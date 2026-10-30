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
        // Hundreds of satellites give thousands of count changes. Past the
        // default threshold ECharts draws progressively, and a re-render cut
        // the later lanes off part-way; draw everything in one pass instead.
        progressive: 0,
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
}

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

/** "#rrggbb" → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paints the latitude × time grid into a bitmap, one pixel per cell (north at
 * the top), coloured along the theme's sequential ramp; zero stays transparent.
 * Drawing ~130k heatmap rectangles took seconds per render (and again on every
 * zoom); a single image draws instantly.
 */
function paintHeatImage(samples: StationVisibilitySample[], ramp: readonly string[], max: number): HTMLCanvasElement | null {
  if (typeof document === "undefined" || samples.length === 0) return null;
  const width = samples.length;
  const height = samples[0].stations.length;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const stops = ramp.map(hexToRgb);
  const segments = stops.length - 1;
  for (let ti = 0; ti < width; ti++) {
    const stations = samples[ti].stations;
    for (let li = 0; li < height; li++) {
      const v = stations[li].visibleCount;
      if (v <= 0) continue;
      const x = Math.min(1, v / max) * segments;
      const k = Math.min(segments - 1, Math.floor(x));
      const f = x - k;
      const a = stops[k];
      const b = stops[k + 1];
      const o = ((height - 1 - li) * width + ti) * 4;
      image.data[o] = a[0] + (b[0] - a[0]) * f;
      image.data[o + 1] = a[1] + (b[1] - a[1]) * f;
      image.data[o + 2] = a[2] + (b[2] - a[2]) * f;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function createGlobalAccessChartOption(
  { samples, latitudes, rows }: GlobalAccessInput,
  t: ChartTheme,
  compact = false,
): ECBasicOption {
  const timestamps = samples.map((s) => s.timestamp);
  const timeCategories = timestamps.map((ms) => formatUtcHHMM(ms));
  const latCategories = latitudes.map((lat) => String(lat));
  // Hourly candidates; hideOverlap thins them at full range, zooming reveals them.
  const hourLabels = hourLabelIndices(timestamps, compact ? 3 : 1);

  let maxValue = 0;
  for (const sample of samples) {
    for (const station of sample.stations) if (station.visibleCount > maxValue) maxValue = station.visibleCount;
  }
  const vmMax = Math.max(1, Math.ceil(maxValue * 10) / 10);
  const heatImage = paintHeatImage(samples, t.seq, vmMax);
  const timeCount = samples.length;
  const latCount = latitudes.length;

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
          | { axisValue?: string; dataIndex?: number }
          | undefined;
        if (!first) return "";
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
    // Legend for the bitmap's colour ramp; it styles no series itself.
    visualMap: {
      type: "continuous",
      seriesIndex: [],
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
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      sliderZoom(t, { filterMode: "none", left: heatGrid.left, right: heatGrid.right }),
    ],
    series: [
      {
        type: "custom",
        name: "平均可視数",
        xAxisIndex: 0,
        yAxisIndex: 0,
        silent: true,
        tooltip: { show: false },
        // One datum; the whole grid is a single image scaled to the axes.
        data: [[0, 0]],
        renderItem: (params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
          if (!heatImage) return null;
          const [x0, ySouth] = api.coord([0, 0]);
          const [x1, yNorth] = api.coord([timeCount - 1, latCount - 1]);
          const [bandW, bandH] = api.size!([1, 1]) as number[];
          const cs = params.coordSys as unknown as { x: number; y: number; width: number; height: number };
          return {
            type: "image",
            silent: true,
            style: {
              image: heatImage,
              x: x0 - bandW / 2,
              y: yNorth - bandH / 2,
              width: x1 - x0 + bandW,
              height: ySouth - yNorth + bandH,
            },
            clipPath: { type: "rect", shape: { x: cs.x, y: cs.y, width: cs.width, height: cs.height } },
          };
        },
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
