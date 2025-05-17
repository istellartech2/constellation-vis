import { useEffect, useRef, useState } from 'react'
import { parse } from 'toml'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'

function App() {
  // use a null default value so the ref type matches React's expectations
  const globeEl = useRef<GlobeMethods | null>(null)
  const [orbit, setOrbit] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    globeEl.current?.pointOfView({ lat: 0, lng: 0, altitude: 2 }, 0)
    fetch('/satellite.toml')
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = parse(text) as Record<string, number>
          setOrbit(data)
        } catch (err) {
          console.error('Failed to parse satellite data', err)
        }
      })
      .catch((err) => {
        console.error('Failed to load satellite data', err)
      })
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
