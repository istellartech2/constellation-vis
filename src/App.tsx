import { useRef, useEffect, useState } from "react";
import SpeedControl from "./components/ui/SpeedControl";
import SatelliteEditor from "./components/ui/SatelliteEditor";
import { useSatelliteScene } from "./components/useSatelliteScene";
import { SATELLITES as INITIAL_SATS } from "./lib/satellites";
import { loadGroundStations, type GroundStation } from "./lib/groundStations";
import SatelliteInfo from "./components/ui/SatelliteInfo";
import { formatGroundStationInfo } from "./lib/formatGroundStationInfo";

/**
 * Top level React component hosting the visualization. It sets up
 * the Three.js scene via {@link useSatelliteScene} and exposes a few UI
 * controls for manipulating the simulation.
 */

const INITIAL_SPEED = 60; // initial 60× real time

// Main UI component that wires together scene and UI controls
function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const gsInfoRef = useRef<HTMLPreElement | null>(null);

  const [satellites, setSatellites] = useState(INITIAL_SATS);
  const [groundStations, setGroundStations] = useState<GroundStation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedGsIdx, setSelectedGsIdx] = useState<number | null>(null);

  const [satRadius, setSatRadius] = useState(() =>
    window.innerWidth <= 600 ? 0.02 : 0.015,
  );

  const [earthTexture, setEarthTexture] = useState("./assets/earth01.webp");
  const [showGraticule, setShowGraticule] = useState(true);
  const [showEcliptic, setShowEcliptic] = useState(true);
  const [showSunDirection, setShowSunDirection] = useState(true);
  const [ecef, setEcef] = useState(false);
  const [showPerturbation, setShowPerturbation] = useState(false);

  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });

  // speed exponent slider (0–2 → 1×–100×)
  const [speedExp, setSpeedExp] = useState(Math.log10(INITIAL_SPEED));
  const speedRef = useRef(INITIAL_SPEED);
  const [isPaused, setIsPaused] = useState(false);
  const savedSpeedRef = useRef(INITIAL_SPEED);
  
  useEffect(() => {
    speedRef.current = isPaused ? 0 : Math.pow(10, speedExp);
  }, [speedExp, isPaused]);
  
  useEffect(() => {
    loadGroundStations().then(setGroundStations);
  }, []);

  const handleAnalysisStart = () => {
    savedSpeedRef.current = speedRef.current;
    setIsPaused(true);
  };

  const handleAnalysisEnd = () => {
    setIsPaused(false);
  };

  useSatelliteScene({
    mountRef,
    timeRef,
    speedRef,
    startTime,
    satellites,
    groundStations,
    satRadius,
    earthTexture,
    showGraticule,
    showEcliptic,
    showSunDirection,
    ecef,
    onSelect: setSelectedIdx,
    onSelectStation: setSelectedGsIdx,
    stationInfoRef: gsInfoRef,
  });

  const gsInfoText = formatGroundStationInfo(groundStations, selectedGsIdx);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <div
        ref={timeRef}
        style={{
          position: "fixed",
          right: 8,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
          color: "#fff",
          fontFamily: "'Noto Sans Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          fontSize: "0.9rem",
          pointerEvents: "none",
          whiteSpace: "pre",
          textAlign: "right",
          zIndex: 10,
        }}
      />
      <SatelliteInfo satellites={satellites} selectedIdx={selectedIdx} showPerturbation={showPerturbation} />
      {gsInfoText && (
        <pre
          ref={gsInfoRef}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: "translate(-50%, -100%)",
            color: "#fff",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: "0.9rem",
            pointerEvents: "none",
            whiteSpace: "pre",
            zIndex: 10,
          }}
        >
          {gsInfoText}
        </pre>
      )}
      <SpeedControl value={speedExp} onChange={setSpeedExp} />
      <SatelliteEditor
        satRadius={satRadius}
        onSatRadiusChange={setSatRadius}
        earthTexture={earthTexture}
        onEarthTextureChange={setEarthTexture}
        showGraticule={showGraticule}
        onShowGraticuleChange={setShowGraticule}
        showEcliptic={showEcliptic}
        onShowEclipticChange={setShowEcliptic}
        showSunDirection={showSunDirection}
        onShowSunDirectionChange={setShowSunDirection}
        ecef={ecef}
        onEcefChange={setEcef}
        showPerturbation={showPerturbation}
        onShowPerturbationChange={setShowPerturbation}
        onUpdate={(s, gs, start) => {
          setSatellites(s);
          setGroundStations(gs);
          setStartTime(start);
        }}
        onAnalysisStart={handleAnalysisStart}
        onAnalysisEnd={handleAnalysisEnd}
      />
    </div>
  );
}

export default App;
