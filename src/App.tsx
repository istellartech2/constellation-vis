import type { RemoteDisplaySettings } from "./lib/remoteDisplay";
import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import PlaybackBar from "./components/ui/PlaybackBar";
import SatelliteEditor from "./components/ui/SatelliteEditor";
import IslHud from "./components/ui/IslHud";
import { useSatelliteScene } from "./components/useSatelliteScene";
import { SATELLITES as INITIAL_SATS, INITIAL_SHELL_RANGES } from "./lib/satellites";
import { loadGroundStations, type GroundStation } from "./lib/groundStations";
import SatelliteInfo from "./components/ui/SatelliteInfo";
import { layerIndexOfRow, type LayerColorMode } from "./lib/catalogLayers";
import { useCatalogLayers } from "./lib/useCatalogLayers";
import { isMassMode } from "./lib/massSatelliteLayer";
import { formatGroundStationInfo } from "./lib/formatGroundStationInfo";
import { DEFAULT_EARTH_MODE, isMonochromeEarthMode, type EarthTextureMode } from "./lib/earthTextures";
import { type SatelliteCameraMode } from "./lib/visualization";
import { DEFAULT_POINT_STYLE, type SatellitePointStyle } from "./lib/satellitePointStyle";
import {
  loadLastView,
  saveLastView,
  buildViewSettings,
  nextViewFrame,
  type CameraSnapshot,
  type DisplaySettings,
  type ViewSettings,
  type ViewFrame,
} from "./lib/viewState";
import {
  createDefaultIslSettings,
  reconcileIslEndpoints,
  type IslPathResult,
  type IslSettings,
  type IslShellRange,
} from "./lib/isl/types";

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

  const scenarioCommittedRef = useRef(false);
  const [satellites, setSatellites] = useState(INITIAL_SATS);
  const [groundStations, setGroundStations] = useState<GroundStation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedGsIdx, setSelectedGsIdx] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<SatelliteCameraMode>(
    SAVED_VIEW?.camera.mode ?? "free",
  );
  const [simTime, setSimTime] = useState(() => new Date());

  const [pointStyle, setPointStyle] = useState<SatellitePointStyle>(() => ({
    pixelSize: SAVED_DISPLAY?.satPixelSize ?? DEFAULT_POINT_STYLE.pixelSize,
    sunlitShading: SAVED_DISPLAY?.satSunlitShading ?? DEFAULT_POINT_STYLE.sunlitShading,
    glint: SAVED_DISPLAY?.satGlint ?? DEFAULT_POINT_STYLE.glint,
  }));
  const [satRadius, setSatRadius] = useState(
    () => SAVED_DISPLAY?.satRadius ?? (window.innerWidth <= 600 ? 0.02 : 0.015),
  );

  const [earthTexture, setEarthTexture] = useState<EarthTextureMode>(
    SAVED_DISPLAY?.earthTexture ?? DEFAULT_EARTH_MODE,
  );
  // Monochrome globes have always drawn borders and photo globes have not;
  // keep that look for views saved before borders became a setting.
  const [showCountryBorders, setShowCountryBorders] = useState(
    SAVED_DISPLAY?.showCountryBorders ??
      isMonochromeEarthMode(SAVED_DISPLAY?.earthTexture ?? DEFAULT_EARTH_MODE),
  );
  const [showClouds, setShowClouds] = useState(SAVED_DISPLAY?.showClouds ?? false);
  const [showGraticule, setShowGraticule] = useState(SAVED_DISPLAY?.showGraticule ?? true);
  const [showEcliptic, setShowEcliptic] = useState(SAVED_DISPLAY?.showEcliptic ?? true);
  const [showGeoOrbit, setShowGeoOrbit] = useState(SAVED_DISPLAY?.showGeoOrbit ?? false);
  const [showSunDirection, setShowSunDirection] = useState(SAVED_DISPLAY?.showSunDirection ?? true);
  const [viewFrame, setViewFrame] = useState<ViewFrame>(() => nextViewFrame("eci", SAVED_DISPLAY ?? {}));
  const [showPerturbation, setShowPerturbation] = useState(SAVED_DISPLAY?.showPerturbation ?? false);
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
  const [islError, setIslError] = useState<string | null>(null);
  // Derived from the same [...base, ...shells] array as `satellites`, computed
  // at the same moment (Update click) — never a stale localStorage snapshot.
  // Not part of DisplaySettings: it's not persisted.
  const [islShellRanges, setIslShellRanges] = useState<IslShellRange[]>(INITIAL_SHELL_RANGES);
  // External "open the panel on this tab" request (e.g. clicking the ISL HUD card)
  const [openTabRequest, setOpenTabRequest] = useState<{
    tab: "editor" | "analysis" | "isl" | "option";
    nonce: number;
  } | null>(null);

  // Track cumulative path switches and time-since-last-switch for the ISL result
  // card. switchedFromPrevious is only meaningful once a path
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
  // isPaused: forced pause while an analysis runs; userPaused: play/pause button.
  const [isPaused, setIsPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const savedSpeedRef = useRef(INITIAL_SPEED);

  useEffect(() => {
    speedRef.current = isPaused || userPaused ? 0 : Math.pow(10, speedExp);
  }, [speedExp, isPaused, userPaused]);

  useEffect(() => {
    loadGroundStations().then((stations) => { if (!scenarioCommittedRef.current) setGroundStations(stations); });
  }, []);

  // Latest camera framing, seeded from the saved view. Kept in a ref so it can
  // be applied on every scene (re)build without triggering rebuilds itself.
  const cameraSnapshotRef = useRef<CameraSnapshot | null>(SAVED_VIEW?.camera ?? null);

  // Current display settings, assembled fresh each render so the persistence
  // effect and named-view saving always see the latest values.
  const currentDisplay: DisplaySettings = {
    satRadius,
    satPixelSize: pointStyle.pixelSize,
    satSunlitShading: pointStyle.sunlitShading,
    satGlint: pointStyle.glint,
    earthTexture,
    showCountryBorders,
    showClouds,
    showGraticule,
    showEcliptic,
    showGeoOrbit,
    showSunDirection,
    ecef: viewFrame === "ecef",
    gse: viewFrame === "gse",
    showPerturbation,
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
  };
  // Mirror into a ref so the (stable) camera callback can read it without
  // being recreated on every settings change.
  const displayRef = useRef(currentDisplay);
  useLayoutEffect(() => { displayRef.current = currentDisplay; });

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
    pointStyle,
    earthTexture,
    showCountryBorders,
    showClouds,
    showGraticule,
    showEcliptic,
    showGeoOrbit,
    showSunDirection,
    viewFrame,
    showPerturbation,
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

  // Layer rows follow the editor satellites, so a selected layer row may point
  // elsewhere once layers are added or removed; editor selections stay.
  const editorCount = satellites.length;
  const dropLayerSelection = useCallback(() => {
    setSelectedIdx((idx) => (idx !== null && idx >= editorCount ? null : idx));
  }, [editorCount]);
  const {
    layers: catalogLayers,
    catalog,
    styles: catalogStyles,
    add: handleCatalogLayerAdd,
    change: handleCatalogLayerChange,
    remove: handleCatalogLayerRemove,
  } = useCatalogLayers(dropLayerSelection);
  const [layerColorMode, setLayerColorMode] = useState<LayerColorMode>("layer");
  const visibleLayerCount = catalogLayers.reduce((sum, l) => sum + (l.visible ? l.catalog.count : 0), 0);
  const filingCount = useMemo(
    () => satellites.filter(s => s.meta?.dataStatus === "filing").length
      + catalogLayers.reduce((sum, l) => sum + (l.kind === "filing" && l.visible ? l.catalog.count : 0), 0),
    [satellites, catalogLayers],
  );

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
    catalog,
    catalogStyles,
    layerColorMode,
    groundStations,
    satRadius,
    pointStyle,
    earthTexture,
    showCountryBorders,
    showClouds,
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
    viewFrame,
    brightEarth,
    whiteBackground,
    onSelect: handleSelectSatellite,
    onSelectStation: setSelectedGsIdx,
    onSimTimeChange: setSimTime,
    stationInfoRef: gsInfoRef,
    onCameraChange: handleCameraChange,
    islSettings,
    islShellRanges,
    onIslResult: handleIslResult,
    onIslError: setIslError,
  }, { cameraSnapshotRef });

  const applyDisplay = useCallback((d: RemoteDisplaySettings) => {
    if (d.satRadius !== undefined) setSatRadius(d.satRadius);
    if (d.satPixelSize !== undefined || d.satSunlitShading !== undefined || d.satGlint !== undefined) {
      setPointStyle((prev) => ({
        pixelSize: d.satPixelSize ?? prev.pixelSize,
        sunlitShading: d.satSunlitShading ?? prev.sunlitShading,
        glint: d.satGlint ?? prev.glint,
      }));
    }
    if (d.earthTexture !== undefined) setEarthTexture(d.earthTexture);
    if (d.showCountryBorders !== undefined) setShowCountryBorders(d.showCountryBorders);
    if (d.showClouds !== undefined) setShowClouds(d.showClouds);
    if (d.showGraticule !== undefined) setShowGraticule(d.showGraticule);
    if (d.showEcliptic !== undefined) setShowEcliptic(d.showEcliptic);
    if (d.showGeoOrbit !== undefined) setShowGeoOrbit(d.showGeoOrbit);
    if (d.showSunDirection !== undefined) setShowSunDirection(d.showSunDirection);
    if (d.ecef !== undefined || d.gse !== undefined) setViewFrame((prev) => nextViewFrame(prev, d));
    if (d.showPerturbation !== undefined) setShowPerturbation(d.showPerturbation);
    if (d.brightEarth !== undefined) setBrightEarth(d.brightEarth);
    if (d.whiteBackground !== undefined) setWhiteBackground(d.whiteBackground);
    if (d.showGroundStationCones !== undefined) setShowGroundStationCones(d.showGroundStationCones);
    if (d.showSatelliteFovCones !== undefined) setShowSatelliteFovCones(d.showSatelliteFovCones);
    if (d.groundConeMinElevationDeg !== undefined) setGroundConeMinElevationDeg(d.groundConeMinElevationDeg);
    if (d.groundConeDistanceKm !== undefined) setGroundConeDistanceKm(d.groundConeDistanceKm);
    if (d.groundConeColor !== undefined) setGroundConeColor(d.groundConeColor);
    if (d.fovConeHalfAngleDeg !== undefined) setFovConeHalfAngleDeg(d.fovConeHalfAngleDeg);
    if (d.fovConeColor !== undefined) setFovConeColor(d.fovConeColor);
    if (d.fovConeAlongTrackDeg !== undefined) setFovConeAlongTrackDeg(d.fovConeAlongTrackDeg);
    if (d.fovConeCrossTrackDeg !== undefined) setFovConeCrossTrackDeg(d.fovConeCrossTrackDeg);
    if (d.satelliteVisibleColor !== undefined) setSatelliteVisibleColor(d.satelliteVisibleColor);
    if (d.satelliteHiddenColor !== undefined) setSatelliteHiddenColor(d.satelliteHiddenColor);
    if (d.satelliteSelectedColor !== undefined) setSatelliteSelectedColor(d.satelliteSelectedColor);
    if (d.speedExp !== undefined) setSpeedExp(d.speedExp);
  }, []);

  // Apply a saved named view: restore all display settings, camera mode and
  // framing. Display changes rebuild the scene, which re-applies the camera via
  // cameraSnapshotRef; applyCameraSnapshot also runs immediately for snappiness.
  const applyView = useCallback(
    (settings: ViewSettings) => {
      const d = settings.display;
      applyDisplay(d);
      setIslSettings(d.isl ?? createDefaultIslSettings());
      setCameraMode(settings.camera.mode);
      cameraSnapshotRef.current = settings.camera;
      sceneRef.current?.applyCameraSnapshot(settings.camera);
      saveLastView(settings);
    },
    [sceneRef, applyDisplay],
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
      {(filingCount > 0 || visibleLayerCount > 0 || isMassMode(satellites.length)) && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[75vw] -translate-x-1/2 flex-col items-center gap-1">
          {filingCount > 0 && (
            <div className="glass flex items-center gap-2 rounded-full px-3 py-1 text-xs text-fg" role="status" title="実際の衛星位置・配備状況を示しません">
              <span className="size-2.5 shrink-0 rounded-full border-2 border-fg-muted" aria-hidden="true" />
              申請上の仮配置 {filingCount.toLocaleString()}機
              <span className="text-fg-subtle max-sm:hidden">· 実位置ではありません</span>
            </div>
          )}
          {isMassMode(satellites.length) && (
            <div className="glass flex items-center gap-2 rounded-full px-3 py-1 text-xs text-fg" role="status" title="シナリオの全衛星をGPUでJ2永年摂動の解析解により計算しています。リンク線・FOVコーンは一部の衛星に限って表示します。">
              シナリオ {satellites.length.toLocaleString()}機
              <span className="text-fg-subtle max-sm:hidden">· J2近似（GPU）</span>
            </div>
          )}
          {visibleLayerCount > 0 && (
            <div className="glass flex items-center gap-2 rounded-full px-3 py-1 text-xs text-fg" role="status" title="表示レイヤーはGPUでJ2永年摂動の解析解により描画します（表示のみ、解析対象外）。">
              <span className="flex -space-x-1" aria-hidden="true">
                {catalogLayers.filter((l) => l.visible).slice(0, 4).map((l) => <span key={l.id} className="size-2.5 rounded-full border border-surface-solid" style={{ background: l.color }} />)}
              </span>
              表示レイヤー {visibleLayerCount.toLocaleString()}機
              <span className="text-fg-subtle max-sm:hidden">· J2近似（GPU）</span>
            </div>
          )}
        </div>
      )}
      <SatelliteInfo
        satellites={satellites}
        catalog={catalog}
        layerNameAt={(row) => catalogLayers[layerIndexOfRow(catalogStyles, row)]?.name}
        selectedIdx={selectedIdx}
        simTime={simTime}
        showPerturbation={showPerturbation}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onClose={() => handleSelectSatellite(null)}
      />
      {gsInfoText && (
        <pre
          ref={gsInfoRef}
          className={`hud-text${whiteBackground ? " hud-text-on-white" : ""}`}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: "translate(-50%, -100%)",
            fontSize: "0.8rem",
            pointerEvents: "none",
            whiteSpace: "pre",
            zIndex: 10,
          }}
        >
          {gsInfoText}
        </pre>
      )}
      <PlaybackBar
        speedExp={speedExp}
        onSpeedExpChange={setSpeedExp}
        paused={userPaused}
        onPausedChange={setUserPaused}
        timeRef={timeRef}
      />
      <IslHud
        islSettings={islSettings}
        islResult={islResult}
        islSwitchCount={islSwitchCount}
        onClick={() =>
          setOpenTabRequest((p) => ({ tab: "isl", nonce: (p?.nonce ?? 0) + 1 }))
        }
      />
      <SatelliteEditor
        satRadius={satRadius}
        onSatRadiusChange={setSatRadius}
        pointStyle={pointStyle}
        onPointStyleChange={setPointStyle}
        earthTexture={earthTexture}
        onEarthTextureChange={setEarthTexture}
        showCountryBorders={showCountryBorders}
        onShowCountryBordersChange={setShowCountryBorders}
        showClouds={showClouds}
        onShowCloudsChange={setShowClouds}
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
        viewFrame={viewFrame}
        onViewFrameChange={setViewFrame}
        showPerturbation={showPerturbation}
        onShowPerturbationChange={setShowPerturbation}
        brightEarth={brightEarth}
        onBrightEarthChange={setBrightEarth}
        whiteBackground={whiteBackground}
        onWhiteBackgroundChange={setWhiteBackground}
        sceneRef={sceneRef}
        onUpdate={(scenario) => {
          scenarioCommittedRef.current = true;
          setSelectedIdx(null);
          setSelectedGsIdx(null);
          setSatellites(scenario.satellites);
          setGroundStations(scenario.groundStations);
          setStartTime(scenario.startTime);
          setIslShellRanges(scenario.islShellRanges);
          // 地点 A/B の地上局参照を新しい局リストへ整合(同名局は座標を最新化、
          // 消えた局は未設定へ初期化)。過去の局が endpoint に残る不整合を防ぐ
          setIslSettings((prev) => reconcileIslEndpoints(prev, scenario.groundStations));
        }}
        onAnalysisStart={handleAnalysisStart}
        onAnalysisEnd={handleAnalysisEnd}
        getCurrentView={getCurrentView}
        onApplyDisplay={applyDisplay}
        onApplyView={applyView}
        satellites={satellites}
        islSettings={islSettings}
        onIslSettingsChange={setIslSettings}
        islShellRanges={islShellRanges}
        islResult={islResult}
        islError={islError}
        islSwitchCount={islSwitchCount}
        islLastSwitchSimMs={islLastSwitchSimMs}
        currentSimMs={simTime.getTime()}
        openTabRequest={openTabRequest}
        catalogLayers={catalogLayers}
        onCatalogLayerAdd={handleCatalogLayerAdd}
        onCatalogLayerChange={handleCatalogLayerChange}
        onCatalogLayerRemove={handleCatalogLayerRemove}
        layerColorMode={layerColorMode}
        onLayerColorModeChange={setLayerColorMode}
      />
    </div>
  );
}

export default App;
