import { useState, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, calculateStationStats, averageVisibilityData, calculateAvailabilityMetrics } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml, parseGroundStationsToml } from "../../lib/tomlParse";
import type { GroundStation } from "../../lib/groundStations";
import { downloadPNG, downloadHTML, downloadCSV } from "./utils/downloadUtils";
import { createStationAccessChartOption } from "./utils/chartOptions";
import StationAvailabilityPopup from "./components/StationAvailabilityPopup";
import "../../styles.css";

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
      const stationIndices = groundStations.map((_, index) => index);
      const availabilityData = calculateAvailabilityMetrics(visibilityData, stationIndices, 10);
      const availability = groundStations.map((station, index) => ({
        stationName: station.name,
        ...availabilityData[index]
      }));

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


  const downloadChartAsPNG = () => {
    downloadPNG(chartRef, `station-access-analysis-${startTime.toISOString().slice(0, 10)}.png`);
  };

  const downloadChartAsHTML = () => {
    if (chartRef.current && data.length > 0) {
      const chartInstance = chartRef.current.getEchartsInstance();
      const chartOption = chartInstance.getOption();
      downloadHTML(
        chartOption,
        "地上局アクセス解析",
        `station-access-analysis-${startTime.toISOString().slice(0, 10)}.html`
      );
    }
  };

  const downloadRawData = () => {
    if (data.length > 0) {
      const headers = ['Time', 'Timestamp', ...stations.map((s: GroundStation) => s.name)];
      const rows = data.map(timeData => [
        timeData.time,
        timeData.timestamp,
        ...timeData.stations.map((s: any) => s.visibleCount)
      ]);
      downloadCSV(headers, rows, `station-access-data-${startTime.toISOString().slice(0, 10)}.csv`);
    }
  };


  const option = createStationAccessChartOption(data, stations, stats);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="analysis-toolbar">
        <button
          onClick={analyzeAccess}
          disabled={isAnalyzing}
          className="analysis-primary-button"
        >
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>
        
        {data.length > 0 && (
          <>
            <button
              onClick={downloadChartAsPNG}
              className="analysis-secondary-button"
            >
              PNG保存
            </button>
            <button
              onClick={downloadChartAsHTML}
              className="analysis-secondary-button"
            >
              HTML保存
            </button>
            <button
              onClick={downloadRawData}
              className="analysis-secondary-button"
            >
              CSV保存
            </button>
            <button
              onClick={() => setShowAvailabilityPopup(true)}
              className="analysis-secondary-button"
            >
              可用性
            </button>
          </>
        )}
        
        {error && (
          <span className="analysis-error">{error}</span>
        )}
      </div>
      
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {isAnalyzing && (
          <div className="analysis-loading-overlay">
            <div className="analysis-loading-spinner" />
            <div className="analysis-loading-text">
              解析中...
            </div>
            <div className="analysis-loading-subtext">
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
      </div>
      
      <StationAvailabilityPopup
        show={showAvailabilityPopup}
        onClose={() => setShowAvailabilityPopup(false)}
        availabilityMetrics={availabilityMetrics}
        startTime={startTime}
      />
    </div>
  );
}