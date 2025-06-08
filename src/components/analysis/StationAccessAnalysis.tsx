import { useState, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, calculateStationStats, averageVisibilityData } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from "../../lib/tomlParse";
import type { SatelliteSpec } from "../../lib/satellites";
import type { GroundStation } from "../../lib/groundStations";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
}

export default function StationAccessAnalysis({ satText, constText, gsText, startTime }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [stations, setStations] = useState<GroundStation[]>([]);
  const [stats, setStats] = useState<Array<{name: string; averageVisible: number; nonZeroRate: number}>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const chartRef = useRef<any>(null);

  const analyzeAccess = async () => {
    setIsAnalyzing(true);
    setError("");
    
    try {
      // Parse TOML data
      const baseSats = satText ? parseSatellitesToml(satText) : [];
      const constSats = constText ? parseConstellationToml(constText) : [];
      const groundStations = gsText ? parseGroundStationsToml(gsText) : [];
      
      if (groundStations.length === 0) {
        throw new Error("地上局データがありません");
      }
      
      const allSatellites = [...baseSats, ...constSats];
      if (allSatellites.length === 0) {
        throw new Error("衛星データがありません");
      }

      // Calculate visibility data for 24 hours
      const visibilityData = calculateStationAccessData(
        allSatellites,
        groundStations,
        startTime,
        24, // 24 hours
        10  // 10 second intervals
      );

      // Average the data function but not use it
      const averagedData = averageVisibilityData(visibilityData, 1);
      
      // Calculate statistics from original data (not averaged)
      const stationStats = calculateStationStats(visibilityData);

      setData(averagedData);
      setStations(groundStations);
      setStats(stationStats);
      
      console.log(`Generated ${visibilityData.length} data points for 24 hours`);
      console.log(`Averaged to ${averagedData.length} data points (1 minute intervals)`);
      if (averagedData.length > 1) {
        const interval = averagedData[1].timestamp - averagedData[0].timestamp;
        console.log(`Averaged interval: ${interval}ms (expected: ~60000ms)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析エラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadChartAsPNG = () => {
    if (chartRef.current) {
      const chartInstance = chartRef.current.getEchartsInstance();
      const url = chartInstance.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: 'rgba(30, 32, 36, 0.95)'
      });
      
      const link = document.createElement('a');
      link.download = `station-access-analysis-${startTime.toISOString().slice(0, 10)}.png`;
      link.href = url;
      link.click();
    }
  };

  const downloadChartAsHTML = () => {
    if (chartRef.current && data.length > 0) {
      const chartInstance = chartRef.current.getEchartsInstance();
      const chartOption = chartInstance.getOption();
      
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>地上局アクセス解析 - ${startTime.toISOString().slice(0, 10)}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; padding: 30px; background: #141518; }
        #chart { width: 100%; height: 600px; }
        h1 { color: #ed6d00; font-family: Arial, sans-serif; text-align: center; }
    </style>
</head>
<body>
    <h1>地上局アクセス解析</h1>
    <div id="chart"></div>
    <script>
        var chart = echarts.init(document.getElementById('chart'), 'dark');
        var option = ${JSON.stringify(chartOption, null, 2)};
        chart.setOption(option);
        window.addEventListener('resize', function() {
            chart.resize();
        });
    </script>
</body>
</html>`;
      
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `station-access-analysis-${startTime.toISOString().slice(0, 10)}.html`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const downloadRawData = () => {
    if (data.length > 0) {
      // Create CSV format
      const headers = ['Time', 'Timestamp', ...stations.map(s => s.name)];
      const csvRows = [headers.join(',')];
      
      data.forEach(timeData => {
        const row = [
          timeData.time,
          timeData.timestamp,
          ...timeData.stations.map(s => s.visibleCount)
        ];
        csvRows.push(row.join(','));
      });
      
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `station-access-data-${startTime.toISOString().slice(0, 10)}.csv`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  // Generate color palette for different satellite counts
  const getColorForCount = (count: number, maxCount: number) => {
    if (count === 0) return '#2d3748'; // Dark gray for no satellites
    const intensity = count / maxCount;
    if (intensity < 0.33) return '#38a169'; // Green for low count
    if (intensity < 0.66) return '#d69e2e'; // Yellow for medium count
    return '#e53e3e'; // Red for high count
  };

  const option = data.length > 0 ? {
    title: {
      text: "地上局アクセス解析",
      textStyle: { color: "#ed6d00", fontSize: 16 },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: { color: "#f1f1f1" },
    grid: {
      left: 160, // Increased to make room for longer y-axis labels
      right: 10,
      top: 30,
      bottom: 100  // Increased to make room for both visualMap and dataZoom
    },
    xAxis: {
      type: 'category',
      data: data.map(d => d.time.substr(0, 5)), // All data points (now 1-minute intervals)
      axisLabel: { 
        color: "#999faa",
        rotate: 45,
        // interval: 9  // Show label every 10 data points (10 minutes)
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
      // max: Math.max(...data.flatMap(d => d.stations.map(s => s.visibleCount))),
      max: 10,
      calculable: true,
      orient: 'horizontal',
      // left: 'center',
      left: 'left',
      bottom: 0,  // Increased to avoid overlap with dataZoom
      textStyle: { color: "#f1f1f1" },
      inRange: {
        color: ['#2d3748', '#38a169', '#d69e2e', '#e53e3e']
      }
    },
    series: [{
      type: 'heatmap',
      data: data.flatMap((timeData, timeIndex) => 
        timeData.stations.map((station, stationIndex) => [
          timeIndex,
          stationIndex, 
          station.visibleCount
        ])
      ),
      label: {
        show: false // Remove numbers from heatmap
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }],
    tooltip: {
      show: false // Disable tooltip
    },
    dataZoom: [{
      type: 'slider',
      xAxisIndex: 0,
      start: 0,    // Start at 0%
      end: 16.67,   // End at 16.67% (4 hours out of 24 hours)
      bottom: 10,  // Moved down to avoid overlap with visualMap
      textStyle: { color: "#f1f1f1" },
      borderColor: "#ed6d00",
      fillerColor: "rgba(237, 109, 0, 0.3)",
      handleStyle: {
        color: "#ed6d00"
      }
    }]
  } : {
    title: {
      text: "地上局アクセス解析",
      textStyle: { color: "#ed6d00" },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)"
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "6px", borderBottom: "1px solid #444", display: "flex", gap: "6px", alignItems: "center" }}>
        <button
          onClick={analyzeAccess}
          disabled={isAnalyzing}
          style={{
            backgroundColor: "#ed6d00",
            color: "white",
            border: "none",
            padding: "2px 8px",
            borderRadius: "4px",
            cursor: isAnalyzing ? "not-allowed" : "pointer",
            opacity: isAnalyzing ? 0.6 : 1,
            transition: "all 0.2s ease"
          }}
          onMouseEnter={(e) => {
            if (!isAnalyzing) {
              e.currentTarget.style.backgroundColor = "#ff7b1a";
              e.currentTarget.style.transform = "scale(1.05)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isAnalyzing) {
              e.currentTarget.style.backgroundColor = "#ed6d00";
              e.currentTarget.style.transform = "scale(1)";
            }
          }}
        >
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>
        
        {data.length > 0 && (
          <>
            <button
              onClick={downloadChartAsPNG}
              style={{
                backgroundColor: "transparent",
                color: "#999faa",
                border: "1px solid #444",
                padding: "2px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "0.8em",
                transition: "all 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#333";
                e.currentTarget.style.color = "#f1f1f1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#999faa";
              }}
            >
              PNG保存
            </button>
            <button
              onClick={downloadChartAsHTML}
              style={{
                backgroundColor: "transparent",
                color: "#999faa",
                border: "1px solid #444",
                padding: "2px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "0.8em",
                transition: "all 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#333";
                e.currentTarget.style.color = "#f1f1f1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#999faa";
              }}
            >
              HTML保存
            </button>
            <button
              onClick={downloadRawData}
              style={{
                backgroundColor: "transparent",
                color: "#999faa",
                border: "1px solid #444",
                padding: "2px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "0.8em",
                transition: "all 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#333";
                e.currentTarget.style.color = "#f1f1f1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#999faa";
              }}
            >
              CSV保存
            </button>
          </>
        )}
        
        {error && (
          <span style={{ color: "#e53e3e", fontSize: "0.9em" }}>{error}</span>
        )}
      </div>
      
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", width: "100%" }}
          theme="dark"
        />
      </div>
    </div>
  );
}