import { useEffect, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { GroundStation } from "../../lib/groundStations";
import { downloadPNG, downloadHTML, downloadCSV } from "./utils/downloadUtils";
import { createStationAccessChartOption } from "./utils/chartOptions";
import StationAvailabilityPopup from "./StationAvailabilityPopup";
import type { StationVisibilitySample } from "../../lib/visibility";
import type {
  StationAccessWorkerRequest,
  StationAccessWorkerResponse,
  StationAvailabilityMetrics,
} from "../../workers/stationAccessWorker.types";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
}

export default function StationAccessAnalysis({ satText, constText, gsText, startTime }: Props) {
  const [data, setData] = useState<StationVisibilitySample[]>([]);
  const [stations, setStations] = useState<GroundStation[]>([]);
  const [stats, setStats] = useState<Array<{ name: string; averageVisible: number; nonZeroRate: number }>>([]);
  const [availabilityMetrics, setAvailabilityMetrics] = useState<StationAvailabilityMetrics[]>([]);
  const [showAvailabilityPopup, setShowAvailabilityPopup] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>("");
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const latestJobId = useRef(0);
  const analyzingRef = useRef(false);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/stationAccessWorker.ts", import.meta.url),
      { type: "module" },
    );

    const handleMessage = (event: MessageEvent<StationAccessWorkerResponse>) => {
      const message = event.data;
      if (message.id !== latestJobId.current) {
        return;
      }

      if (message.type === "success") {
        const { averagedData, stations: workerStations, stats: workerStats, availabilityMetrics: workerAvailability, rawPointCount, averagePoints, durationHours } =
          message.payload;

        setData(averagedData);
        setStations(workerStations);
        setStats(workerStats);
        setAvailabilityMetrics(workerAvailability);
        setError("");
        setIsAnalyzing(false);
        analyzingRef.current = false;

        console.log(`Generated ${rawPointCount} data points for ${durationHours} hours`);
        console.log(`Averaged to ${averagedData.length} data points (averaging ${averagePoints} samples)`);
        if (averagedData.length > 1) {
          const interval = averagedData[1].timestamp - averagedData[0].timestamp;
          console.log(`Averaged interval: ${interval}ms`);
        }
      } else {
        setError(message.message);
        setIsAnalyzing(false);
        analyzingRef.current = false;
      }
    };

    const handleError = (event: ErrorEvent) => {
      if (!analyzingRef.current) return;
      setError(event.message || "解析ワーカーでエラーが発生しました");
      setIsAnalyzing(false);
      analyzingRef.current = false;
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    workerRef.current = worker;

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
      workerRef.current = null;
      analyzingRef.current = false;
    };
  }, []);

  const analyzeAccess = () => {
    const worker = workerRef.current;
    if (!worker) {
      setError("解析ワーカーが初期化されていません");
      return;
    }
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setError("");

    const id = latestJobId.current + 1;
    latestJobId.current = id;

    const request: StationAccessWorkerRequest = {
      id,
      type: "analyze",
      payload: {
        satText,
        constText,
        gsText,
        startTimeIso: startTime.toISOString(),
        durationHours: 24,
        stepSeconds: 10,
        averagePoints: 1,
      },
    };

    worker.postMessage(request);
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
        ...timeData.stations.map((station) => station.visibleCount)
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
