import { useEffect, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'

function App() {
  // use a null default value so the ref type matches React's expectations
  const globeEl = useRef<GlobeMethods | null>(null)

  const [simulationTime, setSimulationTime] = useState(() => Date.now())
  const [speed, setSpeed] = useState(10)
  const speedRef = useRef(speed)

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    let frameId: number
    let last = performance.now()

    const update = () => {
      const now = performance.now()
      const delta = now - last
      last = now
      setSimulationTime((t) => t + delta * speedRef.current)
      frameId = requestAnimationFrame(update)
    }

    frameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameId)
  }, [])

  useEffect(() => {
    globeEl.current?.pointOfView({ lat: 0, lng: 0, altitude: 2 }, 0)
  }, [])

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}>
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      />
      <input
        type="range"
        min={1}
        max={100}
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        style={{ position: 'fixed', top: '1em', right: '1em' }}
      />
      <div
        data-testid="sim-time"
        style={{ position: 'fixed', bottom: '1em', right: '1em', background: 'rgba(0,0,0,0.5)', padding: '0.25em 0.5em', borderRadius: '4px' }}
      >
        {new Date(simulationTime).toISOString()}
      </div>
    </div>
  )
}

export default App
