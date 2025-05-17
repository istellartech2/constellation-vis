import { useEffect, useRef } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'

function App() {
  // use a null default value so the ref type matches React's expectations
  const globeEl = useRef<GlobeMethods | null>(null)

  useEffect(() => {
    globeEl.current?.pointOfView({ lat: 0, lng: 0, altitude: 2 }, 0)
  }, [])

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}>
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      />
    </div>
  )
}

export default App
