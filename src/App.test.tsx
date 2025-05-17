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
      text: () => Promise.resolve(''),
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
    vi.advanceTimersByTime(1000)
    expect(globeEl.pointsData[0].lng).not.toBe(firstLng)
    vi.useRealTimers()
  })
})
