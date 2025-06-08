import { useState } from "react";
import StationAccessAnalysis from "../analysis/StationAccessAnalysis";
import GlobalAccessAnalysis from "../analysis/GlobalAccessAnalysis";
import GlobalAvailabilityAnalysis from "../analysis/GlobalAvailabilityAnalysis";
import OrbitMaintenanceAnalysis from "../analysis/OrbitMaintenanceAnalysis";
import SolarImpactAnalysis from "../analysis/SolarImpactAnalysis";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
  onAnalysisStart?: () => void;
  onAnalysisEnd?: () => void;
}

type AnalysisType = 
  | "地上局アクセス解析"
  | "全球アクセス解析"
  | "全球可用性解析"
  | "軌道維持燃料解析"
  | "太陽光影響解析"
  | "";

export default function AnalysisTab({ satText, constText, gsText, startTime, onAnalysisStart, onAnalysisEnd }: Props) {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("");

  function handleAnalysisClick(type: AnalysisType) {
    setAnalysisType(type);
    setAnalysisOpen(true);
    onAnalysisStart?.();
  }

  function handleAnalysisClose() {
    setAnalysisOpen(false);
    setAnalysisType("");
    onAnalysisEnd?.();
  }

  const renderAnalysisComponent = () => {
    switch (analysisType) {
      case "地上局アクセス解析":
        return <StationAccessAnalysis 
          satText={satText}
          constText={constText}
          gsText={gsText}
          startTime={startTime}
        />;
      case "全球アクセス解析":
        return <GlobalAccessAnalysis 
          satText={satText}
          constText={constText}
          startTime={startTime}
        />;
      case "全球可用性解析":
        return <GlobalAvailabilityAnalysis />;
      case "軌道維持燃料解析":
        return <OrbitMaintenanceAnalysis />;
      case "太陽光影響解析":
        return <SolarImpactAnalysis />;
      default:
        return null;
    }
  };

  return (
    <>
      <div>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>通信性能解析</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("地上局アクセス解析")}
            >
              地上局アクセス解析
            </button>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("全球アクセス解析")}
            >
              全球アクセス解析
            </button>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("全球可用性解析")}
            >
              全球可用性解析
            </button>
          </div>
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>軌道運用解析</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("軌道維持燃料解析")}
            >
              軌道維持燃料解析
            </button>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("太陽光影響解析")}
            >
              太陽光影響解析
            </button>
          </div>
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>衛星解析</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button 
              className="analysis-button"
              disabled
              style={{ opacity: 0.5 }}
            >
              Coming Soon
            </button>
          </div>
        </div>
      </div>

      {analysisOpen && (
        <div className="overlay" style={{ zIndex: 50 }}>
          <div className="overlay-box" style={{ width: "90%", maxWidth: "1200px", height: "80%", maxHeight: "900px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>{analysisType}</h3>
              <button
                onClick={handleAnalysisClose}
                style={{ background: "transparent", border: "none", color: "#999faa", fontSize: "1.5rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {renderAnalysisComponent()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}