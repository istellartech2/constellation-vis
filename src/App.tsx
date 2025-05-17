import { useEffect, useRef, useState } from 'react'

import { parse } from 'toml'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import type { OrbitElements } from './orbit'
import { propagateOrbit } from './orbit'

const EARTH_RADIUS_KM = 6371
const EARTH_ROTATION_RATE_DEG_PER_SEC = 360 / 86164

function App() {
  // use a null default value so the ref type matches React's expectations
  const globeEl = useRef<GlobeMethods | null>(null)
  const [sats, setSats] = useState<{ lat: number; lng: number; altitude: number }[]>([])
  const [orbit, setOrbit] = useState<OrbitElements>()

  const lastTimeRef = useRef<number>()
  const earthRotRef = useRef(0)
  const orbitTimeRef = useRef(0)

  useEffect(() => {
    globeEl.current?.pointOfView({ lat: 0, lng: 0, altitude: 2 * EARTH_RADIUS_KM }, 0)
    // @ts-expect-error globeRadius is provided by three-globe
    globeEl.current?.globeRadius?.(EARTH_RADIUS_KM)
  }, [])

  useEffect(() => {
    fetch('/satellite.toml')
      .then((res) => res.text())
      .then((text) => setOrbit(parse(text) as OrbitElements))
      .catch((err) => console.error('failed to load orbit data', err))
  }, [])

  const [simulationTime, setSimulationTime] = useState(() => Date.now())
  const [speed, setSpeed] = useState(1)
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
    if (!orbit) return

    let animationFrame: number

    const animate = (t: number) => {
      if (lastTimeRef.current !== undefined) {
        const deltaMs = t - lastTimeRef.current
        const deltaSec = (deltaMs / 1000) * speedRef.current
        earthRotRef.current += THREE.MathUtils.degToRad(
          EARTH_ROTATION_RATE_DEG_PER_SEC * deltaSec,
        )
        orbitTimeRef.current += deltaSec
      }
      lastTimeRef.current = t

      if (globeEl.current) {
        ;(globeEl.current as any).rotation.y = earthRotRef.current
      }

      const { x, y, z } = propagateOrbit(orbit, orbitTimeRef.current)
      const r = Math.sqrt(x * x + y * y + z * z)
      const lat = Math.asin(z / r)
      const inertialLng = Math.atan2(y, x)
      const lng = inertialLng - earthRotRef.current

      setSats([
        {
          lat: THREE.MathUtils.radToDeg(lat),
          lng: THREE.MathUtils.radToDeg(lng),
          altitude: r - EARTH_RADIUS_KM,
        },
      ])

      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [orbit])

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}>
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        pointsData={sats}
        pointLat="lat"
        pointLng="lng"
        // altitude is in km, match globe radius in km
        pointAltitude={(d: any) => d.altitude}
        pointRadius={30}
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
