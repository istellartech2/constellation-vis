import { useRef, useEffect, useState, useCallback } from "react";
import SpeedControl from "./components/ui/SpeedControl";
import SatelliteEditor from "./components/ui/SatelliteEditor";
import { useSatelliteScene } from "./components/useSatelliteScene";
import { SATELLITES as INITIAL_SATS } from "./lib/satellites";
import { loadGroundStations, type GroundStation } from "./lib/groundStations";
import SatelliteInfo from "./components/ui/SatelliteInfo";
import { formatGroundStationInfo } from "./lib/formatGroundStationInfo";
import { type EarthTextureMode } from "./lib/earthTextures";
import { type SatelliteCameraMode } from "./lib/visualization";

/**
 * Top level React component hosting the visualization. It sets up
 * the Three.js scene via {@link useSatelliteScene} and exposes a few UI
 * controls for manipulating the simulation.
 */

const INITIAL_SPEED = 60; // initial 60× real time
const EARTH_RADIUS_KM = 6378.137;

// Main UI component that wires together scene and UI controls
function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const gsInfoRef = useRef<HTMLPreElement | null>(null);

  const [satellites, setSatellites] = useState(INITIAL_SATS);
  const [groundStations, setGroundStations] = useState<GroundStation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedGsIdx, setSelectedGsIdx] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<SatelliteCameraMode>("free");
  const [simTime, setSimTime] = useState(() => new Date());

  const [satRadius, setSatRadius] = useState(() =>
    window.innerWidth <= 600 ? 0.02 : 0.015,
  );

  const [earthTexture, setEarthTexture] = useState<EarthTextureMode>("./assets/earth01.webp");
  const [showGraticule, setShowGraticule] = useState(true);
  const [showEcliptic, setShowEcliptic] = useState(true);
  const [showSunDirection, setShowSunDirection] = useState(true);
  const [ecef, setEcef] = useState(false);
  const [showPerturbation, setShowPerturbation] = useState(false);
  const [showDerivedSatelliteInfo, setShowDerivedSatelliteInfo] = useState(false);
  const [brightEarth, setBrightEarth] = useState(false);
  const [whiteBackground, setWhiteBackground] = useState(false);
  const [showGroundStationCones, setShowGroundStationCones] = useState(false);
  const [showSatelliteFovCones, setShowSatelliteFovCones] = useState(false);
  const [groundConeMinElevationDeg, setGroundConeMinElevationDeg] = useState(30);
  const [groundConeDistanceKm, setGroundConeDistanceKm] = useState(1000);
  const [groundConeColor, setGroundConeColor] = useState("#3ec7a1");
  const [fovConeHalfAngleDeg, setFovConeHalfAngleDeg] = useState(30);
  const [fovConeColor, setFovConeColor] = useState("#3388ff");
  const fovConeMinHeight = 0.02;
  const [fovConeAlongTrackDeg, setFovConeAlongTrackDeg] = useState(0);
  const [fovConeCrossTrackDeg, setFovConeCrossTrackDeg] = useState(0);
  const [satelliteVisibleColor, setSatelliteVisibleColor] = useState("#00ff00");
  const [satelliteHiddenColor, setSatelliteHiddenColor] = useState("#ff0000");
  const [satelliteSelectedColor, setSatelliteSelectedColor] = useState("#00ffff");

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

  const handleSelectSatellite = useCallback((idx: number | null) => {
    setSelectedIdx(idx);
    setCameraMode("free");
  }, []);

  const handleAnalysisStart = () => {
    savedSpeedRef.current = speedRef.current;
    setIsPaused(true);
  };

  const handleAnalysisEnd = () => {
    setIsPaused(false);
  };

  const groundConeLength = Math.max(groundConeDistanceKm, 100) / EARTH_RADIUS_KM;

  const sceneRef = useSatelliteScene({
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
    showGroundStationCones,
    showSatelliteFovCones,
    groundConeMinElevationDeg,
    groundConeLength,
    groundConeColor,
    fovConeHalfAngleDeg,
    fovConeColor,
    fovConeMinHeight,
    fovConeAlongTrackDeg,
    fovConeCrossTrackDeg,
    satelliteVisibleColor,
    satelliteHiddenColor,
    satelliteSelectedColor,
    cameraMode,
    ecef,
    brightEarth,
    whiteBackground,
    onSelect: handleSelectSatellite,
    onSelectStation: setSelectedGsIdx,
    onSimTimeChange: setSimTime,
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
          color: whiteBackground ? "#111827" : "#fff",
          textShadow: whiteBackground
            ? "0 0 3px #fff, 0 0 3px #fff"
            : "0 0 3px rgba(0,0,0,0.6)",
          fontFamily: "'Noto Sans Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          fontSize: "0.9rem",
          pointerEvents: "none",
          whiteSpace: "pre",
          textAlign: "right",
          zIndex: 10,
        }}
      />
      <SatelliteInfo
        satellites={satellites}
        selectedIdx={selectedIdx}
        simTime={simTime}
        showDerivedInfo={showDerivedSatelliteInfo}
        showPerturbation={showPerturbation}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
      />
      {gsInfoText && (
        <pre
          ref={gsInfoRef}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: "translate(-50%, -100%)",
            color: whiteBackground ? "#111827" : "#fff",
            textShadow: whiteBackground
              ? "0 0 3px #fff, 0 0 3px #fff"
              : "0 0 3px rgba(0,0,0,0.6)",
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
      <SpeedControl value={speedExp} onChange={setSpeedExp} whiteBackground={whiteBackground} />
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
        showGroundStationCones={showGroundStationCones}
        onShowGroundStationConesChange={setShowGroundStationCones}
        showSatelliteFovCones={showSatelliteFovCones}
        onShowSatelliteFovConesChange={setShowSatelliteFovCones}
        groundConeMinElevationDeg={groundConeMinElevationDeg}
        onGroundConeMinElevationDegChange={setGroundConeMinElevationDeg}
        groundConeDistanceKm={groundConeDistanceKm}
        onGroundConeDistanceKmChange={setGroundConeDistanceKm}
        groundConeColor={groundConeColor}
        onGroundConeColorChange={setGroundConeColor}
        fovConeHalfAngleDeg={fovConeHalfAngleDeg}
        onFovConeHalfAngleDegChange={setFovConeHalfAngleDeg}
        fovConeColor={fovConeColor}
        onFovConeColorChange={setFovConeColor}
        fovConeMinHeight={fovConeMinHeight}
        fovConeAlongTrackDeg={fovConeAlongTrackDeg}
        onFovConeAlongTrackDegChange={setFovConeAlongTrackDeg}
        fovConeCrossTrackDeg={fovConeCrossTrackDeg}
        onFovConeCrossTrackDegChange={setFovConeCrossTrackDeg}
        satelliteVisibleColor={satelliteVisibleColor}
        onSatelliteVisibleColorChange={setSatelliteVisibleColor}
        satelliteHiddenColor={satelliteHiddenColor}
        onSatelliteHiddenColorChange={setSatelliteHiddenColor}
        satelliteSelectedColor={satelliteSelectedColor}
        onSatelliteSelectedColorChange={setSatelliteSelectedColor}
        ecef={ecef}
        onEcefChange={setEcef}
        showPerturbation={showPerturbation}
        onShowPerturbationChange={setShowPerturbation}
        showDerivedSatelliteInfo={showDerivedSatelliteInfo}
        onShowDerivedSatelliteInfoChange={setShowDerivedSatelliteInfo}
        brightEarth={brightEarth}
        onBrightEarthChange={setBrightEarth}
        whiteBackground={whiteBackground}
        onWhiteBackgroundChange={setWhiteBackground}
        sceneRef={sceneRef}
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
