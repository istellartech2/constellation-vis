---
name: constelation-cli
description: Build, run, validate, or interpret the repository's constelation-cli native command-line analyzer for LEO satellite-to-ground service and feeder links. Use for TOML scenarios containing TLEs, orbital elements, constellation shells, UEs, or gateways; for JSON/CSV contact windows and duty results; and for geometric Doppler, slant-range, range-rate, or propagation-delay analysis.
---

# Constelation CLI

Use the repository-native `constelation-cli` to calculate geometrically available LEO ground links. Treat its results as contact opportunities rather than scheduled traffic or an RF link budget.

## Build and verify

Run commands from the repository root.

```bash
bun install
bun run test
bun run lint
bun run build
bun run build:cli
```

Use the generated executable at `dist/constelation-cli`. Do not commit `dist/`.

For source-mode iteration, use:

```bash
bun run cli -- analyze <scenario.toml>
```

## Prepare a scenario

Use TOML for input. Include one `[analysis]` table, at least one `[[satellites]]` entry or `[[constellation.shells]]`, and at least one ground station of each `kind`.

```toml
[analysis]
startTime = "2026-08-18T00:00:00Z"
durationHours = 24
stepSeconds = 10
eventToleranceSeconds = 0.1

[[satellites]]
id = "sat-1"
name = "Demo satellite"
type = "elements"
satnum = 90001
epoch = "2026-08-18T00:00:00Z"
semiMajorAxisKm = 6903.137
eccentricity = 0
inclinationDeg = 97.5
raanDeg = 0
argPerigeeDeg = 0
meanAnomalyDeg = 0

[[groundstations]]
id = "tokyo-ue"
name = "Tokyo UE"
kind = "service"
latitudeDeg = 35.6812
longitudeDeg = 139.7671
heightKm = 0
minElevationDeg = 20
uplinkFrequencyHz = 1980000000
downlinkFrequencyHz = 2170000000

[[groundstations]]
id = "tsukuba-gateway"
name = "Tsukuba Gateway"
kind = "feeder"
latitudeDeg = 36.0835
longitudeDeg = 140.0764
heightKm = 0
minElevationDeg = 10
uplinkFrequencyHz = 30000000000
downlinkFrequencyHz = 20000000000
```

Use `type = "tle"` with `line1` and `line2` instead of element fields when TLE input is available. Keep all times in UTC and all frequencies in Hz.

Ground stations accept the existing visibility fields:

- `visibilityMode = "elevation_only" | "off_nadir_only" | "and"`
- `minElevationDeg`
- `maxOffNadirDeg`

## Run an analysis

Write compact JSON to stdout by default:

```bash
dist/constelation-cli analyze scenario.toml > result.json
```

Write formatted JSON or omit link samples when only summary data is needed:

```bash
dist/constelation-cli analyze scenario.toml --pretty --output result.json
dist/constelation-cli analyze scenario.toml --summary-only --output summary.json
```

Write CSV tables to a directory:

```bash
dist/constelation-cli analyze scenario.toml --format csv --output results/
```

Expect `satellite_duty.csv`, `link_summary.csv`, `contact_windows.csv`, `link_samples.csv`, and `constellation_summary.csv`.

Override a scenario's sampling controls only when required:

```bash
dist/constelation-cli analyze scenario.toml --duration-hours 48 --step-seconds 5
```

## Interpret results

Read these duty fields as interval unions over the analysis duration:

- `serviceRatio`: at least one service terminal is visible to the satellite.
- `feederRatio`: at least one feeder terminal is visible to the satellite.
- `endToEndRatio`: service and feeder are simultaneously visible to the same satellite.
- `communicationRatio`: at least one service or feeder terminal is visible.
- `constellationSummary.endToEndDutyRatio`: at least one satellite has same-satellite end-to-end availability.

Do not infer beam, channel, capacity, traffic, handover, or scheduling feasibility from these fields. Do not infer an ISL path when the service and feeder links terminate on different satellites.

Interpret the geometry with these conventions:

- `rangeRateKmPerSec > 0` means increasing separation.
- A receding link produces negative Doppler; an approaching link produces positive Doppler.
- `uplinkDopplerHz` and `downlinkDopplerHz` use their respective configured carrier frequencies.
- Propagation delay is vacuum geometric delay only: one-way is slant range divided by light speed, and round-trip is twice that value.
- Atmospheric, equipment, processing, and routing delays are excluded.

Use `contactWindows` for AOS/LOS and pass extrema. Use `samples` or `link_samples.csv` for time-dependent Doppler, range, and delay. `--summary-only` intentionally leaves samples empty.

## Validate changes

Use the deterministic representative SSO fixture:

```bash
dist/constelation-cli analyze tests/transporter-tokyo-tsukuba.toml \
  --summary-only --pretty --output /tmp/constelation-cli-result.json
```

Check these invariants instead of hard-coding every floating-point result:

- Service, feeder, and end-to-end duty are within `[0, 1]`.
- End-to-end duty does not exceed either service or feeder duty.
- One-way delay equals `slantRangeKm / 299792.458 * 1000`.
- Doppler is proportional to carrier frequency and has the opposite sign from range rate.
- Doppler changes sign around closest approach for a normal pass.
- AOS/LOS refinement remains stable when reducing `stepSeconds`.

After modifying orbit, visibility, parsing, or output code, run the full test, lint, Web build, CLI build, and fixture executable checks. Preserve the existing Web application's visibility behavior.

## Handle failures

- If parsing fails, confirm `[analysis].startTime` is a UTC timestamp and every required number is finite.
- If no contacts appear, check epoch, altitude/semi-major axis, station coordinates, minimum elevation, and off-nadir mode.
- If Doppler is `null`, add the corresponding uplink or downlink carrier frequency.
- If CSV output fails, pass a directory to `--output`; JSON output accepts a file or stdout.
- If a user requests RF margin, power/SOC, thermal temperature, or scheduling results, report that they are outside this CLI's model and pass the generated duty/geometry data to the appropriate tool.
