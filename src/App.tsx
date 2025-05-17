import { useEffect, useRef, useState } from 'react'

import { parse } from 'toml'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'

const EARTH_RADIUS_KM = 6371
const EARTH_ROTATION_RATE_DEG_PER_SEC = 360 / 86164
const SAT_ALT_KM = 400
const ORBIT_PERIOD_SEC = 92 * 60 // ISS orbital period approximation

function App() {
  // use a null default value so the ref type matches React's expectations
  const globeEl = useRef<GlobeMethods | null>(null)
  const [sats, setSats] = useState<{ lat: number; lng: number; altitude: number }[]>([])

  const lastTimeRef = useRef<number>()
  const earthRotRef = useRef(0)
  const satAngleRef = useRef(0)

  useEffect(() => {
    globeEl.current?.pointOfView({ lat: 0, lng: 0, altitude: 2 * EARTH_RADIUS_KM }, 0)
    // @ts-expect-error globeRadius is provided by three-globe
    globeEl.current?.globeRadius?.(EARTH_RADIUS_KM)
  }, [])

  useEffect(() => {
    let animationFrame: number

    const animate = (t: number) => {
      if (lastTimeRef.current !== undefined) {
        const deltaSec = (t - lastTimeRef.current) / 1000
        earthRotRef.current += THREE.MathUtils.degToRad(EARTH_ROTATION_RATE_DEG_PER_SEC * deltaSec)
        satAngleRef.current += (2 * Math.PI / ORBIT_PERIOD_SEC) * deltaSec
      }
      lastTimeRef.current = t

      if (globeEl.current) {
        ;(globeEl.current as any).rotation.y = earthRotRef.current
      }

      const inertialLng = THREE.MathUtils.radToDeg(satAngleRef.current)
      const earthLng = THREE.MathUtils.radToDeg(earthRotRef.current)
      const relLng = inertialLng - earthLng

      setSats([
        {
          lat: 0,
          lng: relLng,
          altitude: SAT_ALT_KM,
        },
      ])

      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

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
    </div>
  )
}

export default App
