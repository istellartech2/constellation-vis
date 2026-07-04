import { useState } from "react";
import { createPortal } from "react-dom";
import { Radio, Globe2, Rocket, Sun, Waypoints } from "lucide-react";
import StationAccessAnalysis from "../analysis/StationAccessAnalysis";
import GlobalAccessAnalysis from "../analysis/GlobalAccessAnalysis";
import OrbitMaintenanceAnalysis from "../analysis/OrbitMaintenanceAnalysis";
import SolarImpactAnalysis from "../analysis/SolarImpactAnalysis";
import IslRoutingAnalysis from "../analysis/IslRoutingAnalysis";
import PanelSection from "./PanelSection";
import EntryButton from "./EntryButton";
import type { SatelliteSpec } from "../../lib/satellites";
import type { IslSettings, IslShellRange } from "../../lib/isl/types";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startTime: Date;
  /** The currently active (committed) satellite array — matches islShellRanges exactly. */
  satellites: SatelliteSpec[];
  islSettings: IslSettings;
  islShellRanges: IslShellRange[];
  onAnalysisStart?: () => void;
  onAnalysisEnd?: () => void;
}

type AnalysisType =
  | "地上局アクセス設計"
  | "全球アクセス設計"
  | "軌道寿命・推進剤設計"
  | "日照・電力成立性評価"
  | "ISL経路タイムライン解析"
  | "";

export default function AnalysisTab({
  satText,
  constText,
  gsText,
  startTime,
  satellites,
  islSettings,
  islShellRanges,
  onAnalysisStart,
  onAnalysisEnd,
}: Props) {
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
      case "ISL経路タイムライン解析":
        return <IslRoutingAnalysis
          satellites={satellites}
          islSettings={islSettings}
          islShellRanges={islShellRanges}
          startTime={startTime}
        />;
      default:
        return null;
    }
  };

  return (
    <>
      <PanelSection title="通信・アクセス" icon={<Radio />}>
        <EntryButton
          icon={<Radio className="h-4 w-4" />}
          title="地上局アクセス設計"
          subtitle="衛星と地上局が見通せる時間帯を可視化"
          onClick={() => handleAnalysisClick("地上局アクセス設計")}
        />
        <EntryButton
          icon={<Globe2 className="h-4 w-4" />}
          title="全球アクセス設計"
          subtitle="地球各地点での通信可能性を評価"
          onClick={() => handleAnalysisClick("全球アクセス設計")}
        />
      </PanelSection>

      <PanelSection title="軌道・電力" icon={<Rocket />}>
        <EntryButton
          icon={<Rocket className="h-4 w-4" />}
          title="軌道寿命・推進剤設計"
          subtitle="大気抵抗による軌道維持に必要な推進剤を試算"
          onClick={() => handleAnalysisClick("軌道寿命・推進剤設計")}
        />
        <EntryButton
          icon={<Sun className="h-4 w-4" />}
          title="日照・電力成立性評価"
          subtitle="日陰時間と発電量から電力収支を確認"
          onClick={() => handleAnalysisClick("日照・電力成立性評価")}
        />
      </PanelSection>

      <PanelSection title="ISL 経路探索" icon={<Waypoints />}>
        <EntryButton
          icon={<Waypoints className="h-4 w-4" />}
          title="ISL経路タイムライン解析"
          subtitle="時間窓スイープで総遅延・ホップ数・切替回数・到達可能率を確認"
          onClick={() => handleAnalysisClick("ISL経路タイムライン解析")}
        />
      </PanelSection>

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
