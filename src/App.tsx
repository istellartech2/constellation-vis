import type { RemoteDisplaySettings } from "./lib/remoteDisplay";
import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import PlaybackBar from "./components/ui/PlaybackBar";
import SatelliteEditor, { type OpenTabRequest } from "./components/ui/SatelliteEditor";
import IslHud from "./components/ui/IslHud";
import { useSatelliteScene } from "./components/useSatelliteScene";
import { SATELLITES as INITIAL_SATS, INITIAL_SHELL_RANGES } from "./lib/satellites";
import { loadGroundStations, type GroundStation } from "./lib/groundStations";
import SatelliteInfo from "./components/ui/SatelliteInfo";
import { layerIndexOfRow, type LayerColorMode } from "./lib/catalogLayers";
import { useCatalogLayers } from "./lib/useCatalogLayers";
import { isMassMode } from "./lib/massSatelliteLayer";
import { formatGroundStationInfo } from "./lib/formatGroundStationInfo";
import { type SatelliteCameraMode } from "./lib/visualization";
import { reconcileAttitudeStation } from "./lib/attitude/satelliteAttitude";
import type { TrajectoryTrack } from "./lib/trajectory/types";
import type { TrajectoryPlayback } from "./components/ui/TrajectorySection";
import TourPlayer from "./components/tour/TourPlayer";
import { useGuidedTour } from "./components/tour/useGuidedTour";
import { loadDemoIndex } from "./lib/tour/load";
import { demoIdFromSearch } from "./lib/tour/parse";
import type { DemoEntry } from "./lib/tour/types";
import {
  loadLastView,
  saveLastView,
  buildViewSettings,
  displayOptionsFromSaved,
  mergeDisplayOptions,
  toDisplaySettings,
  type CameraSnapshot,
  type DisplayOptions,
  type ViewSettings,
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

  const [display, setDisplay] = useState<DisplayOptions>(() =>
    displayOptionsFromSaved(SAVED_DISPLAY, window.innerWidth <= 600 ? 0.02 : 0.015),
  );
  const updateDisplay = useCallback(
    (patch: Partial<DisplayOptions>) => setDisplay((prev) => ({ ...prev, ...patch })),
    [],
  );
  const fovConeMinHeight = 0.02;
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
  // External "open the panel on this tab" request (e.g. clicking the ISL HUD
  // card), optionally scrolled to a section anchor or opening an analysis.
  const [openTabRequest, setOpenTabRequest] = useState<OpenTabRequest | null>(null);
  const requestTab = useCallback(
    (request: Omit<OpenTabRequest, "nonce">) => setOpenTabRequest((p) => ({ ...request, nonce: (p?.nonce ?? 0) + 1 })),
    [],
  );

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
  // Guided tour speed override (× real time, may exceed the playback bar's
  // range); never persisted. Null outside a tour.
  const [tourSpeed, setTourSpeed] = useState<number | null>(null);
  // True while a guided tour is loading or running: the view is not persisted.
  const tourActiveRef = useRef(false);

  useEffect(() => {
    speedRef.current = isPaused || userPaused ? 0 : (tourSpeed ?? Math.pow(10, speedExp));
  }, [speedExp, isPaused, userPaused, tourSpeed]);
  // A tour chapter seeks and changes speed in the same step: write the new
  // speed straight into speedRef so the first frames after the seek do not
  // run at the previous chapter's speed (e.g. 3000×) and overshoot.
  const applyTourSpeed = useCallback(
    (speed: number | null) => {
      setTourSpeed(speed);
      if (!(isPaused || userPaused)) speedRef.current = speed ?? Math.pow(10, speedExp);
    },
    [isPaused, userPaused, speedExp],
  );

  // Keep the 地上局指向 station reference in step with a new station list
  // (like reconcileIslEndpoints): called wherever the stations are replaced.
  const reconcileAttitude = useCallback((stations: readonly GroundStation[]) => {
    setDisplay((prev) => {
      const next = reconcileAttitudeStation(prev.satelliteAttitude, stations);
      return next === prev.satelliteAttitude ? prev : { ...prev, satelliteAttitude: next };
    });
  }, []);

  // The initial station list has arrived (its scene rebuild resets the clock,
  // so a ?demo= tour waits for it).
  const [stationsReady, setStationsReady] = useState(false);
  useEffect(() => {
    loadGroundStations().then((stations) => {
      setStationsReady(true);
      if (scenarioCommittedRef.current) return;
      setGroundStations(stations);
      reconcileAttitude(stations);
    });
  }, [reconcileAttitude]);

  // Latest camera framing, seeded from the saved view. Kept in a ref so it can
  // be applied on every scene (re)build without triggering rebuilds itself.
  const cameraSnapshotRef = useRef<CameraSnapshot | null>(SAVED_VIEW?.camera ?? null);

  // Current display settings, assembled fresh each render so the persistence
  // effect and named-view saving always see the latest values.
  const currentDisplay = toDisplaySettings(display, speedExp, islSettings);
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
    if (tourActiveRef.current) return;
    saveLastView(
      buildViewSettings(displayRef.current, cameraSnapshotRef.current ?? fallbackCamera),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, speedExp, islSettings]);

  // Stable handler: scene reports its framing on drag/zoom-end and mode changes.
  const handleCameraChange = useCallback((snap: CameraSnapshot) => {
    // A tour's framings are not the user's view; 終了 restores the one from before.
    if (tourActiveRef.current) return;
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
  // Tabulated trajectory tracks (e.g. a launch's booster and ship). Display
  // only; swapped live into the scene without a rebuild.
  const [trajectories, setTrajectories] = useState<TrajectoryTrack[]>([]);
  // Track the camera rides with (trajectory follow), or null. The scene
  // clears it via onTrajectoryFollowEnd when it drops the follow itself.
  const [trajectoryFollowId, setTrajectoryFollowId] = useState<string | null>(null);
  const handleTrajectoryFollowEnd = useCallback(() => setTrajectoryFollowId(null), []);
  // The scene left 近接 on its own (no selected editor satellite after a rebuild…).
  const handleCloseUpEnd = useCallback(() => setCameraMode((m) => (m === "closeUp" ? "free" : m)), []);
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

  const groundConeLength = Math.max(display.groundConeDistanceKm, 100) / EARTH_RADIUS_KM;

  const sceneRef = useSatelliteScene({
    mountRef,
    timeRef,
    speedRef,
    startTime,
    satellites,
    catalog,
    catalogStyles,
    layerColorMode,
    trajectories,
    trajectoryFollowId,
    onTrajectoryFollowEnd: handleTrajectoryFollowEnd,
    onCloseUpEnd: handleCloseUpEnd,
    satelliteAttitude: display.satelliteAttitude,
    solarArrayType: display.solarArrayType,
    showBodyAxes: display.showBodyAxes,
    showBodySunDirection: display.showBodySunDirection,
    groundStations,
    satRadius: display.satRadius,
    pointStyle: display.pointStyle,
    earthTexture: display.earthTexture,
    showCountryBorders: display.showCountryBorders,
    showClouds: display.showClouds,
    showGraticule: display.showGraticule,
    showEcliptic: display.showEcliptic,
    showGeoOrbit: display.showGeoOrbit,
    showSunDirection: display.showSunDirection,
    showGroundStationCones: display.showGroundStationCones,
    showSatelliteFovCones: display.showSatelliteFovCones,
    groundConeLength,
    groundConeColor: display.groundConeColor,
    fovConeHalfAngleDeg: display.fovConeHalfAngleDeg,
    fovConeColor: display.fovConeColor,
    fovConeMinHeight,
    fovConeAlongTrackDeg: display.fovConeAlongTrackDeg,
    fovConeCrossTrackDeg: display.fovConeCrossTrackDeg,
    satelliteVisibleColor: display.satelliteVisibleColor,
    satelliteHiddenColor: display.satelliteHiddenColor,
    satelliteSelectedColor: display.satelliteSelectedColor,
    cameraMode,
    viewFrame: display.viewFrame,
    brightEarth: display.brightEarth,
    whiteBackground: display.whiteBackground,
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
    setDisplay((prev) => mergeDisplayOptions(prev, d));
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
      // While following a trajectory the scene keeps a free view as the
      // framing to return to; ending the follow then restores it.
      sceneRef.current?.applyCameraSnapshot(settings.camera);
      setTrajectoryFollowId(null);
      saveLastView(settings);
    },
    [sceneRef, applyDisplay],
  );

  // Trajectory playback: seeks move the live scene's clock (no rebuild, so
  // the scenario start time in the editor is untouched); following forces the
  // free camera, since the satellite camera modes take precedence.
  const trajectoryPlayback = useMemo<TrajectoryPlayback>(
    () => ({
      followId: trajectoryFollowId,
      onFollowChange: (id) => {
        if (id !== null) setCameraMode("free");
        setTrajectoryFollowId(id);
      },
      onPlayFrom: (id, date) => {
        sceneRef.current?.seekTo(date);
        setCameraMode("free");
        setTrajectoryFollowId(id);
        setSpeedExp(0);
        setUserPaused(false);
      },
      onSeek: (date) => sceneRef.current?.seekTo(date),
    }),
    [trajectoryFollowId, sceneRef],
  );

  // Guided tour (presentation mode): drives tracks, seek, speed and camera,
  // and puts them back on 終了.
  const guidedTour = useGuidedTour({
    sceneRef,
    cameraSnapshotRef,
    trajectories,
    setTrajectories,
    trajectoryFollowId,
    setTrajectoryFollowId,
    cameraMode,
    setCameraMode,
    userPaused,
    setUserPaused,
    setTourSpeed: applyTourSpeed,
  });
  const tourStatus = guidedTour.state.status;
  const presentation = tourStatus !== "idle";
  useLayoutEffect(() => {
    tourActiveRef.current = presentation;
  }, [presentation]);
  const { start: startTour, stop: stopTour } = guidedTour;
  const startDemo = useCallback((demo: DemoEntry) => void startTour(demo.tour), [startTour]);
  const endTour = useCallback(() => {
    stopTour();
    // A tour opened from ?demo= should not restart on reload.
    const url = new URL(window.location.href);
    if (url.searchParams.has("demo")) {
      url.searchParams.delete("demo");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [stopTour]);

  // ?demo=<id>: start that tour once the globe and the station list are up.
  const autoDemoRef = useRef(false);
  const autoDemoDoneRef = useRef(false);
  useEffect(() => {
    if (!stationsReady || autoDemoRef.current || autoDemoDoneRef.current) return;
    const id = demoIdFromSearch(window.location.search);
    if (id === null) return;
    autoDemoRef.current = true;
    let cancelled = false;
    let timer = 0;
    loadDemoIndex(import.meta.env.BASE_URL).then((demos) => {
      const demo = demos.find((d) => d.id === id);
      if (cancelled) return;
      if (!demo) {
        console.warn(`[tour] demo "${id}" is not listed in demos/index.json`);
        return;
      }
      // Give the station-list rebuild (10 ms deferred) time to land first.
      const tryStart = () => {
        if (cancelled) return;
        if (!sceneRef.current) {
          timer = window.setTimeout(tryStart, 100);
          return;
        }
        autoDemoDoneRef.current = true;
        startDemo(demo);
      };
      timer = window.setTimeout(tryStart, 50);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // StrictMode re-runs the effect: allow the second run to start it.
      autoDemoRef.current = false;
    };
  }, [stationsReady, sceneRef, startDemo]);

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
      {!presentation && (filingCount > 0 || visibleLayerCount > 0 || isMassMode(satellites.length)) && (
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
      <div className={presentation ? "hidden" : "contents"}>
      <SatelliteInfo
        satellites={satellites}
        catalog={catalog}
        layerNameAt={(row) => catalogLayers[layerIndexOfRow(catalogStyles, row)]?.name}
        selectedIdx={selectedIdx}
        simTime={simTime}
        showPerturbation={display.showPerturbation}
        onShowPerturbationChange={(v) => updateDisplay({ showPerturbation: v })}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onClose={() => handleSelectSatellite(null)}
        satelliteAttitude={display.satelliteAttitude}
        solarArrayType={display.solarArrayType}
        groundStations={groundStations}
        fovAlongTrackDeg={display.fovConeAlongTrackDeg}
        fovCrossTrackDeg={display.fovConeCrossTrackDeg}
        onOpenAttitudeSettings={() => requestTab({ tab: "isl", anchor: "comm-attitude" })}
        onOpenPowerAnalysis={() => requestTab({ tab: "analysis", analysis: "日照・電力成立性評価" })}
      />
      </div>
      {gsInfoText && !presentation && (
        <pre
          ref={gsInfoRef}
          className={`hud-text${display.whiteBackground ? " hud-text-on-white" : ""}`}
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
        hidden={presentation}
      />
      {!presentation && <IslHud
        islSettings={islSettings}
        islResult={islResult}
        islSwitchCount={islSwitchCount}
        onClick={() => requestTab({ tab: "isl" })}
      />}
      <SatelliteEditor
        display={display}
        onDisplayChange={updateDisplay}
        fovConeMinHeight={fovConeMinHeight}
        groundStations={groundStations}
        sceneRef={sceneRef}
        selectedSatelliteIndex={selectedIdx !== null && selectedIdx < satellites.length ? selectedIdx : null}
        onUpdate={(scenario) => {
          scenarioCommittedRef.current = true;
          setSelectedIdx(null);
          // The selection is gone, so 近接 ends (the rebuilt scene would drop it too).
          setCameraMode((m) => (m === "closeUp" ? "free" : m));
          setSelectedGsIdx(null);
          setSatellites(scenario.satellites);
          setGroundStations(scenario.groundStations);
          setStartTime(scenario.startTime);
          setIslShellRanges(scenario.islShellRanges);
          // 地点 A/B の地上局参照を新しい局リストへ整合(同名局は座標を最新化、
          // 消えた局は未設定へ初期化)。過去の局が endpoint に残る不整合を防ぐ
          setIslSettings((prev) => reconcileIslEndpoints(prev, scenario.groundStations));
          reconcileAttitude(scenario.groundStations);
        }}
        onAnalysisStart={handleAnalysisStart}
        onAnalysisEnd={handleAnalysisEnd}
        onPausePlayback={() => setUserPaused(true)}
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
        trajectories={trajectories}
        onTrajectoriesChange={setTrajectories}
        trajectoryPlayback={trajectoryPlayback}
        onStartDemo={startDemo}
        presentation={presentation}
      />
      <TourPlayer
        state={guidedTour.state}
        sceneRef={sceneRef}
        paused={userPaused}
        speed={tourSpeed}
        onTogglePause={guidedTour.togglePause}
        onGoTo={guidedTour.goTo}
        onStop={endTour}
      />
    </div>
  );
}

export default App;
