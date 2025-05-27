import { useRef, useEffect, useState } from "react";
import SpeedControl from "./components/SpeedControl";
import SatelliteEditor from "./components/SatelliteEditor";
import { useSatelliteScene } from "./hooks/useSatelliteScene";
import { SATELLITES as INITIAL_SATS } from "./data/satellites";
import { loadGroundStations, type GroundStation } from "./data/groundStations";
import { formatSatelliteInfo } from "./utils/formatSatelliteInfo";
import { formatGroundStationInfo } from "./utils/formatGroundStationInfo";

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

  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });

  // speed exponent slider (0–2 → 1×–100×)
  const [speedExp, setSpeedExp] = useState(Math.log10(INITIAL_SPEED));
  const speedRef = useRef(INITIAL_SPEED);
  useEffect(() => {
    speedRef.current = Math.pow(10, speedExp);
  }, [speedExp]);
  useEffect(() => {
    loadGroundStations().then(setGroundStations);
  }, []);

  useSatelliteScene({
    mountRef,
    timeRef,
    speedRef,
    startTime,
    satellites,
    groundStations,
    satRadius,
    onSelect: setSelectedIdx,
    onSelectStation: setSelectedGsIdx,
    stationInfoRef: gsInfoRef,
  });

  const infoText = formatSatelliteInfo(satellites, selectedIdx);
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
      {infoText && (
        <pre
          style={{
            position: "fixed",
            left: 8,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
            color: "#fff",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: "0.9rem",
            pointerEvents: "none",
            whiteSpace: "pre",
            zIndex: 10,
          }}
        >
          {infoText}
        </pre>
      )}
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
        onUpdate={(s, gs, start) => {
          setSatellites(s);
          setGroundStations(gs);
          setStartTime(start);
        }}
      />
    </div>
  );
}

export default App;
