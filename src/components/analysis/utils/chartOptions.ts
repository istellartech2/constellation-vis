// Chart option generators for analysis components

export interface ChartData {
  time: string;
  timestamp: number;
  stations: Array<{
    name: string;
    visibleCount: number;
  }>;
}

export function createStationAccessChartOption(
  data: ChartData[],
  stations: any[],
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>
) {
  if (data.length === 0) {
    return {
      title: {
        text: "地上局アクセス解析",
        textStyle: { color: "#ed6d00" },
        left: 'center'
      },
      backgroundColor: "rgba(30, 32, 36, 0.95)"
    };
  }

  return {
    title: {
      text: "地上局アクセス解析",
      textStyle: { color: "#ed6d00", fontSize: 16 },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
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
        color: "#999faa",
        rotate: 45
      },
      name: '時刻 (UTC)',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: { color: "#999faa" }
    },
    yAxis: {
      type: 'category',
      data: stations.map((s, index) => {
        const stat = stats[index];
        return `${s.name}\nAvg.: ${stat.averageVisible.toFixed(2)}\n≠0: ${(stat.nonZeroRate * 100).toFixed(1)}%`;
      }),
      axisLabel: { 
        color: "#999faa",
        fontSize: 13,
        lineHeight: 14
      },
      name: '地上局',
      nameLocation: 'middle',
      nameGap: 120,
      nameTextStyle: { color: "#999faa" }
    },
    visualMap: {
      min: 0,
      max: 10,
      calculable: true,
      orient: 'horizontal',
      left: 'left',
      bottom: 0,
      textStyle: { color: "#f1f1f1" },
      inRange: {
        color: ['#2d3748', '#38a169', '#d69e2e', '#e53e3e']
      }
    },
    series: [{
      type: 'heatmap',
      data: data.flatMap((timeData, timeIndex) => 
        timeData.stations.map((station: any, stationIndex: number) => [
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
      textStyle: { color: "#f1f1f1" },
      borderColor: "#ed6d00",
      fillerColor: "rgba(237, 109, 0, 0.3)",
      handleStyle: {
        color: "#ed6d00"
      }
    }]
  };
}

export function createGlobalAccessChartOption(
  data: ChartData[],
  latitudeStations: any[],
  stats: Array<{name: string; averageVisible: number; nonZeroRate: number}>
) {
  if (data.length === 0) {
    return {
      title: {
        text: "全球アクセス解析",
        textStyle: { color: "#ed6d00" },
        left: 'center'
      },
      backgroundColor: "rgba(30, 32, 36, 0.95)"
    };
  }

  return {
    title: {
      text: "全球アクセス解析",
      textStyle: { color: "#ed6d00", fontSize: 16 },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
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
        color: "#999faa",
        rotate: 45
      },
      name: '時刻 (UTC)',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: { color: "#999faa" }
    },
    yAxis: {
      type: 'category',
      data: latitudeStations.map((s, index) => {
        const stat = stats[index];
        return stat ? `${s.name} (Avg:${stat.averageVisible.toFixed(1)})` : s.name;
      }),
      axisLabel: { 
        color: "#999faa",
        fontSize: 11
      },
      name: '緯度',
      nameLocation: 'middle',
      nameGap: 120,
      nameTextStyle: { color: "#999faa" }
    },
    visualMap: {
      min: 0,
      max: 10,
      calculable: true,
      orient: 'horizontal',
      left: 'left',
      bottom: 0,
      textStyle: { color: "#f1f1f1" },
      inRange: {
        color: ['#2d3748', '#38a169', '#d69e2e', '#e53e3e']
      }
    },
    series: [{
      type: 'heatmap',
      data: data.flatMap((timeData, timeIndex) => 
        timeData.stations.map((station: any, stationIndex: number) => [
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
      textStyle: { color: "#f1f1f1" },
      borderColor: "#ed6d00",
      fillerColor: "rgba(237, 109, 0, 0.3)",
      handleStyle: {
        color: "#ed6d00"
      }
    }]
  };
}