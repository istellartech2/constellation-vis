import { useEffect, useRef, type RefObject } from "react";
import SatelliteScene, { type SatelliteSceneParams } from "../lib/visualization";
import type { CameraSnapshot } from "../lib/viewState";

// Re-export the parameter type for convenience
export type { SatelliteSceneParams } from "../lib/visualization";

interface UseSatelliteSceneOptions {
  /**
   * Camera framing to apply right after the scene is (re)built. Kept in a ref
   * so it does not appear in the rebuild dependency list; it is read on every
   * construction so the camera survives both reloads and setting-driven
   * scene rebuilds.
   */
  cameraSnapshotRef?: RefObject<CameraSnapshot | null>;
}

/**
 * React hook creating and managing the underlying Three.js scene. The heavy
 * lifting lives in {@link SatelliteScene}. This hook instantiates the scene,
 * rebuilds it only for structural parameter changes, applies everything else
 * live (including swapping the catalog-layer overlay), and disposes it on
 * unmount.
 */
export function useSatelliteScene(
  params: SatelliteSceneParams,
  options: UseSatelliteSceneOptions = {},
) {
  const sceneRef = useRef<SatelliteScene | null>(null);
  const { cameraSnapshotRef } = options;
  const previousDomain = useRef<Pick<SatelliteSceneParams, "startTime" | "satellites" | "groundStations"> | null>(null);
  const preservedTime = useRef<Date | null>(null);
  // Latest params, for the deferred construction below: live-only params
  // (catalog, styles, colours…) may change during the 10 ms delay, while any
  // structural change cancels the pending construction and schedules another.
  const latestParams = useRef(params);
  useEffect(() => {
    latestParams.current = params;
  });

  useEffect(() => {
    sceneRef.current?.setCameraMode(params.cameraMode);
  }, [params.cameraMode]);

  useEffect(() => {
    if (!params.mountRef.current) return;

    // Use a small delay to ensure proper cleanup timing
    let scene: SatelliteScene | null = null;
    const timeout = setTimeout(() => {
      const current = latestParams.current;
      const previous = previousDomain.current;
      const sameDomain = previous?.startTime === current.startTime
        && previous.satellites === current.satellites && previous.groundStations === current.groundStations;
      scene = new SatelliteScene(sameDomain && preservedTime.current ? { ...current, startTime: preservedTime.current } : current);
      previousDomain.current = { startTime: current.startTime, satellites: current.satellites, groundStations: current.groundStations };
      sceneRef.current = scene;
      // Restore the saved camera framing on (re)build so reloads and
      // setting-driven rebuilds keep the user's viewpoint.
      const snap = cameraSnapshotRef?.current;
      if (snap) scene.applyCameraSnapshot(snap);
      // No saved framing yet: report the scene's own default (fitted to the
      // screen) so the placeholder camera in App is never persisted.
      else current.onCameraChange?.(scene.getCameraSnapshot());
    }, 10);
    
    return () => {
      clearTimeout(timeout);
      if (scene) {
        preservedTime.current = scene.getSimulationTime();
        scene.dispose();
        sceneRef.current = null;
      }
    };
    // Only STRUCTURAL params force a full rebuild (different object counts,
    // texture reloads, or lighting/background baked at construction). All other
    // display settings are applied live via updateParams below — rebuilding for
    // them caused toggles to intermittently appear not to take effect while a
    // previous rebuild was still in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.mountRef,
    params.timeRef,
    params.speedRef,
    params.startTime,
    params.satellites,
    params.groundStations,
    params.earthTexture,
    params.brightEarth,
    params.whiteBackground,
    params.onSelect,
    params.onSelectStation,
    params.onSimTimeChange,
    params.stationInfoRef,
  ]);

  // Apply non-structural settings live to the existing scene, no rebuild.
  useEffect(() => {
    sceneRef.current?.updateParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.satRadius,
    params.pointStyle,
    params.showCountryBorders,
    params.showClouds,
    params.showGraticule,
    params.showEcliptic,
    params.showGeoOrbit,
    params.showSunDirection,
    params.showGroundStationCones,
    params.showSatelliteFovCones,
    params.groundConeMinElevationDeg,
    params.groundConeLength,
    params.groundConeColor,
    params.fovConeHalfAngleDeg,
    params.fovConeColor,
    params.fovConeAlongTrackDeg,
    params.fovConeCrossTrackDeg,
    params.satelliteVisibleColor,
    params.satelliteHiddenColor,
    params.satelliteSelectedColor,
    params.ecef,
    params.islSettings,
    params.islShellRanges,
    params.catalogStyles,
    params.layerColorMode,
  ]);

  // Swap the catalog-layer overlay live (after updateParams above, so the new
  // overlay picks up the current styles). Skipped while the scene is being
  // (re)built: construction reads the latest catalog itself, and setCatalog
  // is a no-op for the catalog the scene already holds.
  useEffect(() => {
    sceneRef.current?.setCatalog(params.catalog ?? null);
  }, [params.catalog]);

  return sceneRef;
}
