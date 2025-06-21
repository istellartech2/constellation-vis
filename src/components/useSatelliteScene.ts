import { useEffect, useRef } from "react";
import SatelliteScene, { type SatelliteSceneParams } from "../lib/visualization";

// Re-export the parameter type for convenience
export type { SatelliteSceneParams } from "../lib/visualization";

/**
 * React hook creating and managing the underlying Three.js scene. The heavy
 * lifting lives in {@link SatelliteScene}. This hook simply instantiates the
 * scene and disposes it when parameters change or the component unmounts.
 */
export function useSatelliteScene(params: SatelliteSceneParams) {
  const sceneRef = useRef<SatelliteScene | null>(null);
  
  useEffect(() => {
    if (!params.mountRef.current) return;
    
    // Use a small delay to ensure proper cleanup timing
    let scene: SatelliteScene | null = null;
    const timeout = setTimeout(() => {
      scene = new SatelliteScene(params);
      sceneRef.current = scene;
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
    params.ecef,
    params.onSelect,
    params.onSelectStation,
    params.stationInfoRef,
  ]);
  
  return sceneRef;
}
