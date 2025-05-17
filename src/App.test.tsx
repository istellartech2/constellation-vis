import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import App from './App'

vi.mock('react-globe.gl', () => {
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref) => (
      <div ref={ref} data-testid="globe" {...props} />
    )),
  }
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      text: () =>
        Promise.resolve(
          [
            'semi_major_axis = 6771',
            'eccentricity = 0.0001',
            'inclination = 98.7',
            'raan = 257.7',
            'argument_of_perigee = 130.5',
            'mean_anomaly = 45.0',
          ].join('\n'),
        ),
    })
  ))
})

describe('App', () => {
  it('renders Globe element', () => {
    render(<App />)
    expect(screen.getByTestId('globe')).toBeTruthy()
    expect(screen.getByRole('slider')).toBeTruthy()
    expect(screen.getByTestId('sim-time')).toBeTruthy()
  })

  it('updates satellite position over time', () => {
    vi.useFakeTimers()
    render(<App />)
    vi.advanceTimersByTime(1000)
    const globeEl = screen.getByTestId('globe') as any
    expect(Array.isArray(globeEl.pointsData)).toBe(true)
    expect(globeEl.pointsData.length).toBe(1)
    const firstLng = globeEl.pointsData[0].lng
    const firstLat = globeEl.pointsData[0].lat
    vi.advanceTimersByTime(1000)
    expect(globeEl.pointsData[0].lng).not.toBe(firstLng)
    expect(globeEl.pointsData[0].lat).toBeCloseTo(firstLat, 1)
    vi.useRealTimers()
  })
})
