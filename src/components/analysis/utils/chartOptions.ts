// Chart option generators for analysis components
import type { GroundStation } from "../../../lib/groundStations";
import type { StationVisibilityEntry, StationVisibilitySample } from "../../../lib/visibility";
import { getChartTheme } from "./chartTheme";

export type ChartData = StationVisibilitySample;

/** Width (px) available to y-axis category labels on narrow screens. */
const COMPACT_Y_LABEL_WIDTH = 64;

/**
 * Heatmap grid. Desktop reserves 160px on the left for the station labels and
 * the rotated axis name; on a phone that would leave ~150px for the plot, so
 * the compact layout keeps just enough for truncated labels and makes room at
 * the bottom for the stacked zoom slider + visualMap.
 */
function heatmapGrid(compact: boolean) {
  return compact
    ? { left: COMPACT_Y_LABEL_WIDTH + 14, right: 12, top: 30, bottom: 128 }
    : { left: 160, right: 10, top: 30, bottom: 100 };
}

export function createStationAccessChartOption(
  data: ChartData[],
  stations: GroundStation[],
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>,
  compact = false
) {
  const t = getChartTheme();
  if (data.length === 0) {
    return {
      title: {
        text: "地上局アクセス解析",
        textStyle: { color: t.fg },
        left: 'center'
      },
      backgroundColor: "transparent"
    };
  }

  return {
    title: {
      text: "地上局アクセス解析",
      textStyle: { color: t.fg, fontSize: 16 },
      left: 'center'
    },
    backgroundColor: "transparent",
    textStyle: { color: t.fg },
    grid: heatmapGrid(compact),
    xAxis: {
      type: 'category',
      data: data.map(d => d.time.substr(0, 5)),
      axisLabel: { 
        color: t.fgMuted,
        rotate: 45
      },
      name: '時刻 (UTC)',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: { color: t.fgMuted }
    },
    yAxis: {
      type: 'category',
      data: stations.map((s, index) => {
        const stat = stats[index];
        return `${s.name}\nAvg.: ${stat.averageVisible.toFixed(2)}\n≠0: ${(stat.nonZeroRate * 100).toFixed(1)}%`;
      }),
      axisLabel: { 
        color: t.fgMuted,
        fontSize: compact ? 10 : 13,
        lineHeight: compact ? 12 : 14,
        width: compact ? COMPACT_Y_LABEL_WIDTH : undefined,
        overflow: compact ? 'truncate' : 'none'
      },
      // The rotated axis name costs ~40px of plot width; phones drop it.
      name: compact ? '' : '地上局',
      nameLocation: 'middle',
      nameGap: 120,
      nameTextStyle: { color: t.fgMuted }
    },
    visualMap: {
      min: 0,
      max: 10,
      calculable: true,
      orient: 'horizontal',
      left: 'left',
      bottom: 0,
      // Phones: a shorter legend, stacked under the zoom slider.
      ...(compact ? { itemWidth: 12, itemHeight: 110 } : {}),
      textStyle: { color: t.fg },
      inRange: {
        color: [t.raised, '#38a169', '#d69e2e', '#e53e3e']
      }
    },
    series: [{
      type: 'heatmap',
      data: data.flatMap((timeData, timeIndex) => 
        timeData.stations.map((station: StationVisibilityEntry, stationIndex: number) => [
          timeIndex,
          stationIndex, 
          station.visibleCount
        ])
      ),
      label: {
        show: false
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }],
    tooltip: {
      show: false
    },
    dataZoom: [{
      type: 'slider',
      xAxisIndex: 0,
      start: 0,
      end: 16.67,
      // Phones stack the slider above the visualMap instead of beside it.
      ...(compact ? { left: 16, right: 16, height: 22, bottom: 44 } : { bottom: 10 }),
      textStyle: { color: t.fg },
      borderColor: t.brand,
      fillerColor: "rgba(240, 114, 20, 0.3)",
      handleStyle: {
        color: t.brand
      }
    }]
  };
}

export function createGlobalAccessChartOption(
  data: ChartData[],
  latitudeStations: GroundStation[],
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>,
  compact = false
) {
  const t = getChartTheme();
  if (data.length === 0) {
    return {
      title: {
        text: "全球アクセス解析",
        textStyle: { color: t.fg },
        left: 'center'
      },
      backgroundColor: "transparent"
    };
  }

  return {
    title: {
      text: "全球アクセス解析",
      textStyle: { color: t.fg, fontSize: 16 },
      left: 'center'
    },
    backgroundColor: "transparent",
    textStyle: { color: t.fg },
    grid: heatmapGrid(compact),
    xAxis: {
      type: 'category',
      data: data.map(d => d.time.substr(0, 5)),
      axisLabel: { 
        color: t.fgMuted,
        rotate: 45
      },
      name: '時刻 (UTC)',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: { color: t.fgMuted }
    },
    yAxis: {
      type: 'category',
      data: latitudeStations.map((s, index) => {
        const stat = stats[index];
        if (!stat) return s.name;
        return compact
          ? `${s.name} ${stat.averageVisible.toFixed(1)}`
          : `${s.name} (Avg:${stat.averageVisible.toFixed(1)})`;
      }),
      axisLabel: { 
        color: t.fgMuted,
        fontSize: compact ? 10 : 11,
        width: compact ? COMPACT_Y_LABEL_WIDTH : undefined,
        overflow: compact ? 'truncate' : 'none'
      },
      name: compact ? '' : '緯度',
      nameLocation: 'middle',
      nameGap: 120,
      nameTextStyle: { color: t.fgMuted }
    },
    visualMap: {
      min: 0,
      max: 10,
      calculable: true,
      orient: 'horizontal',
      left: 'left',
      bottom: 0,
      // Phones: a shorter legend, stacked under the zoom slider.
      ...(compact ? { itemWidth: 12, itemHeight: 110 } : {}),
      textStyle: { color: t.fg },
      inRange: {
        color: [t.raised, '#38a169', '#d69e2e', '#e53e3e']
      }
    },
    series: [{
      type: 'heatmap',
      data: data.flatMap((timeData, timeIndex) => 
        timeData.stations.map((station: StationVisibilityEntry, stationIndex: number) => [
          timeIndex,
          stationIndex, 
          station.visibleCount
        ])
      ),
      label: {
        show: false
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }],
    tooltip: {
      show: false
    },
    dataZoom: [{
      type: 'slider',
      xAxisIndex: 0,
      start: 0,
      end: 16.67,
      // Phones stack the slider above the visualMap instead of beside it.
      ...(compact ? { left: 16, right: 16, height: 22, bottom: 44 } : { bottom: 10 }),
      textStyle: { color: t.fg },
      borderColor: t.brand,
      fillerColor: "rgba(240, 114, 20, 0.3)",
      handleStyle: {
        color: t.brand
      }
    }]
  };
}
