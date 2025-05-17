export interface OrbitElements {
  semi_major_axis: number
  eccentricity: number
  inclination: number
  raan: number
  argument_of_perigee: number
  mean_anomaly: number
}

const MU = 398600.4418 // km^3/s^2

function solveKepler(M: number, e: number): number {
  let E = M
  for (let i = 0; i < 15; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    E -= dE
    if (Math.abs(dE) < 1e-8) break
  }
  return E
}

export function propagateOrbit(el: OrbitElements, tSec: number) {
  const n = Math.sqrt(MU / Math.pow(el.semi_major_axis, 3))
  const M0 = (el.mean_anomaly * Math.PI) / 180
  const M = M0 + n * tSec
  const E = solveKepler(M, el.eccentricity)

  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const sqrtOneMinusE2 = Math.sqrt(1 - el.eccentricity * el.eccentricity)

  const xOrb = el.semi_major_axis * (cosE - el.eccentricity)
  const yOrb = el.semi_major_axis * sqrtOneMinusE2 * sinE

  const cosO = Math.cos((el.raan * Math.PI) / 180)
  const sinO = Math.sin((el.raan * Math.PI) / 180)
  const cosI = Math.cos((el.inclination * Math.PI) / 180)
  const sinI = Math.sin((el.inclination * Math.PI) / 180)
  const cosW = Math.cos((el.argument_of_perigee * Math.PI) / 180)
  const sinW = Math.sin((el.argument_of_perigee * Math.PI) / 180)

  const x = (cosO * cosW - sinO * sinW * cosI) * xOrb +
            (-cosO * sinW - sinO * cosW * cosI) * yOrb
  const y = (sinO * cosW + cosO * sinW * cosI) * xOrb +
            (-sinO * sinW + cosO * cosW * cosI) * yOrb
  const z = (sinW * sinI) * xOrb + (cosW * sinI) * yOrb

  return { x, y, z }
}
