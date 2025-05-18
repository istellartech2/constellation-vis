import { useRef, useEffect } from "react";
import Globe from "react-globe.gl";

function App() {
  const globeRef = useRef<ReturnType<typeof Globe>>(null);

  // slow continuous spin
  useEffect(() => {
    let frame: number;
    const animate = () => {
      const g = globeRef.current?.getGlobe();
      if (g) g.rotation.y += 0.0005; // tweak speed here
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Globe
      ref={globeRef as any}
      backgroundColor="black"
      globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
    />
  );
}

export default App;