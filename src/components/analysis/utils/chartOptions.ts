// Chart option generators for analysis components
import type { GroundStation } from "../../../lib/groundStations";
import type { StationVisibilityEntry, StationVisibilitySample } from "../../../lib/visibility";
import { getChartTheme } from "./chartTheme";

export type ChartData = StationVisibilitySample;

export function createStationAccessChartOption(
  data: ChartData[],
  stations: GroundStation[],
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>
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
    grid: {
      left: 160,
      right: 10,
      top: 30,
      bottom: 100
    },
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
        fontSize: 13,
        lineHeight: 14
      },
      name: '地上局',
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
      bottom: 10,
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
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>
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
    grid: {
      left: 160,
      right: 10,
      top: 30,
      bottom: 100
    },
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
        return stat ? `${s.name} (Avg:${stat.averageVisible.toFixed(1)})` : s.name;
      }),
      axisLabel: { 
        color: t.fgMuted,
        fontSize: 11
      },
      name: '緯度',
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
      bottom: 10,
      textStyle: { color: t.fg },
      borderColor: t.brand,
      fillerColor: "rgba(240, 114, 20, 0.3)",
      handleStyle: {
        color: t.brand
      }
    }]
  };
}
