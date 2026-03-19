import { useState } from "react";
import { createPortal } from "react-dom";
import StationAccessAnalysis from "../analysis/StationAccessAnalysis";
import GlobalAccessAnalysis from "../analysis/GlobalAccessAnalysis";
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
  | "地上局アクセス設計"
  | "全球アクセス設計"
  | "軌道寿命・推進剤設計"
  | "日照・電力成立性評価"
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
      case "地上局アクセス設計":
        return <StationAccessAnalysis 
          satText={satText}
          constText={constText}
          gsText={gsText}
          startTime={startTime}
        />;
      case "全球アクセス設計":
        return <GlobalAccessAnalysis 
          satText={satText}
          constText={constText}
          startTime={startTime}
        />;
      case "軌道寿命・推進剤設計":
        return <OrbitMaintenanceAnalysis
          satText={satText}
          constText={constText}
          startTime={startTime}
        />;
      case "日照・電力成立性評価":
        return <SolarImpactAnalysis
          satText={satText}
          constText={constText}
          startTime={startTime}
        />;
      default:
        return null;
    }
  };

  return (
    <>
      <div>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>通信・アクセス概念設計</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("地上局アクセス設計")}
            >
              地上局アクセス設計
            </button>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("全球アクセス設計")}
            >
              全球アクセス設計
            </button>
          </div>
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>軌道・電力概念設計</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("軌道寿命・推進剤設計")}
            >
              軌道寿命・推進剤設計
            </button>
            <button 
              className="analysis-button"
              onClick={() => handleAnalysisClick("日照・電力成立性評価")}
            >
              日照・電力成立性評価
            </button>
          </div>
        </div>
      </div>

      {analysisOpen && createPortal(
        <div className="overlay" style={{ zIndex: 1000 }}>
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
        </div>,
        document.body
      )}
    </>
  );
}
