import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

type Row = Record<string, string>;

type Scenario = {
  id: string;
  label: string;
  count: number;
  planes: number;
  altitudeKm: number;
  csvPath: string;
  svgPath?: string;
  color: string;
};

type Point = {
  x: number;
  y: number;
};

const REPORT_DIR = resolve("local/report-assets");
const REPORT_MD = resolve("local/visibility_report_final.md");
const SVG_FONT_FAMILY = "Verdana, sans-serif";
const MAGICK_FONT_PATH = "/System/Library/Fonts/Supplemental/Verdana.ttf";
const BASE_MIN_ELEVATION_DEG = 30;

const scenarios: Scenario[] = [
  {
    id: "single_sat",
    label: "1 satellite, 1 plane, 600 km",
    count: 1,
    planes: 1,
    altitudeKm: 600,
    csvPath: resolve("local/visibility-analysis-single-sat/max_off_nadir.csv"),
    color: "#8b5cf6",
  },
  {
    id: "eight_sat_one_plane",
    label: "8 satellites, 1 plane, 600 km",
    count: 8,
    planes: 1,
    altitudeKm: 600,
    csvPath: resolve("local/visibility-analysis-8sat-1plane/max_off_nadir.csv"),
    svgPath: resolve("local/visibility-analysis-8sat-1plane/max_off_nadir.svg"),
    color: "#2563eb",
  },
  {
    id: "eight_sat_eight_planes",
    label: "8 satellites, 8 planes, 600 km",
    count: 8,
    planes: 8,
    altitudeKm: 600,
    csvPath: resolve("local/visibility-analysis-8sat-8planes/max_off_nadir.csv"),
    color: "#dc2626",
  },
  {
    id: "eight_sat_one_plane_1000km",
    label: "8 satellites, 1 plane, 1000 km",
    count: 8,
    planes: 1,
    altitudeKm: 1000,
    csvPath: resolve("local/visibility-analysis-8sat-1plane-1000km/max_off_nadir.csv"),
    svgPath: resolve("local/visibility-analysis-8sat-1plane-1000km/max_off_nadir.svg"),
    color: "#059669",
  },
  {
    id: "ninety_six_sat",
    label: "96 satellites, 8 planes, 600 km",
    count: 96,
    planes: 8,
    altitudeKm: 600,
    csvPath: resolve("local/visibility-analysis/max_off_nadir.csv"),
    color: "#d97706",
  },
];

function escapeSvgText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrapSvgText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function readCsv(path: string): Promise<Row[]> {
  const text = await Bun.file(path).text();
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return Object.fromEntries(header.map((key, index) => [key, cols[index] ?? ""]));
  });
}

function numberAt(row: Row, key: string): number {
  return Number(row[key]);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function minElevationSeries(
  rows: Row[],
  minElevationDeg: number,
  name: string,
  color: string,
): { name: string; color: string; points: Point[] } {
  return {
    name,
    color,
    points: rows.map((row) => ({
      x: numberAt(row, "maxOffNadirDeg"),
      y: numberAt(row, `min_el_${minElevationDeg}_avg_visible_ratio_pct`),
    })),
  };
}

function renderLineComparisonSvg(params: {
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  series: Array<{ name: string; color: string; points: Point[] }>;
}): string {
  const { title, subtitle, xLabel, yLabel, series } = params;
  const width = 980;
  const height = 520;
  const subtitleLines = wrapSvgText(subtitle, 120);
  const margin = {
    top: 44 + subtitleLines.length * 16 + 14,
    right: 250,
    bottom: 70,
    left: 80,
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

  const xTicks = [...new Set(xValues)].sort((a, b) => a - b).map((value) => {
    const x = xScale(value);
    return `<line x1="${x}" y1="${margin.top + innerHeight}" x2="${x}" y2="${margin.top + innerHeight + 6}" stroke="#374151" />
<text x="${x}" y="${height - 24}" text-anchor="middle" font-size="12" fill="#4b5563">${value}</text>`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = yMax * (1 - ratio);
    const y = margin.top + innerHeight * ratio;
    return `<line x1="${margin.left}" y1="${y}" x2="${margin.left + innerWidth}" y2="${y}" stroke="#d1d5db" stroke-dasharray="4 4" />
<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#4b5563">${value.toFixed(1)}</text>`;
  });

  const lineMarkup = series
    .map((item) => {
      const segments = item.points
        .slice(0, -1)
        .map((point, index) => {
          const next = item.points[index + 1];
          return `<line x1="${xScale(point.x)}" y1="${yScale(point.y)}" x2="${xScale(next.x)}" y2="${yScale(next.y)}" stroke="${item.color}" stroke-width="2.5" />`;
        })
        .join("");
      const circles = item.points
        .map((point) => `<circle cx="${xScale(point.x)}" cy="${yScale(point.y)}" r="3.4" fill="${item.color}" />`)
        .join("");
      return `${segments}${circles}`;
    })
    .join("\n");

  const legend = series
    .map((item, index) => {
      const y = margin.top + index * 24;
      return `<rect x="${width - 220}" y="${y - 10}" width="14" height="14" fill="${item.color}" />
<text x="${width - 198}" y="${y + 2}" font-size="12" fill="#111827">${escapeSvgText(item.name)}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SVG_FONT_FAMILY}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${margin.left}" y="26" font-size="22" font-weight="700" fill="#111827">${escapeSvgText(title)}</text>
  <text x="${margin.left}" y="50" font-size="12" fill="#4b5563">${subtitleLines
    .map((line, index) => `<tspan x="${margin.left}" dy="${index === 0 ? 0 : 16}">${escapeSvgText(line)}</tspan>`)
    .join("")}</text>
  <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${margin.left + innerWidth}" y2="${margin.top + innerHeight}" stroke="#374151" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}" stroke="#374151" />
  ${yTicks.join("\n  ")}
  ${xTicks.join("\n  ")}
  ${lineMarkup}
  ${legend}
  <text x="${margin.left + innerWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="13" fill="#374151">${escapeSvgText(xLabel)}</text>
  <text x="22" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 22 ${margin.top + innerHeight / 2})">${escapeSvgText(yLabel)}</text>
</svg>`;
}

function renderBarComparisonSvg(params: {
  title: string;
  subtitle: string;
  yLabel: string;
  bars: Array<{ label: string; value: number; color: string }>;
}): string {
  const { title, subtitle, yLabel, bars } = params;
  const width = 980;
  const height = 540;
  const subtitleLines = wrapSvgText(subtitle, 120);
  const margin = {
    top: 44 + subtitleLines.length * 16 + 14,
    right: 40,
    bottom: 110,
    left: 80,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...bars.map((bar) => bar.value), 0.1);
  const barWidth = innerWidth / Math.max(1, bars.length) * 0.7;
  const gap = innerWidth / Math.max(1, bars.length) * 0.3;

  const yScale = (value: number) =>
    margin.top + innerHeight - (value / maxValue) * innerHeight;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = maxValue * (1 - ratio);
    const y = margin.top + innerHeight * ratio;
    return `<line x1="${margin.left}" y1="${y}" x2="${margin.left + innerWidth}" y2="${y}" stroke="#d1d5db" stroke-dasharray="4 4" />
<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#4b5563">${value.toFixed(1)}</text>`;
  });

  const barMarkup = bars
    .map((bar, index) => {
      const x = margin.left + index * (barWidth + gap) + gap / 2;
      const y = yScale(bar.value);
      const h = margin.top + innerHeight - y;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${bar.color}" />
<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" fill="#111827">${bar.value.toFixed(1)}</text>
<text x="${x + barWidth / 2}" y="${height - 46}" text-anchor="end" font-size="11" fill="#4b5563" transform="rotate(-35 ${x + barWidth / 2} ${height - 46})">${escapeSvgText(bar.label)}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SVG_FONT_FAMILY}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${margin.left}" y="26" font-size="22" font-weight="700" fill="#111827">${escapeSvgText(title)}</text>
  <text x="${margin.left}" y="50" font-size="12" fill="#4b5563">${subtitleLines
    .map((line, index) => `<tspan x="${margin.left}" dy="${index === 0 ? 0 : 16}">${escapeSvgText(line)}</tspan>`)
    .join("")}</text>
  <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${margin.left + innerWidth}" y2="${margin.top + innerHeight}" stroke="#374151" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}" stroke="#374151" />
  ${yTicks.join("\n  ")}
  ${barMarkup}
  <text x="22" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 22 ${margin.top + innerHeight / 2})">${escapeSvgText(yLabel)}</text>
</svg>`;
}

async function convertSvgToPng(svgPath: string, pngPath: string) {
  const result = Bun.spawnSync(["magick", "-font", MAGICK_FONT_PATH, svgPath, pngPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to convert ${svgPath} to PNG: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
}

function ratioAt45(rows: Row[]): number {
  const target = rows.find((row) => Number(row.maxOffNadirDeg) === 45);
  if (!target) throw new Error("No 45 deg row found");
  return numberAt(target, `min_el_${BASE_MIN_ELEVATION_DEG}_avg_visible_ratio_pct`);
}

function ratioAt(rows: Row[], offNadirDeg: number): number {
  const target = rows.find((row) => Number(row.maxOffNadirDeg) === offNadirDeg);
  if (!target) throw new Error(`No ${offNadirDeg} deg row found`);
  return numberAt(target, `min_el_${BASE_MIN_ELEVATION_DEG}_avg_visible_ratio_pct`);
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  const scenarioRows = await Promise.all(
    scenarios.map(async (scenario) => ({
      scenario,
      rows: await readCsv(scenario.csvPath),
    })),
  );

  const comparisonSeries = scenarioRows.map(({ scenario, rows }) => ({
    name: scenario.label,
    color: scenario.color,
    points: rows.map((row) => ({
      x: numberAt(row, "maxOffNadirDeg"),
      y: numberAt(row, `min_el_${BASE_MIN_ELEVATION_DEG}_avg_visible_ratio_pct`),
    })),
  }));

  const lineSvg = renderLineComparisonSvg({
    title: "Scenario Comparison: Visible Ratio vs Max Off-Nadir",
    subtitle:
      `All curves use the Tokyo ground station, min elevation ${BASE_MIN_ELEVATION_DEG} deg, and the same analysis horizon. The chart compares how satellite count, plane distribution, and altitude change the off-nadir sensitivity.`,
    xLabel: "Max Off-Nadir (deg)",
    yLabel: "Visible Ratio (%)",
    series: comparisonSeries,
  });
  const lineSvgPath = join(REPORT_DIR, "scenario_comparison_off_nadir.svg");
  const linePngPath = join(REPORT_DIR, "scenario_comparison_off_nadir.png");
  await Bun.write(lineSvgPath, lineSvg);
  await convertSvgToPng(lineSvgPath, linePngPath);

  const barSvg = renderBarComparisonSvg({
    title: "Visible Ratio at 45 deg Off-Nadir",
    subtitle:
      `This comparison fixes max off-nadir at 45 deg and min elevation at ${BASE_MIN_ELEVATION_DEG} deg, then compares the visible ratio across scenario configurations.`,
    yLabel: "Visible Ratio (%)",
    bars: scenarioRows.map(({ scenario, rows }) => ({
      label: scenario.label,
      value: ratioAt45(rows),
      color: scenario.color,
    })),
  });
  const barSvgPath = join(REPORT_DIR, "scenario_comparison_at_45deg.svg");
  const barPngPath = join(REPORT_DIR, "scenario_comparison_at_45deg.png");
  await Bun.write(barSvgPath, barSvg);
  await convertSvgToPng(barSvgPath, barPngPath);

  const baseRows = scenarioRows.find(({ scenario }) => scenario.id === "eight_sat_one_plane")!.rows;
  const base1000Rows = scenarioRows.find(
    ({ scenario }) => scenario.id === "eight_sat_one_plane_1000km",
  )!.rows;

  const baseCaseSvg = renderLineComparisonSvg({
    title: "Base Case: Visible Ratio vs Max Off-Nadir",
    subtitle:
      "Base scenario is 8 satellites, 1 plane, 600 km altitude, inclination 43 deg, Tokyo ground station. Lines show minimum elevation 20, 30, and 40 deg.",
    xLabel: "Max Off-Nadir (deg)",
    yLabel: "Visible Ratio (%)",
    series: [
      minElevationSeries(baseRows, 20, "Min elevation 20 deg", "#2563eb"),
      minElevationSeries(baseRows, 30, "Min elevation 30 deg", "#d97706"),
      minElevationSeries(baseRows, 40, "Min elevation 40 deg", "#059669"),
    ],
  });
  const baseCaseSvgPath = join(REPORT_DIR, "base_8sat_1plane_max_off_nadir.svg");
  const baseCasePngPath = join(REPORT_DIR, "base_8sat_1plane_max_off_nadir.png");
  await Bun.write(baseCaseSvgPath, baseCaseSvg);
  await convertSvgToPng(baseCaseSvgPath, baseCasePngPath);

  const alt1000CaseSvg = renderLineComparisonSvg({
    title: "1000 km Case: Visible Ratio vs Max Off-Nadir",
    subtitle:
      "Scenario is 8 satellites, 1 plane, 1000 km altitude, inclination 43 deg, Tokyo ground station. Lines show minimum elevation 20, 30, and 40 deg.",
    xLabel: "Max Off-Nadir (deg)",
    yLabel: "Visible Ratio (%)",
    series: [
      minElevationSeries(base1000Rows, 20, "Min elevation 20 deg", "#2563eb"),
      minElevationSeries(base1000Rows, 30, "Min elevation 30 deg", "#d97706"),
      minElevationSeries(base1000Rows, 40, "Min elevation 40 deg", "#059669"),
    ],
  });
  const alt1000SvgPath = join(REPORT_DIR, "base_8sat_1plane_1000km_max_off_nadir.svg");
  const alt1000PngPath = join(REPORT_DIR, "base_8sat_1plane_1000km_max_off_nadir.png");
  await Bun.write(alt1000SvgPath, alt1000CaseSvg);
  await convertSvgToPng(alt1000SvgPath, alt1000PngPath);

  const lookup = Object.fromEntries(
    scenarioRows.map(({ scenario, rows }) => [
      scenario.id,
      {
        at45: ratioAt45(rows),
        at55: ratioAt(rows, 55),
        at60: ratioAt(rows, 60),
      },
    ]),
  );

  const report = `# 通信衛星の可視範囲変化に関する解析報告

## 1. 要旨

本報告では、通信衛星コンステレーションの可視範囲が最低仰角とオフナディア角の条件でどのように変化するかを、\`constellation-vis\` の解析スクリプトを用いて評価した。主ケースは \`settings_8sat_1plane.toml\` とし、東京地上局を対象に 24 時間・60 秒刻みで可視率を算出した。

結論として、8 機 1 軌道面・高度 600 km の条件では、最低仰角を 30 度とした場合、可視率はオフナディア角 45 度で **${round1(lookup.eight_sat_one_plane.at45).toFixed(1)} %**、55 度で **${round1(lookup.eight_sat_one_plane.at55).toFixed(1)} %**、60 度で **${round1(lookup.eight_sat_one_plane.at60).toFixed(1)} %** であった。すなわち、45 度から 55 度へ拡張すると可視率は **${round1(lookup.eight_sat_one_plane.at55 - lookup.eight_sat_one_plane.at45).toFixed(1)} ポイント**増加し、約 **${round1(lookup.eight_sat_one_plane.at55 / lookup.eight_sat_one_plane.at45).toFixed(1)} 倍**となる。60 度では 55 度からの追加改善はほぼ見られず、主改善は 45 度から 55 度への拡張で得られる。

また、感度確認のため 1 機、8 機 8 軌道面、96 機 8 軌道面、および 8 機 1 軌道面・高度 1000 km を比較した。その結果、機数増加と高度上昇はいずれも可視率を押し上げるが、同じ 8 機でも 1 面配置と 8 面配置の差は限定的であり、高度 1000 km 化の効果のほうが大きいことが確認された。

## 2. 目的

本解析の目的は次の 2 点である。

1. 通信衛星の可視範囲が、最低仰角とオフナディア角の条件変更によってどのように変化するかを定量化すること。
2. 衛星機数、軌道面構成、高度の違いがオフナディア角感度に与える影響を比較し、設計検討時の論点を明確にすること。

## 3. 解析対象と条件

主解析条件は \`local/settings_8sat_1plane.toml\` である。条件は「8 機、1 軌道面、高度 600 km、傾斜角 43 度、東京地上局、最低仰角 30 度」である。比較ケースは以下の 4 条件とした。

| ケース | 設定ファイル | 機数 | 軌道面 | 高度 |
| --- | --- | ---: | ---: | ---: |
| 主ケース | \`local/settings_8sat_1plane.toml\` | 8 | 1 | 600 km |
| 比較1 | \`local/settings_single_sat.toml\` | 1 | 1 | 600 km |
| 比較2 | \`local/settings_8sat_8planes.toml\` | 8 | 8 | 600 km |
| 比較3 | \`local/settings.toml\` | 96 | 8 | 600 km |
| 比較4 | \`local/settings_8sat_1plane_1000km.toml\` | 8 | 1 | 1000 km |

全ケースで開始時刻は \`2026-04-19T15:53:00Z\`、解析時間は 24 時間、時間刻みは 60 秒で統一した。地上局最低仰角 30 度は、従来の 40 度設定より実運用に近い基準として採用した。

## 4. 可視性判断ロジック

本解析での可視判定は、\`src/lib/visibility.ts\` に実装された以下のロジックに基づく。

1. 各時刻について衛星軌道を伝搬し、衛星位置を地球固定座標系へ変換する。
2. 地上局位置から見た衛星の仰角を計算する。
3. 衛星位置から地球中心方向ベクトルと、衛星から地上局方向ベクトルのなす角をオフナディア角として計算する。
4. 仰角が最低仰角以上、かつオフナディア角が設定上限以下である場合を可視と判定する。
5. 24 時間の全サンプルのうち、可視であった時間割合を \`Visible Ratio\` として集計する。

したがって、最低仰角は地上局側の受信条件、オフナディア角は衛星側の指向許容条件を表し、本報告の可視率はその両方を満たした時間の割合である。

## 5. 結果

### 5.1 主ケース: 8 機 1 軌道面・600 km

図1に主ケースの \`Visible Ratio vs Max Off-Nadir\` を示す。図には最低仰角 20 度、30 度、40 度の 3 条件を重ねている。最低仰角 30 度の条件では、可視率は 45 度で **${round1(lookup.eight_sat_one_plane.at45).toFixed(1)} %**、55 度で **${round1(lookup.eight_sat_one_plane.at55).toFixed(1)} %**、60 度で **${round1(lookup.eight_sat_one_plane.at60).toFixed(1)} %** である。

![図1 主ケースのオフナディア角感度](./report-assets/base_8sat_1plane_max_off_nadir.png)

最低仰角 20 度では 45 度から 60 度まで拡張するとさらに可視率が伸びる一方、40 度では 45 度時点でほぼ飽和している。したがって、最低仰角 30 度を前提とするなら、現在のオフナディア角 45 度設定よりも 55 度まで拡張したほうが可視性は明確に向上する。60 度では 55 度からの改善は小さく、実質的な改善幅は 45 度から 55 度への拡張でほぼ取り切れている。

### 5.2 比較ケース間の感度差

図2に、最低仰角 30 度固定時の \`Visible Ratio vs Max Off-Nadir\` をケース間で比較した。1 機では全域で可視率が低く、8 機 1 軌道面と 8 機 8 軌道面はほぼ同水準で推移する。96 機 8 軌道面は全域で可視率が高く、8 機 1 軌道面でも高度を 1000 km に上げると 600 km 条件より明確な改善が得られる。

![図2 ケース別オフナディア角感度比較](./report-assets/scenario_comparison_off_nadir.png)

図3に、最低仰角 30 度・最大オフナディア角 45 度での可視率比較を示す。主ケース 8 機 1 軌道面・600 km は **${round1(lookup.eight_sat_one_plane.at45).toFixed(1)} %**、同じ 8 機で 8 軌道面化すると **${round1(lookup.eight_sat_eight_planes.at45).toFixed(1)} %**、高度を 1000 km にすると **${round1(lookup.eight_sat_one_plane_1000km.at45).toFixed(1)} %**、96 機 8 軌道面では **${round1(lookup.ninety_six_sat.at45).toFixed(1)} %** であった。

![図3 オフナディア角45度時の可視率比較](./report-assets/scenario_comparison_at_45deg.png)

### 5.3 高度 1000 km ケース

図4に 8 機 1 軌道面・高度 1000 km の主グラフを示す。図には最低仰角 20 度、30 度、40 度の 3 条件を重ねている。600 km 条件では 45 度・30 度仰角で **${round1(lookup.eight_sat_one_plane.at45).toFixed(1)} %** であったのに対し、1000 km 条件では **${round1(lookup.eight_sat_one_plane_1000km.at45).toFixed(1)} %** まで増加した。高度増加は可視領域の幾何学的拡大に直結しており、同機数条件でも可視率を大きく押し上げる。

![図4 高度1000 kmケースのオフナディア角感度](./report-assets/base_8sat_1plane_1000km_max_off_nadir.png)

## 6. 考察

1. 主ケースでは、最低仰角 30 度を前提とすると、オフナディア角を 45 度から 55 度へ拡張することで可視率は **${round1(lookup.eight_sat_one_plane.at55 - lookup.eight_sat_one_plane.at45).toFixed(1)} ポイント**改善する。したがって、現在 45 度を上限としているなら、55 度までの拡張は検討価値が高い。
2. 最低仰角 20 度では、主ケースの可視率は 45 度で **3.7 %**、55 度で **10.1 %**、60 度で **14.4 %** となり、60 度まで緩和した効果がなお残る。一方で最低仰角 40 度では 45 度で **3.5 %**、55 度でも **3.5 %**、60 度でも **3.5 %** であり、オフナディア角を広げても改善しにくい。したがって、オフナディア角の有効性は最低仰角条件に依存する。
3. 高度 1000 km の 8 機 1 面条件では、最低仰角 30 度の可視率は 45 度で **${round1(lookup.eight_sat_one_plane_1000km.at45).toFixed(1)} %**、55 度で **${round1(lookup.eight_sat_one_plane_1000km.at55).toFixed(1)} %**、60 度で **${round1(lookup.eight_sat_one_plane_1000km.at60).toFixed(1)} %** である。600 km より全体水準が高く、45 度から 55 度への改善量も大きい。
4. 8 機の条件では、1 面配置と 8 面配置の差は小さい。今回の東京単地点評価では、軌道面配分よりも機数そのものと高度の影響が支配的であった。
5. 高度 1000 km 化は、8 機 1 面構成でも 600 km 条件より大きな改善を与えた。可視率重視であれば、高度は有力な設計パラメータである。ただし高高度化は遅延、打上げ制約、軌道維持条件など別の設計制約とトレードになるため、本報告では可視率面のみを扱う。

## 7. 限界と今後の課題

- 本解析は東京地上局 1 局での単地点評価であり、複数局ネットワークや全球評価では結論の強弱が変わり得る。
- 時間窓は 24 時間であり、長周期差や繰返し地上軌跡の影響は別途評価が必要である。
- オフナディア角の実装は衛星から地球中心方向に対する角度であり、個別アンテナパターンや実機指向制約の詳細モデルは含んでいない。
- 今後は、複数地上局、通信容量制約、リンクバジェット制約を加えた評価に拡張することで、運用要求に直結した設計比較に発展できる。

`;

  await Bun.write(REPORT_MD, report);
  console.log(`Generated report assets in ${REPORT_DIR}`);
  console.log(`Generated report markdown at ${REPORT_MD}`);
}

await main();
