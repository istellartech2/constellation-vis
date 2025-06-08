import { useState, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, calculateStationStats, averageVisibilityData } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml } from "../../lib/tomlParse";
import type { SatelliteSpec } from "../../lib/satellites";
import type { GroundStation } from "../../lib/groundStations";

interface Props {
  satText: string;
  constText: string;
  startTime: Date;
}

export default function GlobalAccessAnalysis({ satText, constText, startTime }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [latitudeStations, setLatitudeStations] = useState<GroundStation[]>([]);
  const [stats, setStats] = useState<Array<{name: string; averageVisible: number; nonZeroRate: number}>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const [minElevationAngle, setMinElevationAngle] = useState(30);
  const [observationLongitude, setObservationLongitude] = useState(0);
  const chartRef = useRef<any>(null);

  const analyzeGlobalCoverage = async () => {
    setIsAnalyzing(true);
    setError("");
    
    // Allow UI to update before starting heavy computation
    await new Promise(resolve => setTimeout(resolve, 10));
    
    try {
      // Parse TOML data
      const baseSats = satText ? parseSatellitesToml(satText) : [];
      const constSats = constText ? parseConstellationToml(constText) : [];
      
      const allSatellites = [...baseSats, ...constSats];
      if (allSatellites.length === 0) {
        throw new Error("衛星データがありません");
      }

      // Create ground stations at specified longitude, latitude from -90 to 90 degrees with 1 degree steps
      const generatedStations: GroundStation[] = [];
      for (let lat = -90; lat <= 90; lat++) {
        generatedStations.push({
          name: `Lat${lat}°`,
          latitudeDeg: lat,
          longitudeDeg: observationLongitude,
          heightKm: 0,
          minElevationDeg: minElevationAngle
        });
      }

      // Calculate visibility data for 24 hours
      const visibilityData = calculateStationAccessData(
        allSatellites,
        generatedStations,
        startTime,
        24, // 24 hours
        10  // 10 second intervals
      );

      // Average the data for 1 miniuts
      const averagedData = averageVisibilityData(visibilityData, 6);
      
      // Calculate statistics from original data
      const stationStats = calculateStationStats(visibilityData);

      setData(averagedData);
      setLatitudeStations(generatedStations);
      setStats(stationStats);
      
      console.log(`Generated ${visibilityData.length} data points for 24 hours`);
      console.log(`Averaged to ${averagedData.length} data points (1 minute intervals)`);
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
      link.download = `global-coverage-analysis-${startTime.toISOString().slice(0, 10)}.png`;
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
    <title>全球アクセス解析 - ${startTime.toISOString().slice(0, 10)}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; padding: 30px; background: #141518; }
        #chart { width: 100%; height: 600px; }
        h1 { color: #ed6d00; font-family: Arial, sans-serif; text-align: center; }
    </style>
</head>
<body>
    <h1>全球アクセス解析</h1>
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
      link.download = `global-coverage-analysis-${startTime.toISOString().slice(0, 10)}.html`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const downloadRawData = () => {
    if (data.length > 0) {
      // Create CSV format
      const headers = ['Time', 'Timestamp', ...latitudeStations.map(s => s.name)];
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
      link.download = `global-coverage-data-${startTime.toISOString().slice(0, 10)}.csv`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const option = data.length > 0 ? {
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
        timeData.stations.map((station, stationIndex) => [
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
  } : {
    title: {
      text: "全球アクセス解析",
      textStyle: { color: "#ed6d00" },
      left: 'center'
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)"
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "6px", borderBottom: "1px solid #444", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={analyzeGlobalCoverage}
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
        
        <label style={{ display: "flex", alignItems: "center", gap: "4px", color: "#999faa", fontSize: "0.9em" }}>
          最低仰角:
          <input
            type="number"
            min="0"
            max="80"
            value={minElevationAngle}
            onChange={(e) => setMinElevationAngle(Number(e.target.value))}
            style={{
              width: "50px",
              padding: "2px 4px",
              backgroundColor: "#333",
              color: "#f1f1f1",
              border: "1px solid #555",
              borderRadius: "3px"
            }}
            disabled={isAnalyzing}
          />
          °
        </label>
        
        <label style={{ display: "flex", alignItems: "center", gap: "4px", color: "#999faa", fontSize: "0.9em" }}>
          観測経度:
          <input
            type="number"
            min="-180"
            max="180"
            value={observationLongitude}
            onChange={(e) => setObservationLongitude(Number(e.target.value))}
            style={{
              width: "60px",
              padding: "2px 4px",
              backgroundColor: "#333",
              color: "#f1f1f1",
              border: "1px solid #555",
              borderRadius: "3px"
            }}
            disabled={isAnalyzing}
          />
          °
        </label>
        
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
    </div>
  );
}