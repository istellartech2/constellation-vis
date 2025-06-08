import { useRef } from "react";
import ReactECharts from "echarts-for-react";
import { downloadPNG, downloadDualChartHTML } from "../utils/downloadUtils";
import "../../../styles/styles.css";

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
  const chartRef1 = useRef<any>(null);
  const chartRef2 = useRef<any>(null);

  if (!show || availabilityMetrics.length === 0) return null;

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

  const timeAvailabilityOption = {
    title: {
      text: "時間的可用性",
      textStyle: { color: "#ed6d00", fontSize: 14 },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    grid: {
      left: 60,
      right: 20,
      top: 40,
      bottom: 40
    },
    xAxis: {
      type: 'value',
      name: '可用性 (%)',
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: "#999faa" },
      min: 0,
      max: 100,
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: 'category',
      name: '緯度 (°)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: "#999faa" },
      data: availabilityMetrics.map(m => m.latitude),
      axisLabel: { color: "#999faa" }
    },
    series: [{
      type: 'line',
      data: availabilityMetrics.map(m => m.timeAvailability),
      smooth: true,
      lineStyle: { color: "#ed6d00", width: 2 },
      itemStyle: { color: "#ed6d00" },
      markLine: {
        data: [{
          yAxis: 90, // Index for latitude 0
          lineStyle: {
            color: '#999faa',
            type: 'dashed',
            width: 1
          },
          label: {
            show: false
          }
        }]
      }
    }],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0];
        return `緯度 ${data.name}°<br/>可用性: ${data.value.toFixed(1)}%`;
      }
    }
  };

  const interruptionOption = {
    title: {
      text: "中断特性",
      textStyle: { color: "#ed6d00", fontSize: 14 },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    grid: {
      left: 60,
      right: 60,
      top: 40,
      bottom: 40
    },
    xAxis: {
      type: 'value',
      name: '値',
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: "#999faa" },
      axisLabel: { color: "#999faa" },
      min: 0
    },
    yAxis: {
      type: 'category',
      name: '緯度 (°)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: "#999faa" },
      data: availabilityMetrics.map(m => m.latitude),
      axisLabel: { color: "#999faa" }
    },
    legend: {
      data: ['中断頻度 (回/日)', '最大中断時間 (分)', '平均中断時間 (分)'],
      textStyle: { color: "#999faa" },
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
              color: '#999faa',
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
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        let result = `緯度 ${params[0].name}°<br/>`;
        params.forEach((param: any) => {
          if (param.value !== null && param.value !== undefined) {
            result += `${param.seriesName}: ${param.value.toFixed(1)}<br/>`;
          } else {
            result += `${param.seriesName}: 可用性なし<br/>`;
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
        
        <div style={{ flex: 1, display: "flex", gap: "16px", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReactECharts
              ref={chartRef1}
              option={timeAvailabilityOption}
              style={{ height: "100%", width: "100%" }}
              theme="dark"
            />
          </div>
          
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReactECharts
              ref={chartRef2}
              option={interruptionOption}
              style={{ height: "100%", width: "100%" }}
              theme="dark"
            />
          </div>
        </div>
      </div>
    </div>
  );
}