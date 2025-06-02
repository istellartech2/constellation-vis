import { useEffect } from "react";
import SatelliteScene, { type SatelliteSceneParams } from "../scene/SatelliteScene";

// Re-export the parameter type for convenience
export type { SatelliteSceneParams } from "../scene/SatelliteScene";

/**
 * React hook creating and managing the underlying Three.js scene. The heavy
 * lifting lives in {@link SatelliteScene}. This hook simply instantiates the
 * scene and disposes it when parameters change or the component unmounts.
 */
export function useSatelliteScene(params: SatelliteSceneParams) {
  useEffect(() => {
    if (!params.mountRef.current) return;
    const scene = new SatelliteScene(params);
    return () => scene.dispose();
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
    params.ecef,
    params.onSelect,
    params.onSelectStation,
    params.stationInfoRef,
  ]);
}
