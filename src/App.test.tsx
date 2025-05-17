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
  })
})
