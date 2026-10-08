import { useRef } from "react";
import ReactECharts from "echarts-for-react";
import { downloadPNG, downloadDualChartHTML } from "./utils/downloadUtils";
import type { CallbackDataParams } from "echarts/types/dist/shared";
import { getChartTheme } from "./utils/chartTheme";
import { useCompactChart } from "./utils/useCompactChart";

interface AvailabilityMetrics {
  latitude: number;
  timeAvailability: number;
  interruptionFrequency: number;
  maxInterruptionTime: number;
  avgInterruptionTime: number;
}

interface Props {
  show: boolean;
  onClose: () => void;
  availabilityMetrics: AvailabilityMetrics[];
  startTime: Date;
}

export default function GlobalAvailabilityPopup({ show, onClose, availabilityMetrics, startTime }: Props) {
  const chartRef1 = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const chartRef2 = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const compactChart = useCompactChart();

  if (!show || availabilityMetrics.length === 0) return null;

  const getNumericValue = (value: CallbackDataParams["value"]): number | null => {
    if (typeof value === "number") {
      return value;
    }
    if (Array.isArray(value)) {
      const candidate = value.at(-1);
      if (typeof candidate === "number") {
        return candidate;
      }
      if (candidate == null) {
        return null;
      }
      const numericCandidate = Number(candidate);
      return Number.isFinite(numericCandidate) ? numericCandidate : null;
    }
    if (value == null) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const handleDownloadPNG = () => {
    downloadPNG(chartRef1, `global-availability-time-${startTime.toISOString().slice(0, 10)}.png`);
    
    setTimeout(() => {
      downloadPNG(chartRef2, `global-availability-interruption-${startTime.toISOString().slice(0, 10)}.png`);
    }, 100);
  };

  const handleDownloadHTML = () => {
    if (chartRef1.current && chartRef2.current) {
      const chart1Instance = chartRef1.current.getEchartsInstance();
      const chart2Instance = chartRef2.current.getEchartsInstance();
      const chart1Option = chart1Instance.getOption();
      const chart2Option = chart2Instance.getOption();
      
      downloadDualChartHTML(
        chart1Option,
        chart2Option,
        "全球可用性解析",
        `global-availability-analysis-${startTime.toISOString().slice(0, 10)}.html`
      );
    }
  };

  const t = getChartTheme();
  const timeAvailabilityOption = {
    title: {
      text: "時間的可用性",
      textStyle: { color: t.fg, fontSize: 14 },
      left: 'center'
    },
    backgroundColor: "transparent",
    textStyle: { color: t.fg },
    grid: compactChart
      ? { left: 52, right: 16, top: 40, bottom: 40 }
      : { left: 60, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'value',
      name: '可用性 (%)',
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: t.fgMuted },
      min: 0,
      max: 100,
      axisLabel: { color: t.fgMuted }
    },
    yAxis: {
      type: 'category',
      name: '緯度 (°)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: t.fgMuted },
      data: availabilityMetrics.map(m => m.latitude),
      axisLabel: { color: t.fgMuted }
    },
    series: [{
      type: 'line',
      data: availabilityMetrics.map(m => m.timeAvailability),
      smooth: true,
      lineStyle: { color: t.brand, width: 2 },
      itemStyle: { color: t.brand },
      markLine: {
        data: [{
          yAxis: 90, // Index for latitude 0
          lineStyle: {
            color: t.fgMuted,
            type: 'dashed',
            width: 1
          },
          label: {
            show: false
          }
        }]
      }
    }],
    tooltip: { backgroundColor: t.surface, borderColor: t.lineStrong, textStyle: { color: t.fg },
      trigger: 'axis',
      formatter: (params: CallbackDataParams[] | CallbackDataParams) => {
        const [dataPoint] = Array.isArray(params) ? params : [params];
        if (!dataPoint) {
          return "";
        }
        const numericValue = getNumericValue(dataPoint.value);
        if (numericValue === null) {
          return `緯度 ${dataPoint.name}°`;
        }
        return `緯度 ${dataPoint.name}°<br/>可用性: ${numericValue.toFixed(1)}%`;
      }
    }
  };

  const interruptionOption = {
    title: {
      text: "中断特性",
      textStyle: { color: t.fg, fontSize: 14 },
      left: 'center'
    },
    backgroundColor: "transparent",
    textStyle: { color: t.fg },
    // Phones: the legend wraps to two lines, so reserve room under the axis.
    grid: compactChart
      ? { left: 52, right: 16, top: 40, bottom: 100 }
      : { left: 60, right: 60, top: 40, bottom: 40 },
    xAxis: {
      type: 'value',
      name: '値',
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: t.fgMuted },
      axisLabel: { color: t.fgMuted },
      min: 0
    },
    yAxis: {
      type: 'category',
      name: '緯度 (°)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: t.fgMuted },
      data: availabilityMetrics.map(m => m.latitude),
      axisLabel: { color: t.fgMuted }
    },
    legend: {
      data: ['中断頻度 (回/日)', '最大中断時間 (分)', '平均中断時間 (分)'],
      textStyle: { color: t.fgMuted },
      top: 'bottom'
    },
    series: [
      {
        name: '中断頻度 (回/日)',
        type: 'line',
        data: availabilityMetrics.map(m => m.interruptionFrequency),
        smooth: true,
        lineStyle: { color: "#38a169", width: 2 },
        itemStyle: { color: "#38a169" },
        markLine: {
          data: [{
            yAxis: 90,
            lineStyle: {
              color: t.fgMuted,
              type: 'dashed',
              width: 1
            },
            label: {
              show: false
            }
          }]
        }
      },
      {
        name: '最大中断時間 (分)',
        type: 'line',
        data: availabilityMetrics.map(m => m.maxInterruptionTime > 720 ? null : m.maxInterruptionTime),
        smooth: true,
        lineStyle: { color: "#d69e2e", width: 2 },
        itemStyle: { color: "#d69e2e" },
        connectNulls: false
      },
      {
        name: '平均中断時間 (分)',
        type: 'line',
        data: availabilityMetrics.map(m => m.avgInterruptionTime > 720 ? null : m.avgInterruptionTime),
        smooth: true,
        lineStyle: { color: "#e53e3e", width: 2 },
        itemStyle: { color: "#e53e3e" },
        connectNulls: false
      }
    ],
    tooltip: { backgroundColor: t.surface, borderColor: t.lineStrong, textStyle: { color: t.fg },
      trigger: 'axis',
      formatter: (params: CallbackDataParams[] | CallbackDataParams) => {
        const dataPoints = Array.isArray(params) ? params : [params];
        if (dataPoints.length === 0) {
          return "";
        }
        let result = `緯度 ${dataPoints[0].name}°<br/>`;
        dataPoints.forEach((param) => {
          const seriesLabel = param.seriesName ?? "系列";
          const numericValue = getNumericValue(param.value);
          if (numericValue !== null) {
            result += `${seriesLabel}: ${numericValue.toFixed(1)}<br/>`;
          } else {
            result += `${seriesLabel}: 可用性なし<br/>`;
          }
        });
        return result;
      }
    }
  };

  return (
    <div className="analysis-popup-overlay">
      <div className="analysis-popup-container" style={{ 
        width: "90vw", 
        maxWidth: "1400px", 
        height: "80vh",
        display: "flex",
        flexDirection: "column"
      }}>
        <div className="analysis-popup-header">
          <h2 className="analysis-popup-title">全球可用性解析</h2>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={handleDownloadPNG}
              className="analysis-secondary-button"
            >
              PNG保存
            </button>
            <button
              onClick={handleDownloadHTML}
              className="analysis-secondary-button"
            >
              HTML保存
            </button>
            <button
              onClick={onClose}
              className="analysis-close-button"
            >
              ×
            </button>
          </div>
        </div>
        
        <div className="global-availability-charts" style={{ flex: 1, display: "flex", gap: "16px", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReactECharts
              ref={chartRef1}
              option={timeAvailabilityOption}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
          
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReactECharts
              ref={chartRef2}
              option={interruptionOption}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
