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
 * lifting lives in {@link SatelliteScene}. This hook simply instantiates the
 * scene and disposes it when parameters change or the component unmounts.
 */
export function useSatelliteScene(
  params: SatelliteSceneParams,
  options: UseSatelliteSceneOptions = {},
) {
  const sceneRef = useRef<SatelliteScene | null>(null);
  const { cameraSnapshotRef } = options;

  useEffect(() => {
    sceneRef.current?.setCameraMode(params.cameraMode);
  }, [params.cameraMode]);

  useEffect(() => {
    if (!params.mountRef.current) return;

    // Use a small delay to ensure proper cleanup timing
    let scene: SatelliteScene | null = null;
    const timeout = setTimeout(() => {
      scene = new SatelliteScene(params);
      sceneRef.current = scene;
      // Restore the saved camera framing on (re)build so reloads and
      // setting-driven rebuilds keep the user's viewpoint.
      const snap = cameraSnapshotRef?.current;
      if (snap) scene.applyCameraSnapshot(snap);
    }, 10);
    
    return () => {
      clearTimeout(timeout);
      if (scene) {
        scene.dispose();
        sceneRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.mountRef,
    params.timeRef,
    params.speedRef,
    params.startTime,
    params.satellites,
    params.groundStations,
    params.satRadius,
    params.earthTexture,
    params.showGraticule,
    params.showEcliptic,
    params.showSunDirection,
    params.showGroundStationCones,
    params.showSatelliteFovCones,
    params.groundConeMinElevationDeg,
    params.groundConeLength,
    params.groundConeColor,
    params.fovConeHalfAngleDeg,
    params.fovConeColor,
    params.fovConeMinHeight,
    params.fovConeAlongTrackDeg,
    params.fovConeCrossTrackDeg,
    params.satelliteVisibleColor,
    params.satelliteHiddenColor,
    params.satelliteSelectedColor,
    params.ecef,
    params.brightEarth,
    params.whiteBackground,
    params.onSelect,
    params.onSelectStation,
    params.onSimTimeChange,
    params.stationInfoRef,
  ]);
  
  return sceneRef;
}
