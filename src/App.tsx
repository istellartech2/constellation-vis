import { useRef, useEffect } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";

function App() {
  const globeRef = useRef<GlobeMethods>(null);
  const EARTH_RADIUS_KM = 6371;

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
    }
  }, []);

  return (
    <Globe
      ref={globeRef}
      globeRadius={EARTH_RADIUS_KM}
      backgroundColor="black"
      globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
    />
  );
}

export default App;