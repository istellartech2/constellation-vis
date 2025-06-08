import { useState, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, calculateStationStats, averageVisibilityData } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from "../../lib/tomlParse";
import type { SatelliteSpec } from "../../lib/satellites";
import type { GroundStation } from "../../lib/groundStations";

interface AvailabilityMetrics {
  stationName: string;
  timeAvailability: number; // 時間的可用性（%）
  interruptionFrequency: number; // 中断頻度（回/日）
  maxInterruptionTime: number; // 最大中断時間（分）
  avgInterruptionTime: number; // 平均中断時間（分）
}

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
  const [availabilityMetrics, setAvailabilityMetrics] = useState<AvailabilityMetrics[]>([]);
  const [showAvailabilityPopup, setShowAvailabilityPopup] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const chartRef = useRef<any>(null);

  const analyzeAccess = async () => {
    setIsAnalyzing(true);
    setError("");
    
    // Allow UI to update before starting heavy computation
    await new Promise(resolve => setTimeout(resolve, 10));
    
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

      // Calculate availability metrics
      const availability = calculateAvailabilityMetrics(visibilityData, groundStations);

      setData(averagedData);
      setStations(groundStations);
      setStats(stationStats);
      setAvailabilityMetrics(availability);
      
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

  const calculateAvailabilityMetrics = (visibilityData: any[], stations: GroundStation[]): AvailabilityMetrics[] => {
    const intervalMinutes = 10 / 60; // 10 seconds = 1/6 minute
    const totalMinutes = 24 * 60; // 24 hours in minutes
    
    return stations.map((station, stationIndex) => {
      // Extract visibility data for this station
      const stationData = visibilityData.map(timePoint => 
        timePoint.stations[stationIndex]?.visibleCount || 0
      );
      
      // Calculate time availability (percentage of time with satellites visible)
      const availablePoints = stationData.filter(count => count > 0).length;
      const timeAvailability = (availablePoints / stationData.length) * 100;
      
      // Calculate interruption frequency and times
      let interruptionFrequency = 0;
      const interruptionDurations: number[] = [];
      let currentInterruptionStart = -1;
      
      for (let i = 0; i < stationData.length; i++) {
        if (stationData[i] === 0) {
          if (currentInterruptionStart === -1) {
            // Start of interruption
            currentInterruptionStart = i;
            if (i > 0) interruptionFrequency++; // Don't count initial state
          }
        } else {
          if (currentInterruptionStart !== -1) {
            // End of interruption
            const duration = (i - currentInterruptionStart) * intervalMinutes;
            interruptionDurations.push(duration);
            currentInterruptionStart = -1;
          }
        }
      }
      
      // Handle case where data ends during interruption
      if (currentInterruptionStart !== -1) {
        const duration = (stationData.length - currentInterruptionStart) * intervalMinutes;
        interruptionDurations.push(duration);
      }
      
      const maxInterruptionTime = interruptionDurations.length > 0 
        ? Math.max(...interruptionDurations) 
        : 0;
      const avgInterruptionTime = interruptionDurations.length > 0 
        ? interruptionDurations.reduce((sum, dur) => sum + dur, 0) / interruptionDurations.length 
        : 0;
      
      return {
        stationName: station.name,
        timeAvailability,
        interruptionFrequency,
        maxInterruptionTime,
        avgInterruptionTime
      };
    });
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
            <button
              onClick={() => setShowAvailabilityPopup(true)}
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
              可用性
            </button>
          </>
        )}
        
        {error && (
          <span style={{ color: "#e53e3e", fontSize: "0.9em" }}>{error}</span>
        )}
      </div>
      
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {isAnalyzing && (
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(20, 21, 24, 0.8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(2px)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              border: "3px solid #333",
              borderTop: "3px solid #ed6d00",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "16px"
            }} />
            <div style={{ color: "#ed6d00", fontSize: "16px", fontWeight: "500" }}>
              解析中...
            </div>
            <div style={{ color: "#999faa", fontSize: "14px", marginTop: "8px" }}>
              数秒お待ちください
            </div>
          </div>
        )}
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", width: "100%" }}
          theme="dark"
        />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
      
      {/* Availability Popup */}
      {showAvailabilityPopup && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: "#1e2024",
            border: "1px solid #444",
            borderRadius: "8px",
            padding: "16px",
            width: "90vw",
            maxWidth: "1200px",
            maxHeight: "85vh",
            overflow: "auto",
            color: "#f1f1f1"
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              borderBottom: "1px solid #444",
              paddingBottom: "8px"
            }}>
              <h2 style={{ margin: 0, color: "#ed6d00", fontSize: "1.3em" }}>地上局可用性解析</h2>
              <button
                onClick={() => setShowAvailabilityPopup(false)}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  color: "#999faa",
                  fontSize: "20px",
                  cursor: "pointer",
                  padding: "0 5px"
                }}
              >
                ×
              </button>
            </div>
            
            {availabilityMetrics.length > 0 ? (
              <div>
                <div style={{ marginBottom: "10px", color: "#999faa", fontSize: "0.85em", display: "flex", gap: "20px" }}>
                  <span>• 時間的可用性: 衛星と通信可能な時間の割合</span>
                  <span>• 中断頻度: 1日あたりの通信中断回数</span>
                  <span>• 最大/平均中断時間: 通信できない時間の継続</span>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {availabilityMetrics.map((metrics, index) => (
                    <div key={index} style={{
                      backgroundColor: "#2a2d35",
                      border: "1px solid #444",
                      borderRadius: "6px",
                      padding: "12px"
                    }}>
                      <h3 style={{ margin: "0 0 8px 0", color: "#ed6d00", fontSize: "1.1em" }}>{metrics.stationName}</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px", fontSize: "0.9em" }}>
                        <div>
                          <span style={{ color: "#999faa" }}>時間的可用性:</span>
                          <span style={{ marginLeft: "8px", fontWeight: "bold" }}>
                            {metrics.timeAvailability.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "#999faa" }}>中断頻度:</span>
                          <span style={{ marginLeft: "8px", fontWeight: "bold" }}>
                            {metrics.interruptionFrequency}回/日
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "#999faa" }}>最大中断時間:</span>
                          <span style={{ marginLeft: "8px", fontWeight: "bold" }}>
                            {metrics.maxInterruptionTime.toFixed(1)}分
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "#999faa" }}>平均中断時間:</span>
                          <span style={{ marginLeft: "8px", fontWeight: "bold" }}>
                            {metrics.avgInterruptionTime.toFixed(1)}分
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ color: "#999faa" }}>可用性データがありません。解析を実行してください。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}