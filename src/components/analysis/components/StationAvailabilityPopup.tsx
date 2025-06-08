import { downloadCSV } from "../utils/downloadUtils";
import "../../../styles.css";

interface AvailabilityMetrics {
  stationName: string;
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

export default function StationAvailabilityPopup({ show, onClose, availabilityMetrics, startTime }: Props) {
  if (!show) return null;

  const handleDownloadCSV = () => {
    const headers = ['地上局名', '時間的可用性(%)', '中断頻度(回/日)', '最大中断時間(分)', '平均中断時間(分)'];
    const rows = availabilityMetrics.map(metrics => [
      metrics.stationName,
      metrics.timeAvailability.toFixed(1),
      metrics.interruptionFrequency.toString(),
      metrics.maxInterruptionTime.toFixed(1),
      metrics.avgInterruptionTime.toFixed(1)
    ]);
    
    downloadCSV(headers, rows, `station-availability-${startTime.toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="analysis-popup-overlay">
      <div className="analysis-popup-container" style={{ width: "90vw", maxWidth: "1200px", maxHeight: "85vh", overflow: "auto" }}>
        <div className="analysis-popup-header">
          <h2 className="analysis-popup-title">地上局可用性解析</h2>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={handleDownloadCSV}
              className="analysis-secondary-button"
            >
              CSV保存
            </button>
            <button
              onClick={onClose}
              className="analysis-close-button"
            >
              ×
            </button>
          </div>
        </div>
        
        {availabilityMetrics.length > 0 ? (
          <div>
            <div className="availability-info">
              <span>• 時間的可用性: 衛星と通信可能な時間の割合</span>
              <span>• 中断頻度: 1日あたりの通信中断回数</span>
              <span>• 最大/平均中断時間: 通信できない時間の継続</span>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {availabilityMetrics.map((metrics, index) => (
                <div key={index} className="availability-card">
                  <h3 className="availability-card-title">{metrics.stationName}</h3>
                  <div className="availability-metrics">
                    <div>
                      <span className="availability-metric-label">時間的可用性:</span>
                      <span className="availability-metric-value">
                        {metrics.timeAvailability.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="availability-metric-label">中断頻度:</span>
                      <span className="availability-metric-value">
                        {metrics.interruptionFrequency}回/日
                      </span>
                    </div>
                    <div>
                      <span className="availability-metric-label">最大中断時間:</span>
                      <span className="availability-metric-value">
                        {metrics.maxInterruptionTime.toFixed(1)}分
                      </span>
                    </div>
                    <div>
                      <span className="availability-metric-label">平均中断時間:</span>
                      <span className="availability-metric-value">
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
  );
}