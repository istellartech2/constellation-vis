import { useState, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { calculateStationAccessData, calculateStationStats, averageVisibilityData, calculateAvailabilityMetrics } from "../../lib/visibility";
import { parseSatellitesToml, parseConstellationToml } from "../../lib/tomlParse";
import type { GroundStation } from "../../lib/groundStations";
import { downloadPNG, downloadHTML, downloadCSV } from "./utils/downloadUtils";
import { createGlobalAccessChartOption } from "./utils/chartOptions";
import GlobalAvailabilityPopup from "./components/GlobalAvailabilityPopup";
import "./analysis.css";

interface AvailabilityMetrics {
  latitude: number;
  timeAvailability: number; // 時間的可用性（%）
  interruptionFrequency: number; // 中断頻度（回/日）
  maxInterruptionTime: number; // 最大中断時間（分）
  avgInterruptionTime: number; // 平均中断時間（分）
}

interface Props {
  satText: string;
  constText: string;
  startTime: Date;
}

export default function GlobalAccessAnalysis({ satText, constText, startTime }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [latitudeStations, setLatitudeStations] = useState<GroundStation[]>([]);
  const [stats, setStats] = useState<Array<{name: string; averageVisible: number; nonZeroRate: number}>>([]);
  const [availabilityMetrics, setAvailabilityMetrics] = useState<AvailabilityMetrics[]>([]);
  const [showAvailabilityPopup, setShowAvailabilityPopup] = useState(false);
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

      // Calculate availability metrics
      const stationIndices = generatedStations.map((_, index) => index);
      const availabilityData = calculateAvailabilityMetrics(visibilityData, stationIndices, 10);
      const availability = generatedStations.map((station, index) => ({
        latitude: station.latitudeDeg,
        ...availabilityData[index]
      }));

      setData(averagedData);
      setLatitudeStations(generatedStations);
      setStats(stationStats);
      setAvailabilityMetrics(availability);
      
      console.log(`Generated ${visibilityData.length} data points for 24 hours`);
      console.log(`Averaged to ${averagedData.length} data points (1 minute intervals)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析エラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };


  const downloadChartAsPNG = () => {
    downloadPNG(chartRef, `global-coverage-analysis-${startTime.toISOString().slice(0, 10)}.png`);
  };

  const downloadChartAsHTML = () => {
    if (chartRef.current && data.length > 0) {
      const chartInstance = chartRef.current.getEchartsInstance();
      const chartOption = chartInstance.getOption();
      downloadHTML(
        chartOption,
        "全球アクセス解析",
        `global-coverage-analysis-${startTime.toISOString().slice(0, 10)}.html`
      );
    }
  };

  const downloadRawData = () => {
    if (data.length > 0) {
      const headers = ['Time', 'Timestamp', ...latitudeStations.map(s => s.name)];
      const rows = data.map(timeData => [
        timeData.time,
        timeData.timestamp,
        ...timeData.stations.map((s: any) => s.visibleCount)
      ]);
      downloadCSV(headers, rows, `global-coverage-data-${startTime.toISOString().slice(0, 10)}.csv`);
    }
  };

  const option = createGlobalAccessChartOption(data, latitudeStations, stats);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="analysis-toolbar">
        <button
          onClick={analyzeGlobalCoverage}
          disabled={isAnalyzing}
          className="analysis-primary-button"
        >
          {isAnalyzing ? "解析中..." : "解析開始"}
        </button>
        
        <label className="analysis-input-label">
          最低仰角:
          <input
            type="number"
            min="0"
            max="80"
            value={minElevationAngle}
            onChange={(e) => setMinElevationAngle(Number(e.target.value))}
            className="analysis-input"
            style={{ width: "50px" }}
            disabled={isAnalyzing}
          />
          °
        </label>
        
        <label className="analysis-input-label">
          観測経度:
          <input
            type="number"
            min="-180"
            max="180"
            value={observationLongitude}
            onChange={(e) => setObservationLongitude(Number(e.target.value))}
            className="analysis-input"
            style={{ width: "60px" }}
            disabled={isAnalyzing}
          />
          °
        </label>
        
        {data.length > 0 && (
          <>
            <button onClick={downloadChartAsPNG} className="analysis-secondary-button">
              PNG保存
            </button>
            <button onClick={downloadChartAsHTML} className="analysis-secondary-button">
              HTML保存
            </button>
            <button onClick={downloadRawData} className="analysis-secondary-button">
              CSV保存
            </button>
            <button onClick={() => setShowAvailabilityPopup(true)} className="analysis-secondary-button">
              可用性
            </button>
          </>
        )}
        
        {error && <span className="analysis-error">{error}</span>}
      </div>
      
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {isAnalyzing && (
          <div className="analysis-loading-overlay">
            <div className="analysis-loading-spinner" />
            <div className="analysis-loading-text">解析中...</div>
            <div className="analysis-loading-subtext">数秒お待ちください</div>
          </div>
        )}
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", width: "100%" }}
          theme="dark"
        />
      </div>
      
      <GlobalAvailabilityPopup
        show={showAvailabilityPopup}
        onClose={() => setShowAvailabilityPopup(false)}
        availabilityMetrics={availabilityMetrics}
        startTime={startTime}
      />
    </div>
  );
}