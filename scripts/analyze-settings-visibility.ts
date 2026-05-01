import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  type ConstellationConfig,
  type ConstellationShellConfig,
  generateFromShells,
  parseConstellationConfig,
  parseSatellitesToml,
} from "../src/lib/tomlParsers";
import { parseConfigBundle } from "../src/lib/config";
import type { GroundStation, VisibilityMode } from "../src/lib/groundStations";
import { visibilityStats } from "../src/lib/visibility";

type LineSweepKey =
  | "apogee_altitude"
  | "inclination"
  | "minElevationDeg"
  | "maxOffNadirDeg";

interface StationMetric {
  name: string;
  visibleHours: number;
  visibleRatio: number;
  averageVisible: number;
}

interface LineSweepPoint {
  value: number;
  metrics: StationMetric[];
}

interface ChartSeries {
  name: string;
  points: Array<{ x: number; y: number }>;
}

interface CountPlaneCell {
  count: number;
  planes: number;
  metrics: StationMetric[];
}

const DEFAULT_DURATION_HOURS = 24;
const DEFAULT_STEP_SECONDS = 60;
const OUTPUT_DIR_NAME = "visibility-analysis";
const PALETTE = [
  "#1d4ed8",
  "#d97706",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
];

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}

function applyShellDefaults(shell: ConstellationShellConfig): Required<ConstellationShellConfig> {
  return {
    name: shell.name ?? "SweepTarget",
    count: shell.count,
    planes: shell.planes,
    phasing: shell.phasing ?? 0,
    apogee_altitude: shell.apogee_altitude,
    eccentricity: shell.eccentricity ?? 0,
    inclination: shell.inclination,
    raan_range: shell.raan_range ?? 360,
    raan_start: shell.raan_start ?? 0,
    argp: shell.argp ?? 0,
    mean_anomaly_0: shell.mean_anomaly_0 ?? 0,
  };
}

function deriveCountValues(baseCount: number): number[] {
  return uniqueSorted([
    Math.max(4, Math.round(baseCount * 0.5)),
    Math.max(4, Math.round(baseCount * 0.75)),
    baseCount,
    Math.round(baseCount * 1.25),
    Math.round(baseCount * 1.5),
    Math.round(baseCount * 2),
  ]);
}

function derivePlaneValues(basePlanes: number): number[] {
  return uniqueSorted([
    1,
    2,
    Math.max(1, Math.round(basePlanes * 0.5)),
    basePlanes,
    Math.round(basePlanes * 1.5),
    Math.round(basePlanes * 2),
  ]);
}

function deriveAltitudeValues(baseAltitude: number): number[] {
  return uniqueSorted([
    Math.max(100, Math.round(baseAltitude - 300)),
    Math.max(100, Math.round(baseAltitude - 225)),
    Math.max(100, Math.round(baseAltitude - 150)),
    Math.max(100, Math.round(baseAltitude - 75)),
    Math.round(baseAltitude),
    Math.round(baseAltitude + 75),
    Math.round(baseAltitude + 150),
    Math.round(baseAltitude + 225),
    Math.round(baseAltitude + 300),
  ]);
}

function deriveInclinationValues(baseInclination: number): number[] {
  return uniqueSorted([
    0,
    Math.max(0, Math.round(baseInclination - 30)),
    Math.max(0, Math.round(baseInclination - 20)),
    Math.max(0, Math.round(baseInclination - 10)),
    Math.max(0, Math.round(baseInclination - 5)),
    Math.round(baseInclination),
    Math.min(180, Math.round(baseInclination + 5)),
    Math.min(180, Math.round(baseInclination + 10)),
    Math.min(180, Math.round(baseInclination + 20)),
    Math.min(180, Math.round(baseInclination + 30)),
    70,
    98,
  ]);
}

function deriveInclinationValuesAroundLatitude(
  baseInclination: number,
  targetLatitude: number,
): number[] {
  const latitude = Math.abs(targetLatitude);
  const denseOffsets = [-10, -8, -6, -4, -2, -1, 0, 1, 2, 4, 6, 8, 10];
  return uniqueSorted([
    ...deriveInclinationValues(baseInclination),
    latitude,
    ...denseOffsets.map((offset) => Math.max(0, Math.min(180, Math.round(latitude + offset)))),
  ]);
}

function deriveMinElevationValues(baseMinElevation: number): number[] {
  return uniqueSorted([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, Math.round(baseMinElevation)]);
}

function deriveOffNadirValues(baseMaxOffNadir: number): number[] {
  return uniqueSorted([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, Math.round(baseMaxOffNadir)]);
}

function replaceSweepShell(
  config: ConstellationConfig,
  nextShell: Required<ConstellationShellConfig>,
): ConstellationConfig {
  return {
    ...config,
    shells: [nextShell, ...config.shells.slice(1)],
  };
}

function buildSatellites(
  baseSatellitesText: string,
  constellationConfig: ConstellationConfig,
) {
  const baseSatellites = baseSatellitesText.trim()
    ? parseSatellitesToml(baseSatellitesText)
    : [];
  return [...baseSatellites, ...generateFromShells(constellationConfig)];
}

function analyzeStations(
  satellites: ReturnType<typeof buildSatellites>,
  stations: GroundStation[],
  startTime: Date,
  durationHours = DEFAULT_DURATION_HOURS,
  stepSeconds = DEFAULT_STEP_SECONDS,
): StationMetric[] {
  return stations.map((station) => {
    const stats = visibilityStats(
      satellites,
      station,
      startTime,
      durationHours,
      stepSeconds,
    );
    return {
      name: station.name,
      visibleHours: round(stats.visibleHours),
      visibleRatio: round(stats.nonZeroRate * 100),
      averageVisible: round(stats.avg),
    };
  });
}

function averageMetric(metrics: StationMetric[], key: keyof Omit<StationMetric, "name">): number {
  if (metrics.length === 0) return 0;
  const total = metrics.reduce((sum, metric) => sum + metric[key], 0);
  return round(total / metrics.length);
}

function writeCsv(path: string, header: string[], rows: Array<Array<string | number>>) {
  const lines = [header.join(",")];
  rows.forEach((row) => {
    lines.push(row.map((value) => String(value)).join(","));
  });
  return Bun.write(path, lines.join("\n"));
}

function renderLineChart(
  title: string,
  xLabel: string,
  series: ChartSeries[],
  subtitle?: string,
  xTickValues?: number[],
): string {
  const width = 900;
  const height = 440;
  const subtitleLines = subtitle ? wrapSvgText(subtitle, 105) : [];
  const margin = {
    top: subtitleLines.length > 0 ? 40 + subtitleLines.length * 18 + 14 : 40,
    right: 180,
    bottom: 60,
    left: 70,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xValues = series.flatMap((item) => item.points.map((point) => point.x));
  const yValues = series.flatMap((item) => item.points.map((point) => point.y));
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMax = Math.max(...yValues, 0.1);

  const xScale = (value: number) =>
    margin.left + ((value - xMin) / Math.max(1e-9, xMax - xMin || 1)) * innerWidth;
  const yScale = (value: number) =>
    margin.top + innerHeight - (value / yMax) * innerHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = margin.top + innerHeight * ratio;
    const label = round(yMax * (1 - ratio), 1);
    return `<line x1="${margin.left}" y1="${y}" x2="${margin.left + innerWidth}" y2="${y}" stroke="#d1d5db" stroke-dasharray="4 4" />
<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#4b5563">${label}</text>`;
  });

  const tickValues = xTickValues ?? uniqueSorted(xValues);
  const xTicks = tickValues.map((value) => {
    const x = xScale(value);
    return `<line x1="${x}" y1="${margin.top + innerHeight}" x2="${x}" y2="${margin.top + innerHeight + 6}" stroke="#374151" />
<text x="${x}" y="${height - 20}" text-anchor="middle" font-size="12" fill="#4b5563">${value}</text>`;
  });

  const paths = series.map((item, index) => {
    const color = PALETTE[index % PALETTE.length];
    const d = item.points
      .map((point, pointIndex) => {
        const prefix = pointIndex === 0 ? "M" : "L";
        return `${prefix} ${xScale(point.x)} ${yScale(point.y)}`;
      })
      .join(" ");
    const markers = item.points
      .map((point) => {
        const x = xScale(point.x);
        const y = yScale(point.y);
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" />`;
      })
      .join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" />${markers}`;
  });

  const legend = series
    .map((item, index) => {
      const color = PALETTE[index % PALETTE.length];
      const y = margin.top + index * 24;
      return `<rect x="${width - 160}" y="${y - 10}" width="14" height="14" fill="${color}" />
<text x="${width - 140}" y="${y + 2}" font-size="12" fill="#111827">${item.name}</text>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${margin.left}" y="24" font-size="20" font-weight="700" fill="#111827">${title}</text>
  ${
    subtitleLines.length > 0
      ? `<text x="${margin.left}" y="46" font-size="12" fill="#4b5563">${subtitleLines
          .map((line, index) => `<tspan x="${margin.left}" dy="${index === 0 ? 0 : 16}">${escapeSvgText(line)}</tspan>`)
          .join("")}</text>`
      : ""
  }
  <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${margin.left + innerWidth}" y2="${margin.top + innerHeight}" stroke="#374151" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}" stroke="#374151" />
  ${gridLines.join("\n  ")}
  ${xTicks.join("\n  ")}
  ${paths.join("\n  ")}
  ${legend}
  <text x="${margin.left + innerWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="13" fill="#374151">${xLabel}</text>
  <text x="18" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 18 ${margin.top + innerHeight / 2})">Visible Ratio (%)</text>
</svg>`;
}

function renderHeatmap(
  title: string,
  counts: number[],
  planes: number[],
  cells: CountPlaneCell[],
  subtitle?: string,
): string {
  const width = 860;
  const height = 500;
  const subtitleLines = subtitle ? wrapSvgText(subtitle, 95) : [];
  const margin = {
    top: subtitleLines.length > 0 ? 70 + subtitleLines.length * 16 + 14 : 70,
    right: 70,
    bottom: 60,
    left: 90,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const cellWidth = innerWidth / Math.max(1, counts.length);
  const cellHeight = innerHeight / Math.max(1, planes.length);
  const lookup = new Map(
    cells.map((cell) => [
      `${cell.count}:${cell.planes}`,
      averageMetric(cell.metrics, "visibleRatio"),
    ]),
  );
  const values = [...lookup.values()];
  const maxValue = Math.max(...values, 0.1);

  function colorFor(value: number) {
    const ratio = value / maxValue;
    const lightness = 96 - ratio * 50;
    return `hsl(210 80% ${lightness}%)`;
  }

  const cellRects = planes
    .map((plane, rowIndex) =>
      counts
        .map((count, colIndex) => {
          const value = lookup.get(`${count}:${plane}`) ?? 0;
          const x = margin.left + colIndex * cellWidth;
          const y = margin.top + rowIndex * cellHeight;
          return `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${colorFor(value)}" stroke="#ffffff" />
<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + 4}" text-anchor="middle" font-size="12" fill="#111827">${round(value, 1)}</text>`;
        })
        .join("\n"),
    )
    .join("\n");

  const countLabels = counts
    .map((count, index) => {
      const x = margin.left + index * cellWidth + cellWidth / 2;
      return `<text x="${x}" y="${height - 20}" text-anchor="middle" font-size="12" fill="#374151">${count}</text>`;
    })
    .join("\n");
  const planeLabels = planes
    .map((plane, index) => {
      const y = margin.top + index * cellHeight + cellHeight / 2 + 4;
      return `<text x="${margin.left - 12}" y="${y}" text-anchor="end" font-size="12" fill="#374151">${plane}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${margin.left}" y="30" font-size="20" font-weight="700" fill="#111827">${title}</text>
  ${
    subtitleLines.length > 0
      ? `<text x="${margin.left}" y="52" font-size="12" fill="#4b5563">${subtitleLines
          .map((line, index) => `<tspan x="${margin.left}" dy="${index === 0 ? 0 : 16}">${escapeSvgText(line)}</tspan>`)
          .join("")}</text>`
      : ""
  }
  ${cellRects}
  ${countLabels}
  ${planeLabels}
  <text x="${margin.left + innerWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="13" fill="#374151">Satellite Count</text>
  <text x="24" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 24 ${margin.top + innerHeight / 2})">Orbital Planes</text>
</svg>`;
}

function sweepFileBaseName(key: LineSweepKey): string {
  if (key === "minElevationDeg") return "min_elevation";
  if (key === "maxOffNadirDeg") return "max_off_nadir";
  return key;
}

function wrapSvgText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function escapeSvgText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function selectTickValuesBySpacing(
  values: number[],
  widthPx: number,
  minSpacingPx: number,
): number[] {
  const sorted = uniqueSorted(values);
  if (sorted.length <= 2) return sorted;

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const scale = (value: number) =>
    ((value - min) / Math.max(1e-9, max - min || 1)) * widthPx;

  const selected: number[] = [sorted[0]];
  let lastX = scale(sorted[0]);

  for (let i = 1; i < sorted.length - 1; i++) {
    const currentX = scale(sorted[i]);
    if (currentX - lastX >= minSpacingPx) {
      selected.push(sorted[i]);
      lastX = currentX;
    }
  }

  selected.push(sorted[sorted.length - 1]);
  return uniqueSorted(selected);
}

function metricsToSeries(
  points: LineSweepPoint[],
  stations: GroundStation[],
): ChartSeries[] {
  const averageSeries = {
    name: "Average",
    points: points.map((point) => ({
      x: point.value,
      y: averageMetric(point.metrics, "visibleRatio"),
    })),
  };
  const stationSeries = stations.map((station) => ({
    name: station.name,
    points: points.map((point) => {
      const metric = point.metrics.find((item) => item.name === station.name);
      return {
        x: point.value,
        y: metric?.visibleRatio ?? 0,
      };
    }),
  }));
  return [averageSeries, ...stationSeries];
}

function metricsToElevationSeries(
  pointsByElevation: Array<{ minElevationDeg: number; points: LineSweepPoint[] }>,
): ChartSeries[] {
  return pointsByElevation.map(({ minElevationDeg, points }) => ({
    name: `Min elevation ${minElevationDeg} deg`,
    points: points.map((point) => ({
      x: point.value,
      y: averageMetric(point.metrics, "visibleRatio"),
    })),
  }));
}

function effectiveVisibilityModeForSweep(
  currentMode: VisibilityMode | undefined,
  sweepKey: LineSweepKey,
): VisibilityMode {
  if (sweepKey === "maxOffNadirDeg") {
    return currentMode === "off_nadir_only" || currentMode === "and" ? currentMode : "and";
  }
  if (sweepKey === "minElevationDeg") {
    return currentMode === "elevation_only" || currentMode === "and" ? currentMode : "and";
  }
  return currentMode ?? "elevation_only";
}

function applySweepMode(
  stations: GroundStation[],
  sweepKey: LineSweepKey,
): GroundStation[] {
  return stations.map((station) => ({
    ...station,
    visibilityMode: effectiveVisibilityModeForSweep(station.visibilityMode, sweepKey),
  }));
}

function buildLineSweepCsvRows(points: LineSweepPoint[], stations: GroundStation[]) {
  return points.map((point) => {
    const row: Array<string | number> = [
      point.value,
      averageMetric(point.metrics, "visibleHours"),
      averageMetric(point.metrics, "visibleRatio"),
      averageMetric(point.metrics, "averageVisible"),
    ];

    stations.forEach((station) => {
      const metric = point.metrics.find((item) => item.name === station.name);
      row.push(metric?.visibleHours ?? 0);
      row.push(metric?.visibleRatio ?? 0);
      row.push(metric?.averageVisible ?? 0);
    });

    return row;
  });
}

function buildOffNadirComparisonCsvRows(
  values: number[],
  pointsByElevation: Array<{ minElevationDeg: number; points: LineSweepPoint[] }>,
) {
  return values.map((value, index) => {
    const row: Array<string | number> = [value];
    pointsByElevation.forEach(({ points }) => {
      row.push(averageMetric(points[index]?.metrics ?? [], "visibleRatio"));
      row.push(averageMetric(points[index]?.metrics ?? [], "visibleHours"));
      row.push(averageMetric(points[index]?.metrics ?? [], "averageVisible"));
    });
    return row;
  });
}

function buildCountPlaneCsvRows(cells: CountPlaneCell[], stations: GroundStation[]) {
  return cells.map((cell) => {
    const row: Array<string | number> = [
      cell.count,
      cell.planes,
      averageMetric(cell.metrics, "visibleHours"),
      averageMetric(cell.metrics, "visibleRatio"),
      averageMetric(cell.metrics, "averageVisible"),
    ];

    stations.forEach((station) => {
      const metric = cell.metrics.find((item) => item.name === station.name);
      row.push(metric?.visibleHours ?? 0);
      row.push(metric?.visibleRatio ?? 0);
      row.push(metric?.averageVisible ?? 0);
    });

    return row;
  });
}

function describeVisibilityMode(stations: GroundStation[]): string {
  const modes = uniqueSorted(
    stations.map((station) =>
      station.visibilityMode === "and"
        ? 2
        : station.visibilityMode === "off_nadir_only"
          ? 1
          : 0,
    ),
  );
  if (modes.length === 1) {
    if (modes[0] === 0) return "elevation_only";
    if (modes[0] === 1) return "off_nadir_only";
    return "and";
  }
  return "mixed";
}

function describeOffNadirUsageForMinElevationSweep(stations: GroundStation[]): string {
  const modes = new Set(stations.map((station) => station.visibilityMode ?? "elevation_only"));

  if (modes.size === 1 && modes.has("elevation_only")) {
    return "Off-nadir not considered";
  }

  const offNadirValues = uniqueSorted(
    stations
      .map((station) => station.maxOffNadirDeg)
      .filter((value): value is number => value !== undefined),
  );
  if (offNadirValues.length === 0) {
    return "Off-nadir gate active with no explicit limit";
  }
  if (offNadirValues.length === 1) {
    return `Off-nadir fixed at ${offNadirValues[0]} deg`;
  }
  return `Off-nadir fixed per station (${offNadirValues.join(", ")} deg)`;
}

function describeGroundStations(stations: GroundStation[]): string {
  return stations
    .map((station) => `${station.name} (${round(station.latitudeDeg, 2)} deg lat)`)
    .join(", ");
}

function buildChartContextSubtitle(params: {
  shell: Required<ConstellationShellConfig>;
  stations: GroundStation[];
  extra: string;
}) {
  const { shell, stations, extra } = params;
  return `Constellation: count=${shell.count}, planes=${shell.planes}, altitude=${shell.apogee_altitude} km, inclination=${shell.inclination} deg. Stations: ${describeGroundStations(stations)}. ${extra}`;
}

function buildMarkdownSummary(params: {
  settingsPath: string;
  outputDir: string;
  stations: GroundStation[];
  baselineShell: Required<ConstellationShellConfig>;
  startTime: Date;
  baselineMetrics: StationMetric[];
  notes: string[];
}) {
  const {
    settingsPath,
    outputDir,
    stations,
    baselineShell,
    startTime,
    baselineMetrics,
    notes,
  } = params;
  const stationRows = baselineMetrics
    .map(
      (metric) =>
        `| ${metric.name} | ${metric.visibleHours} | ${metric.visibleRatio} | ${metric.averageVisible} |`,
    )
    .join("\n");

  return `# Visibility Sweep Report

- Settings: \`${settingsPath}\`
- Output directory: \`${outputDir}\`
- Start time: \`${startTime.toISOString()}\`
- Duration: ${DEFAULT_DURATION_HOURS} hours
- Step: ${DEFAULT_STEP_SECONDS} seconds
- Visibility mode: \`${describeVisibilityMode(stations)}\`
- Charts: visible ratio (%)

## Baseline

- Count: ${baselineShell.count}
- Planes: ${baselineShell.planes}
- Apogee altitude: ${baselineShell.apogee_altitude} km
- Inclination: ${baselineShell.inclination} deg
- Minimum elevation: ${stations[0]?.minElevationDeg ?? 0} deg
- Max off-nadir: ${stations[0]?.maxOffNadirDeg ?? "not set"} deg

| Station | Visible Hours | Visible Ratio (%) | Avg Visible Satellites |
| --- | ---: | ---: | ---: |
${stationRows}

## Outputs

- \`count_planes.csv\`
- \`count_planes.svg\`
- \`apogee_altitude.csv\`
- \`apogee_altitude.svg\`
- \`inclination.csv\`
- \`inclination.svg\`
- \`min_elevation.csv\`
- \`min_elevation.svg\`
- \`max_off_nadir.csv\`
- \`max_off_nadir.svg\`

## Charts

![Count and Planes](./count_planes.svg)

![Apogee Altitude Sweep](./apogee_altitude.svg)

![Inclination Sweep](./inclination.svg)

![Minimum Elevation Sweep](./min_elevation.svg)

![Max Off-Nadir Sweep](./max_off_nadir.svg)

## Notes

${notes.map((note) => `- ${note}`).join("\n")}
`;
}

async function main() {
  const settingsArg = process.argv[2];
  if (!settingsArg) {
    console.error("Usage: bun scripts/analyze-settings-visibility.ts <path/to/settings.toml>");
    process.exit(1);
  }

  const settingsPath = resolve(settingsArg);
  const settingsText = await Bun.file(settingsPath).text();
  const bundle = parseConfigBundle(settingsText);
  const constellationConfig = parseConstellationConfig(bundle.constText);
  const stations = bundle.groundStations;

  if (constellationConfig.shells.length === 0) {
    throw new Error("settings.toml must include at least one [[constellation.shells]] entry");
  }
  if (stations.length === 0) {
    throw new Error("settings.toml must include at least one [[groundstations]] entry");
  }

  const baselineShell = applyShellDefaults(constellationConfig.shells[0]);
  const outputDir = join(dirname(settingsPath), OUTPUT_DIR_NAME);
  await mkdir(outputDir, { recursive: true });

  const notes: string[] = [
    "The first constellation shell is used as the sweep target. Any additional shells remain fixed.",
    "Visible time is measured as the number of 60-second samples where at least one satellite is visible, converted to hours.",
    "The max off-nadir comparison chart forces both elevation and off-nadir gates active so the fixed 20/30/40 deg elevation lines can be compared directly.",
  ];

  const baselineConstellation = replaceSweepShell(constellationConfig, baselineShell);
  const baselineSatellites = buildSatellites(bundle.satText, baselineConstellation);
  const baselineMetrics = analyzeStations(
    baselineSatellites,
    stations,
    bundle.startTime,
  );

  const countValues = deriveCountValues(baselineShell.count);
  const planeValues = derivePlaneValues(baselineShell.planes);
  const countPlaneCells: CountPlaneCell[] = [];

  for (const count of countValues) {
    for (const planes of planeValues) {
      if (planes > count) continue;
      const satellites = buildSatellites(
        bundle.satText,
        replaceSweepShell(constellationConfig, {
          ...baselineShell,
          count,
          planes,
        }),
      );
      countPlaneCells.push({
        count,
        planes,
        metrics: analyzeStations(satellites, stations, bundle.startTime),
      });
    }
  }

  async function runLineSweep(
    key: LineSweepKey,
    values: number[],
    update: (value: number) => {
      constellation?: Required<ConstellationShellConfig>;
      stations?: GroundStation[];
    },
  ) {
    const points: LineSweepPoint[] = [];
    for (const value of values) {
      const next = update(value);
      const sweepStations =
        next.stations ??
        (key === "maxOffNadirDeg" ? applySweepMode(stations, key) : stations);
      const satellites = buildSatellites(
        bundle.satText,
        replaceSweepShell(constellationConfig, next.constellation ?? baselineShell),
      );
      points.push({
        value,
        metrics: analyzeStations(
          satellites,
          sweepStations,
          bundle.startTime,
        ),
      });
    }

    const header = [
      key,
      "avg_visible_hours",
      "avg_visible_ratio_pct",
      "avg_visible_satellites",
      ...stations.flatMap((station) => {
        const prefix = sanitizeName(station.name);
        return [
          `${prefix}_visible_hours`,
          `${prefix}_visible_ratio_pct`,
          `${prefix}_avg_visible_satellites`,
        ];
      }),
    ];
    await writeCsv(
      join(outputDir, `${sweepFileBaseName(key)}.csv`),
      header,
      buildLineSweepCsvRows(points, stations),
    );
    const title =
      key === "apogee_altitude"
        ? "Visible Ratio vs Apogee Altitude"
        : key === "inclination"
          ? "Visible Ratio vs Inclination"
          : key === "minElevationDeg"
            ? "Visible Ratio vs Minimum Elevation"
            : "Visible Ratio vs Max Off-Nadir";
    const xLabel =
      key === "apogee_altitude"
        ? "Apogee Altitude (km)"
        : key === "inclination"
          ? "Inclination (deg)"
          : key === "minElevationDeg"
            ? "Minimum Elevation (deg)"
            : "Max Off-Nadir (deg)";
    const subtitle =
      key === "apogee_altitude"
        ? buildChartContextSubtitle({
            shell: baselineShell,
            stations,
            extra: `Fixed planes=${baselineShell.planes}; fixed minimum elevation=${stations[0]?.minElevationDeg ?? 0} deg; fixed max off-nadir=${stations[0]?.maxOffNadirDeg ?? "not used"}.`,
          })
        : key === "inclination"
          ? buildChartContextSubtitle({
              shell: baselineShell,
              stations,
              extra: `Dense sampling is centered near station latitude ${round(Math.abs(stations[0]?.latitudeDeg ?? 0), 2)} deg. Fixed minimum elevation=${stations[0]?.minElevationDeg ?? 0} deg; fixed max off-nadir=${stations[0]?.maxOffNadirDeg ?? "not used"}.`,
            })
          : key === "minElevationDeg"
            ? buildChartContextSubtitle({
                shell: baselineShell,
                stations,
                extra: `${describeOffNadirUsageForMinElevationSweep(stations)}. Count=${baselineShell.count}, planes=${baselineShell.planes}, altitude=${baselineShell.apogee_altitude} km, inclination=${baselineShell.inclination} deg remain fixed.`,
              })
            : undefined;
    const xTickValues =
      key === "inclination"
        ? selectTickValuesBySpacing(values, 650, 52)
        : undefined;
    await Bun.write(
      join(outputDir, `${sweepFileBaseName(key)}.svg`),
      renderLineChart(
        title,
        xLabel,
        metricsToSeries(points, stations),
        subtitle,
        xTickValues,
      ),
    );
  }

  async function runOffNadirComparisonSweep(values: number[]) {
    const elevationBands = [20, 30, 40];
    const pointsByElevation: Array<{ minElevationDeg: number; points: LineSweepPoint[] }> = [];

    for (const minElevationDeg of elevationBands) {
      const sweepStations = applySweepMode(stations, "maxOffNadirDeg").map((station) => ({
        ...station,
        minElevationDeg,
      }));
      const points: LineSweepPoint[] = [];

      for (const value of values) {
        const satellites = buildSatellites(
          bundle.satText,
          replaceSweepShell(constellationConfig, baselineShell),
        );
        points.push({
          value,
          metrics: analyzeStations(
            satellites,
            sweepStations.map((station) => ({
              ...station,
              maxOffNadirDeg: value,
            })),
            bundle.startTime,
          ),
        });
      }

      pointsByElevation.push({ minElevationDeg, points });
    }

    await writeCsv(
      join(outputDir, "max_off_nadir.csv"),
      [
        "maxOffNadirDeg",
        ...elevationBands.flatMap((minElevationDeg) => [
          `min_el_${minElevationDeg}_avg_visible_ratio_pct`,
          `min_el_${minElevationDeg}_avg_visible_hours`,
          `min_el_${minElevationDeg}_avg_visible_satellites`,
        ]),
      ],
      buildOffNadirComparisonCsvRows(values, pointsByElevation),
    );

    await Bun.write(
      join(outputDir, "max_off_nadir.svg"),
      renderLineChart(
        "Visible Ratio vs Max Off-Nadir",
        "Max Off-Nadir (deg)",
        metricsToElevationSeries(pointsByElevation),
        buildChartContextSubtitle({
          shell: baselineShell,
          stations,
          extra: "Each line fixes minimum elevation at 20, 30, or 40 deg; off-nadir and elevation are both applied; count, planes, altitude, and base shell geometry remain fixed.",
        }),
        values,
      ),
    );
  }

  await writeCsv(
    join(outputDir, "count_planes.csv"),
    [
      "count",
      "planes",
      "avg_visible_hours",
      "avg_visible_ratio_pct",
      "avg_visible_satellites",
      ...stations.flatMap((station) => {
        const prefix = sanitizeName(station.name);
        return [
          `${prefix}_visible_hours`,
          `${prefix}_visible_ratio_pct`,
          `${prefix}_avg_visible_satellites`,
        ];
      }),
    ],
    buildCountPlaneCsvRows(countPlaneCells, stations),
  );
  await Bun.write(
    join(outputDir, "count_planes.svg"),
    renderHeatmap(
      "Average Visible Ratio by Count and Planes",
      countValues,
      planeValues,
      countPlaneCells,
      buildChartContextSubtitle({
        shell: baselineShell,
        stations,
        extra: `This chart sweeps count and planes; fixed altitude=${baselineShell.apogee_altitude} km, inclination=${baselineShell.inclination} deg, minimum elevation=${stations[0]?.minElevationDeg ?? 0} deg, max off-nadir=${stations[0]?.maxOffNadirDeg ?? "not used"}.`,
      }),
    ),
  );

  await runLineSweep("apogee_altitude", deriveAltitudeValues(baselineShell.apogee_altitude), (value) => ({
    constellation: {
      ...baselineShell,
      apogee_altitude: value,
    },
  }));

  await runLineSweep("inclination", deriveInclinationValuesAroundLatitude(baselineShell.inclination, stations[0]?.latitudeDeg ?? 0), (value) => ({
    constellation: {
      ...baselineShell,
      inclination: value,
    },
  }));

  await runLineSweep(
    "minElevationDeg",
    deriveMinElevationValues(stations[0]?.minElevationDeg ?? 0),
    (value) => ({
      stations: stations.map((station) => ({
        ...station,
        minElevationDeg: value,
      })),
    }),
  );

  await runOffNadirComparisonSweep(deriveOffNadirValues(stations[0]?.maxOffNadirDeg ?? 45));

  await Bun.write(
    join(outputDir, "summary.md"),
    buildMarkdownSummary({
      settingsPath: basename(settingsPath),
      outputDir: OUTPUT_DIR_NAME,
      stations,
      baselineShell,
      startTime: bundle.startTime,
      baselineMetrics,
      notes,
    }),
  );

  console.log(`Wrote visibility analysis to ${outputDir}`);
}

await main();
