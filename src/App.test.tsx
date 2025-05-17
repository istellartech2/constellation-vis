import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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

describe('App', () => {
  it('renders Globe element', () => {
    render(<App />)
    expect(screen.getByTestId('globe')).toBeTruthy()
  })
})
