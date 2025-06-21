# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
bun install

# Build for production (runs generate-satellites.ts pre-hook)
bun run build

# Lint code
bun run lint

# Run tests
bun run test

# Run tests with UI
bun run test:ui

# Generate satellite data from TOML configs
bun scripts/generate-satellites.ts
```

## Architecture Overview

This is a React/TypeScript application for 3D satellite constellation visualization and orbital analysis. The application combines real-time 3D graphics with sophisticated orbital mechanics calculations.

### Data Flow
1. **Configuration**: TOML files in `/public/` define satellites, constellations, and ground stations
2. **Build-time Generation**: `scripts/generate-satellites.ts` processes TOML → `src/lib/satellites.generated.ts`
3. **Runtime Propagation**: satellite.js library performs SGP4/SDP4 orbital calculations
4. **Visualization**: Three.js renders real-time 3D satellite positions and orbits

### Core Libraries
- **src/lib/satellites.ts**: Satellite data models, TLE conversion, constellation generation
- **src/lib/astronomy.ts**: Solar position, coordinate transformations, Earth geometry
- **src/lib/visibility.ts**: Ground station visibility calculations and access statistics
- **src/lib/perturbation.ts**: J2/J3 gravitational harmonics and atmospheric drag models
- **src/lib/visualization.ts**: Three.js scene management and 3D rendering

### Component Structure
- **App.tsx**: Root component with useSatelliteScene hook for Three.js integration
- **components/ui/**: Tabbed interface (Editor/Analysis/Options), controls, and dialogs
- **components/analysis/**: Analysis modules for station access, global coverage, orbit maintenance, solar impact
- **useSatelliteScene.ts**: Custom hook managing Three.js scene state and satellite propagation

### Key Features
- **Real-time Visualization**: 3D Earth with satellites, orbits, ground station links
- **Orbital Mechanics**: SGP4 propagation with perturbation analysis (J2, J3, drag)
- **Analysis Tools**: Visibility analysis, coverage maps, maintenance requirements
- **Data Import**: CelesTrak API integration for real-world satellite data
- **Configuration**: TOML-based satellite/constellation/ground station definitions

### File Formats
- **satellites.toml**: Individual satellites (TLE or orbital elements format)
- **constellation.toml**: Programmatic constellation generation (shells, planes, phasing)
- **groundstations.toml**: Ground station locations and elevation masks

### Testing
- **Vitest** for unit tests with Python-generated reference data for orbital calculations
- **Test files** in `/tests/` for CelesTrak API, visibility calculations, perturbation models
- **Reference data** in JSON format for validation against Python orbital mechanics libraries

### Build Process
The application requires running `scripts/generate-satellites.ts` before dev/build to process TOML configurations. This script:
- Parses TOML files for satellites, constellations, and ground stations
- Generates constellation satellites from shell parameters
- Converts orbital elements to TLE format for satellite.js compatibility
- Outputs TypeScript definitions to `src/lib/satellites.generated.ts`

Always run the generate-satellites script when TOML configuration files are modified.

## Styling Framework

The application uses **Tailwind CSS v4.1** for styling:
- All styles are defined in `src/index.css` using the new v4 `@import "tailwindcss"` directive
- Configuration is embedded directly in CSS using the `@config` directive (no separate config file needed)
- Custom colors and design tokens are defined in the CSS file itself using the new v4 syntax
- PostCSS configuration is no longer required - Tailwind v4 works directly with Vite
- The existing design has been preserved while migrating to the modern v4 architecture
- Component classes like `.analysis-button`, `.side-panel`, `.tab-button` are available as custom CSS components