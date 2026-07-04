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
import {
  loadLastView,
  saveLastView,
  buildViewSettings,
  type CameraSnapshot,
  type DisplaySettings,
  type ViewSettings,
} from "./lib/viewState";
import { createDefaultIslSettings, type IslPathResult, type IslSettings } from "./lib/isl/types";

/**
 * Top level React component hosting the visualization. It sets up
 * the Three.js scene via {@link useSatelliteScene} and exposes a few UI
 * controls for manipulating the simulation.
 */

const INITIAL_SPEED = 60; // initial 60× real time
const EARTH_RADIUS_KM = 6378.137;

// Snapshot of the previous session's view (camera + display settings), if any.
// Read once at module load so every useState below can seed from it; falls back
// to defaults when absent or invalid.
const SAVED_VIEW = loadLastView();
const SAVED_DISPLAY = SAVED_VIEW?.display ?? null;

// Main UI component that wires together scene and UI controls
function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const gsInfoRef = useRef<HTMLPreElement | null>(null);

  const [satellites, setSatellites] = useState(INITIAL_SATS);
  const [groundStations, setGroundStations] = useState<GroundStation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedGsIdx, setSelectedGsIdx] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<SatelliteCameraMode>(
    SAVED_VIEW?.camera.mode ?? "free",
  );
  const [simTime, setSimTime] = useState(() => new Date());

  const [satRadius, setSatRadius] = useState(
    () => SAVED_DISPLAY?.satRadius ?? (window.innerWidth <= 600 ? 0.02 : 0.015),
  );

  const [earthTexture, setEarthTexture] = useState<EarthTextureMode>(
    SAVED_DISPLAY?.earthTexture ?? "./assets/earth01.webp",
  );
  const [showGraticule, setShowGraticule] = useState(SAVED_DISPLAY?.showGraticule ?? true);
  const [showEcliptic, setShowEcliptic] = useState(SAVED_DISPLAY?.showEcliptic ?? true);
  const [showGeoOrbit, setShowGeoOrbit] = useState(SAVED_DISPLAY?.showGeoOrbit ?? false);
  const [showSunDirection, setShowSunDirection] = useState(SAVED_DISPLAY?.showSunDirection ?? true);
  const [ecef, setEcef] = useState(SAVED_DISPLAY?.ecef ?? false);
  const [showPerturbation, setShowPerturbation] = useState(SAVED_DISPLAY?.showPerturbation ?? false);
  const [showDerivedSatelliteInfo, setShowDerivedSatelliteInfo] = useState(
    SAVED_DISPLAY?.showDerivedSatelliteInfo ?? false,
  );
  const [brightEarth, setBrightEarth] = useState(SAVED_DISPLAY?.brightEarth ?? false);
  const [whiteBackground, setWhiteBackground] = useState(SAVED_DISPLAY?.whiteBackground ?? false);
  const [showGroundStationCones, setShowGroundStationCones] = useState(
    SAVED_DISPLAY?.showGroundStationCones ?? false,
  );
  const [showSatelliteFovCones, setShowSatelliteFovCones] = useState(
    SAVED_DISPLAY?.showSatelliteFovCones ?? false,
  );
  const [groundConeMinElevationDeg, setGroundConeMinElevationDeg] = useState(
    SAVED_DISPLAY?.groundConeMinElevationDeg ?? 30,
  );
  const [groundConeDistanceKm, setGroundConeDistanceKm] = useState(
    SAVED_DISPLAY?.groundConeDistanceKm ?? 1000,
  );
  const [groundConeColor, setGroundConeColor] = useState(SAVED_DISPLAY?.groundConeColor ?? "#3ec7a1");
  const [fovConeHalfAngleDeg, setFovConeHalfAngleDeg] = useState(
    SAVED_DISPLAY?.fovConeHalfAngleDeg ?? 30,
  );
  const [fovConeColor, setFovConeColor] = useState(SAVED_DISPLAY?.fovConeColor ?? "#3388ff");
  const fovConeMinHeight = 0.02;
  const [fovConeAlongTrackDeg, setFovConeAlongTrackDeg] = useState(
    SAVED_DISPLAY?.fovConeAlongTrackDeg ?? 0,
  );
  const [fovConeCrossTrackDeg, setFovConeCrossTrackDeg] = useState(
    SAVED_DISPLAY?.fovConeCrossTrackDeg ?? 0,
  );
  const [satelliteVisibleColor, setSatelliteVisibleColor] = useState(
    SAVED_DISPLAY?.satelliteVisibleColor ?? "#00ff00",
  );
  const [satelliteHiddenColor, setSatelliteHiddenColor] = useState(
    SAVED_DISPLAY?.satelliteHiddenColor ?? "#ff0000",
  );
  const [satelliteSelectedColor, setSatelliteSelectedColor] = useState(
    SAVED_DISPLAY?.satelliteSelectedColor ?? "#00ffff",
  );
  const [islSettings, setIslSettings] = useState<IslSettings>(
    SAVED_DISPLAY?.isl ?? createDefaultIslSettings(),
  );
  const [islResult, setIslResult] = useState<IslPathResult | null>(null);
  const [islSwitchCount, setIslSwitchCount] = useState(0);
  const [islLastSwitchSimMs, setIslLastSwitchSimMs] = useState<number | null>(null);
  const [islGslColor, setIslGslColor] = useState(SAVED_DISPLAY?.islGslColor ?? "#ff33cc");
  const [islIslColor, setIslIslColor] = useState(SAVED_DISPLAY?.islIslColor ?? "#33e0ff");

  // Track cumulative path switches and time-since-last-switch for the ISL result
  // card (§2.5.2, Phase 2). switchedFromPrevious is only meaningful once a path
  // has actually been established, so the very first reachable result is not
  // counted as a switch.
  const handleIslResult = useCallback((result: IslPathResult | null) => {
    setIslResult(result);
    if (!result) {
      setIslSwitchCount(0);
      setIslLastSwitchSimMs(null);
      return;
    }
    if (!result.reachable) return;
    if (result.switchedFromPrevious) {
      setIslSwitchCount((c) => c + 1);
      setIslLastSwitchSimMs(result.computedAtSimMs);
    } else {
      setIslLastSwitchSimMs((prev) => prev ?? result.computedAtSimMs);
    }
  }, []);

  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });

  // speed exponent slider (0–2 → 1×–100×)
  const [speedExp, setSpeedExp] = useState(
    SAVED_DISPLAY?.speedExp ?? Math.log10(INITIAL_SPEED),
  );
  const speedRef = useRef(Math.pow(10, SAVED_DISPLAY?.speedExp ?? Math.log10(INITIAL_SPEED)));
  const [isPaused, setIsPaused] = useState(false);
  const savedSpeedRef = useRef(INITIAL_SPEED);
  
  useEffect(() => {
    speedRef.current = isPaused ? 0 : Math.pow(10, speedExp);
  }, [speedExp, isPaused]);

  useEffect(() => {
    loadGroundStations().then(setGroundStations);
  }, []);

  // Latest camera framing, seeded from the saved view. Kept in a ref so it can
  // be applied on every scene (re)build without triggering rebuilds itself.
  const cameraSnapshotRef = useRef<CameraSnapshot | null>(SAVED_VIEW?.camera ?? null);

  // Current display settings, assembled fresh each render so the persistence
  // effect and named-view saving always see the latest values.
  const currentDisplay: DisplaySettings = {
    satRadius,
    earthTexture,
    showGraticule,
    showEcliptic,
    showGeoOrbit,
    showSunDirection,
    ecef,
    showPerturbation,
    showDerivedSatelliteInfo,
    brightEarth,
    whiteBackground,
    showGroundStationCones,
    showSatelliteFovCones,
    groundConeMinElevationDeg,
    groundConeDistanceKm,
    groundConeColor,
    fovConeHalfAngleDeg,
    fovConeColor,
    fovConeAlongTrackDeg,
    fovConeCrossTrackDeg,
    satelliteVisibleColor,
    satelliteHiddenColor,
    satelliteSelectedColor,
    speedExp,
    isl: islSettings,
    islGslColor,
    islIslColor,
  };
  // Mirror into a ref so the (stable) camera callback can read it without
  // being recreated on every settings change.
  const displayRef = useRef(currentDisplay);
  displayRef.current = currentDisplay;

  // A neutral camera snapshot used only until the scene reports its first one.
  const fallbackCamera: CameraSnapshot = {
    mode: cameraMode,
    position: [0, 0, 3],
    target: [0, 0, 0],
    earthCenterDistance: 0.45,
    thirdPersonDistance: 0.4,
    thirdPersonPitch: (22 * Math.PI) / 180,
  };

  // Persist the latest view whenever a display setting changes.
  useEffect(() => {
    saveLastView(
      buildViewSettings(displayRef.current, cameraSnapshotRef.current ?? fallbackCamera),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    satRadius,
    earthTexture,
    showGraticule,
    showEcliptic,
    showGeoOrbit,
    showSunDirection,
    ecef,
    showPerturbation,
    showDerivedSatelliteInfo,
    brightEarth,
    whiteBackground,
    showGroundStationCones,
    showSatelliteFovCones,
    groundConeMinElevationDeg,
    groundConeDistanceKm,
    groundConeColor,
    fovConeHalfAngleDeg,
    fovConeColor,
    fovConeAlongTrackDeg,
    fovConeCrossTrackDeg,
    satelliteVisibleColor,
    satelliteHiddenColor,
    satelliteSelectedColor,
    speedExp,
    islSettings,
    islGslColor,
    islIslColor,
  ]);

  // Stable handler: scene reports its framing on drag/zoom-end and mode changes.
  const handleCameraChange = useCallback((snap: CameraSnapshot) => {
    cameraSnapshotRef.current = snap;
    saveLastView(buildViewSettings(displayRef.current, snap));
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
    showGeoOrbit,
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
    onCameraChange: handleCameraChange,
    islSettings,
    onIslResult: handleIslResult,
    islGslColor,
    islIslColor,
  }, { cameraSnapshotRef });

  // Apply a saved named view: restore all display settings, camera mode and
  // framing. Display changes rebuild the scene, which re-applies the camera via
  // cameraSnapshotRef; applyCameraSnapshot also runs immediately for snappiness.
  const applyView = useCallback(
    (settings: ViewSettings) => {
      const d = settings.display;
      setSatRadius(d.satRadius);
      setEarthTexture(d.earthTexture);
      setShowGraticule(d.showGraticule);
      setShowEcliptic(d.showEcliptic);
      setShowGeoOrbit(d.showGeoOrbit ?? false);
      setShowSunDirection(d.showSunDirection);
      setEcef(d.ecef);
      setShowPerturbation(d.showPerturbation);
      setShowDerivedSatelliteInfo(d.showDerivedSatelliteInfo);
      setBrightEarth(d.brightEarth);
      setWhiteBackground(d.whiteBackground);
      setShowGroundStationCones(d.showGroundStationCones);
      setShowSatelliteFovCones(d.showSatelliteFovCones);
      setGroundConeMinElevationDeg(d.groundConeMinElevationDeg);
      setGroundConeDistanceKm(d.groundConeDistanceKm);
      setGroundConeColor(d.groundConeColor);
      setFovConeHalfAngleDeg(d.fovConeHalfAngleDeg);
      setFovConeColor(d.fovConeColor);
      setFovConeAlongTrackDeg(d.fovConeAlongTrackDeg);
      setFovConeCrossTrackDeg(d.fovConeCrossTrackDeg);
      setSatelliteVisibleColor(d.satelliteVisibleColor);
      setSatelliteHiddenColor(d.satelliteHiddenColor);
      setSatelliteSelectedColor(d.satelliteSelectedColor);
      setSpeedExp(d.speedExp);
      setIslSettings(d.isl ?? createDefaultIslSettings());
      setIslGslColor(d.islGslColor ?? "#ff33cc");
      setIslIslColor(d.islIslColor ?? "#33e0ff");
      setCameraMode(settings.camera.mode);
      cameraSnapshotRef.current = settings.camera;
      sceneRef.current?.applyCameraSnapshot(settings.camera);
      saveLastView(settings);
    },
    [sceneRef],
  );

  // Snapshot the live view (current display + latest camera framing) on demand,
  // e.g. when the user clicks "save view".
  const getCurrentView = useCallback(
    (): ViewSettings =>
      buildViewSettings(
        displayRef.current,
        sceneRef.current?.getCameraSnapshot() ??
          cameraSnapshotRef.current ?? {
            mode: "free",
            position: [0, 0, 3],
            target: [0, 0, 0],
            earthCenterDistance: 0.45,
            thirdPersonDistance: 0.4,
            thirdPersonPitch: (22 * Math.PI) / 180,
          },
      ),
    [sceneRef],
  );

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
        showGeoOrbit={showGeoOrbit}
        onShowGeoOrbitChange={setShowGeoOrbit}
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
        getCurrentView={getCurrentView}
        onApplyView={applyView}
        islSettings={islSettings}
        onIslSettingsChange={setIslSettings}
        islResult={islResult}
        islSwitchCount={islSwitchCount}
        islLastSwitchSimMs={islLastSwitchSimMs}
        currentSimMs={simTime.getTime()}
        islGslColor={islGslColor}
        onIslGslColorChange={setIslGslColor}
        islIslColor={islIslColor}
        onIslIslColorChange={setIslIslColor}
      />
    </div>
  );
}

export default App;
