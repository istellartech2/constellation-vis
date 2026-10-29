# Constellation Visualizer

Design satellite constellations, explore their orbits in 3D, and evaluate how they connect with the Earth and each other.

[Open the app](https://constellation-vis-rho.vercel.app/) · [日本語](docs/README.ja.md) · [Documentation](docs/how-it-works.md)

## Explore

- **Build a constellation** — define satellites from TLEs or orbital elements, import data from CelesTrak, or design a constellation from a pattern or mission requirements.
- **See the geometry** — explore orbits, ground stations, sensor fields of view, and satellite links around a 3D Earth.
- **Analyze a mission** — evaluate ground access, satellite-to-satellite routes, orbital lifetime, propellant, and power.
- **Work with your tools** — save scenarios as TOML, run ground-link analysis from the CLI, or connect an AI to a temporary session.

Satellite positions use `satellite.js` SGP4/SDP4. Access and link results describe geometric opportunities; they are not a radio link budget or an operating schedule. See the [calculation overview](docs/how-it-works.md) for model assumptions and limitations.

## Get started

Requires [Bun](https://bun.sh/) 1.3.11 or later.

```sh
bun install
bun run dev
```

Open [localhost:5173](http://localhost:5173). The development server runs the frontend; local AI session API development requires additional setup.

```sh
bun run test       # Bun tests
bun run lint       # ESLint
bun run build      # TypeScript and production build
bun run build:cli  # Bun-powered CLI in dist/
```

## Learn more

- [Calculation overview](docs/how-it-works.md) · [Models and implementation](docs/analysis-implementation.md)
- [Constellation patterns](docs/constellation-patterns.md) · [Mission-driven design](docs/constellation-design.md) · [ISL routing](docs/isl-routing.md)
- [CLI guide](docs/constelation-cli-SKILLS.md) · [AI session API](public/ai-api.md) · [Deployment and local API setup](docs/deployment.md)

## License

Copyright 2026 Interstellar Technologies Inc. Project-authored material is licensed under [Apache-2.0](LICENSE). Third-party components and data retain their own terms; see [THIRD-PARTY.md](THIRD-PARTY.md).
