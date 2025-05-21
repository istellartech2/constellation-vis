# Constellation Viewer

A minimal web application to visualize Earth and satellites in orbit in real time using React, TypeScript, Vite, Three.js, and satellite.js.

## Features

- Render a 3D Earth with realistic texture and graticule lines.
- Visualize satellite positions and ground tracks from TLE data.
- Adjustable simulation speed (1×–100× real time) via slider.
- Interactive orbit controls for zooming, rotating, and panning.
- Display current simulated UTC date and time.
- Responsive viewport that adjusts on window resize.

## Prerequisites

- Node.js ≥16 or [bun](https://bun.sh/) (optional)
- npm, yarn, or bun for package management

## Installation

```bash
# Using npm
npm install

# Using bun
bun install
```

## Development

Start the development server with hot module replacement:

```bash
npm run dev
# or bun dev
```

Open your browser and visit `http://localhost:5173`.


## Deployment
https://constellation-vis-919f.vercel.app/
