import { computeAccessGrid, gridStationCounts } from "./accessGrid";
import { summarizeCounts, type AccessSummary } from "./accessMetrics";
import { parseConstellationToml, parseGroundStationsToml, parseSatellitesToml } from "./config";
import type { GroundStation } from "./groundStations";
import type { SatelliteFovCriteria } from "./visibility";

export const COMPARISON_MODEL_VERSION = "access-interval-v1";
export interface ComparisonConditions {
  startTimeIso: string;
  durationHours: number;
  stepSeconds: number;
  minElevationDeg: number;
  requiredFold: number;
  targetAvailabilityPct: number;
  maxGapMinutes: number;
  fov: SatelliteFovCriteria | null;
}
export type ComparisonTarget =
  | { kind: "points"; points: Array<{ name: string; latitudeDeg: number; longitudeDeg: number }> }
  | { kind: "rectangle"; southDeg: number; northDeg: number; westDeg: number; eastDeg: number; spacingDeg: number };
export interface ComparisonScenario {
  id: string;
  name: string;
  satText: string;
  constText: string;
  gsText: string;
}
export interface ComparisonPoint extends AccessSummary {
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  weight: number;
  foldAvailabilityPct: number;
  maxFoldGapMin: number;
}
export interface ComparisonResult {
  modelVersion: string;
  inputKey: string;
  satelliteCount: number;
  stationCount: number;
  averageAvailabilityPct: number;
  averageFoldAvailabilityPct: number;
  worstFoldAvailabilityPct: number;
  maxGapMin: number;
  meetsRequirements: boolean;
  points: ComparisonPoint[];
  stationSummaries: Array<AccessSummary & { name: string }>;
  warnings: string[];
}
export interface ComparisonCase extends ComparisonScenario { result?: ComparisonResult }
export interface ComparisonDocument {
  format: "constellation-comparison";
  version: 1;
  conditions: ComparisonConditions;
  target: ComparisonTarget;
  cases: ComparisonCase[];
}

export function defaultComparisonConditions(start: Date): ComparisonConditions {
  return { startTimeIso: start.toISOString(), durationHours: 24, stepSeconds: 30, minElevationDeg: 25,
    requiredFold: 1, targetAvailabilityPct: 99, maxGapMinutes: 30, fov: null };
}
export const DEFAULT_COMPARISON_TARGET: ComparisonTarget = {
  kind: "points", points: [
    { name: "東京", latitudeDeg: 35.68, longitudeDeg: 139.76 },
    { name: "札幌", latitudeDeg: 43.06, longitudeDeg: 141.35 },
    { name: "那覇", latitudeDeg: 26.21, longitudeDeg: 127.68 },
  ],
};

export function comparisonInputKey(scenario: ComparisonScenario, conditions: ComparisonConditions, target: ComparisonTarget): string {
  // Full input identity, not a lossy hash. Names and display state don't affect calculations.
  return JSON.stringify([COMPARISON_MODEL_VERSION, scenario.satText, scenario.constText, scenario.gsText, conditions, target]);
}

function finiteRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}: ${min}〜${max} の値を指定してください`);
}
export function validateComparisonConditions(c: ComparisonConditions): void {
  if (!Number.isFinite(Date.parse(c.startTimeIso))) throw new Error("開始時刻が不正です");
  finiteRange(c.durationHours, 1 / 60, 168, "期間 [h]");
  finiteRange(c.stepSeconds, 1, 600, "刻み [s]");
  finiteRange(c.minElevationDeg, 0, 89, "最低仰角");
  finiteRange(c.requiredFold, 1, 4, "要求同時可視数");
  if (!Number.isInteger(c.requiredFold)) throw new Error("要求同時可視数は整数にしてください");
  finiteRange(c.targetAvailabilityPct, 0, 100, "要求可用率");
  finiteRange(c.maxGapMinutes, 0, 10080, "許容最大断 [min]");
  if (c.fov) {
    finiteRange(c.fov.halfAngleDeg, 0.1, 90, "FOV半角");
    finiteRange(c.fov.alongTrackDeg, -90, 90, "Along-track");
    finiteRange(c.fov.crossTrackDeg, -90, 90, "Cross-track");
  }
}

export interface WeightedTarget { station: GroundStation; weight: number }
export function comparisonTargets(target: ComparisonTarget, minElevationDeg: number): WeightedTarget[] {
  const make = (name: string, latitudeDeg: number, longitudeDeg: number, weight: number): WeightedTarget => {
    if (!name.trim() || name.length > 120) throw new Error("地点名は1〜120文字にしてください");
    finiteRange(latitudeDeg, -90, 90, "緯度");
    finiteRange(longitudeDeg, -180, 180, "経度");
    return { station: { name, latitudeDeg, longitudeDeg, heightKm: 0, minElevationDeg }, weight };
  };
  if (target.kind === "points") {
    if (!target.points.length || target.points.length > 400) throw new Error("評価地点は1〜400地点にしてください");
    return target.points.map((p) => make(p.name, p.latitudeDeg, p.longitudeDeg, 1));
  }
  finiteRange(target.southDeg, -90, 90, "南端");
  finiteRange(target.northDeg, -90, 90, "北端");
  finiteRange(target.westDeg, -180, 180, "西端");
  finiteRange(target.eastDeg, -180, 180, "東端");
  finiteRange(target.spacingDeg, 0.25, 30, "地域の格子間隔");
  if (target.southDeg >= target.northDeg) throw new Error("北端は南端より北に指定してください");
  const width = (target.eastDeg - target.westDeg + 360) % 360;
  if (width === 0) throw new Error("東端と西端は異なる経度にしてください（最大360°未満）");
  const rows = Math.ceil((target.northDeg - target.southDeg) / target.spacingDeg);
  const columns = Math.ceil(width / target.spacingDeg);
  if (rows * columns > 400) throw new Error("地域の評価点が400点を超えます。格子間隔を大きくしてください");
  const out: WeightedTarget[] = [];
  const rad = Math.PI / 180;
  for (let row = 0; row < rows; row++) {
    const south = target.southDeg + row * target.spacingDeg;
    const north = Math.min(target.northDeg, south + target.spacingDeg);
    for (let col = 0; col < columns; col++) {
      const left = col * target.spacingDeg;
      const right = Math.min(width, left + target.spacingDeg);
      const lat = (south + north) / 2;
      const lon = ((target.westDeg + (left + right) / 2 + 540) % 360) - 180;
      // Spherical cell area (common R² cancels); partial edge cells get their actual area.
      const weight = (Math.sin(north * rad) - Math.sin(south * rad)) * (right - left) * rad;
      out.push(make(`${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon, weight));
    }
  }
  return out;
}

export function analyzeComparison(
  scenario: ComparisonScenario,
  conditions: ComparisonConditions,
  target: ComparisonTarget,
  onProgress?: (fraction: number) => void,
): ComparisonResult {
  validateComparisonConditions(conditions);
  const targets = comparisonTargets(target, conditions.minElevationDeg);
  const satellites = [...parseSatellitesToml(scenario.satText), ...parseConstellationToml(scenario.constText)];
  if (!satellites.length) throw new Error("衛星データがありません");
  if (satellites.length > 10000) throw new Error("比較対象は10,000機以下にしてください");
  const stations = scenario.gsText ? parseGroundStationsToml(scenario.gsText) : [];
  if (stations.length > 200) throw new Error("地上局は200局以下にしてください");
  const grid = computeAccessGrid(satellites, targets.map((p) => p.station), new Date(conditions.startTimeIso), {
    durationHours: conditions.durationHours, stepSeconds: conditions.stepSeconds, fov: conditions.fov ?? undefined, strictPropagation: true,
    onProgress: (f) => onProgress?.(f * 0.8),
  });
  const durationSeconds = conditions.durationHours * 3600;
  const points = targets.map(({ station, weight }, i): ComparisonPoint => {
    const counts = gridStationCounts(grid, i);
    const summary = summarizeCounts(counts, conditions.stepSeconds, durationSeconds);
    const fold = summarizeCounts(counts.map((n) => Number(n >= conditions.requiredFold)), conditions.stepSeconds, durationSeconds);
    return { ...summary, name: station.name, latitudeDeg: station.latitudeDeg, longitudeDeg: station.longitudeDeg,
      weight, foldAvailabilityPct: fold.availabilityPct, maxFoldGapMin: fold.maxGapMin };
  });
  // Ground stations describe the gateway network separately; target FOV does not constrain their antennas.
  const stationGrid = stations.length ? computeAccessGrid(satellites, stations, new Date(conditions.startTimeIso), {
    durationHours: conditions.durationHours, stepSeconds: conditions.stepSeconds, strictPropagation: true,
    onProgress: (f) => onProgress?.(0.8 + f * 0.2),
  }) : null;
  const stationSummaries = stations.map((s, i) => ({ name: s.name,
    ...summarizeCounts(gridStationCounts(stationGrid!, i), conditions.stepSeconds, durationSeconds) }));
  const weight = points.reduce((sum, p) => sum + p.weight, 0);
  const average = (value: (p: ComparisonPoint) => number) => points.reduce((sum, p) => sum + value(p) * p.weight, 0) / weight;
  const worstFoldAvailabilityPct = Math.min(...points.map((p) => p.foldAvailabilityPct));
  const maxGapMin = Math.max(...points.map((p) => p.maxFoldGapMin));
  onProgress?.(1);
  return {
    modelVersion: COMPARISON_MODEL_VERSION, inputKey: comparisonInputKey(scenario, conditions, target),
    satelliteCount: satellites.length, stationCount: stations.length,
    averageAvailabilityPct: average((p) => p.availabilityPct),
    averageFoldAvailabilityPct: average((p) => p.foldAvailabilityPct), worstFoldAvailabilityPct, maxGapMin,
    meetsRequirements: worstFoldAvailabilityPct >= conditions.targetAvailabilityPct && maxGapMin <= conditions.maxGapMinutes,
    points, stationSummaries,
    warnings: ["幾何的な可視機会のサンプル評価です。刻みより短い接触・中断は見落とす可能性があります。",
      "地上局は別評価です。対象地点から地上局までの同一衛星経由の接続・容量は保証しません。",
      ...(satellites.some((s) => s.type === "tle") ? ["TLEの実軌道精度は入力エポックと解析期間に依存します。"] : [])],
  };
}
