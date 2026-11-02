import { parse as parseToml } from "smol-toml";
import { parseConstellationToml, parseGroundStationsToml, parseSatellitesToml } from "../config";
import { parseConstellationConfig } from "../tomlParsers";
import { parseSatelliteEditorConfig } from "../satelliteEditorSerializer";
import { shellTotalSats } from "../constellationPatterns/registry";
import { socDesign } from "../constellationPatterns/streetsOfCoverage";
import { selectFailedIndices } from "../constellationPatterns/failure";
import type { ComparisonScenario } from "../constellationComparison";

/** Bound expansion before allocating satellite/plane arrays, including imported source. */
export function validateComparisonSourceSize(s: Pick<ComparisonScenario, "satText" | "constText" | "gsText">): void {
  if ([s.satText, s.constText, s.gsText].some((text) => text.length > 1_000_000)) throw new Error("各入力TOMLは1 MB以下にしてください");
  const raw = parseToml(s.satText);
  if (raw.satellites !== undefined && !Array.isArray(raw.satellites)) throw new Error("satellitesは配列テーブルにしてください");
  if (Array.isArray(raw.satellites)) for (const value of raw.satellites) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("type" in value)
      || !["tle", "elements", "geo", "formation"].includes(String(value.type))) throw new Error("衛星の形式を明示してください");
    if (value.type !== "tle" && (!("epoch" in value) || !Number.isFinite(Date.parse(String(value.epoch))))) {
      throw new Error("比較の再現性のため、TLE以外の衛星にはepochを明示してください");
    }
  }
  const manual = parseSatelliteEditorConfig(s.satText);
  let count = 0;
  for (const e of manual.entries) {
    const n = "deputyCount" in e ? e.deputyCount : 1;
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error("編隊の機数は0〜10,000の整数にしてください");
    count += n;
  }
  const config = parseConstellationConfig(s.constText);
  if (config.shells.length && !Number.isFinite(config.epoch.getTime())) throw new Error("コンステレーションのepochを明示してください");
  for (const shell of config.shells) {
    if (![shell.count, shell.planes].every((n) => Number.isFinite(n) && n >= 0 && n <= 10000)) throw new Error("シェルの機数・軌道面数は10,000以下にしてください");
    if (shell.pattern === "streets_of_coverage") {
      const design = socDesign(shell);
      if (design.feasible && (!Number.isFinite(design.count) || design.count > 10000 || design.planes > 10000)) throw new Error("自動設計されたシェルが10,000機を超えます");
    }
    count += shellTotalSats(shell);
  }
  if (!Number.isFinite(count) || count > 10000 || count < 0) throw new Error("比較対象は10,000機以下にしてください");
}

/** Additional failures of the satellites already present in the captured source. */
export interface ComparisonOutage {
  failedSatelliteCount: number;
  seed: number;
  disabledStationIndices: number[];
}
export function comparisonScenarioInputs(s: ComparisonScenario) {
  validateComparisonSourceSize(s);
  const nominalSatellites = [...parseSatellitesToml(s.satText), ...parseConstellationToml(s.constText)];
  const allStations = s.gsText ? parseGroundStationsToml(s.gsText) : [];
  if (!nominalSatellites.length) throw new Error("衛星データがありません");
  if (nominalSatellites.length > 10000) throw new Error("比較対象は10,000機以下にしてください");
  if (allStations.length > 200) throw new Error("地上局は200局以下にしてください");
  for (const st of allStations) {
    if (!st.name || ![st.latitudeDeg, st.longitudeDeg, st.heightKm, st.minElevationDeg].every(Number.isFinite)
      || Math.abs(st.latitudeDeg) > 90 || Math.abs(st.longitudeDeg) > 180
      || st.minElevationDeg < -90 || st.minElevationDeg > 90
      || st.maxOffNadirDeg !== undefined && (!Number.isFinite(st.maxOffNadirDeg) || st.maxOffNadirDeg < 0 || st.maxOffNadirDeg > 180)) {
      throw new Error(`地上局の座標・可視条件が不正です: ${st.name}`);
    }
  }
  const outage = s.outage ?? { failedSatelliteCount: 0, seed: 1, disabledStationIndices: [] };
  if (!Number.isInteger(outage.failedSatelliteCount) || outage.failedSatelliteCount < 0 || outage.failedSatelliteCount > nominalSatellites.length) {
    throw new Error(`故障機数は0〜${nominalSatellites.length}機の整数にしてください`);
  }
  if (!Number.isInteger(outage.seed) || outage.seed < 0 || outage.seed > 0xffffffff) throw new Error("故障seedは0〜4294967295の整数にしてください");
  const disabled = new Set(outage.disabledStationIndices);
  if (disabled.size !== outage.disabledStationIndices.length || [...disabled].some((i) => !Number.isInteger(i) || i < 0 || i >= allStations.length)) {
    throw new Error("停止地上局の指定が不正です");
  }
  const failedIndices = selectFailedIndices(nominalSatellites.length, outage.failedSatelliteCount, outage.seed);
  const failed = new Set(failedIndices);
  return {
    nominalSatellites, allStations, failedIndices,
    satellites: nominalSatellites.filter((_, i) => !failed.has(i)),
    stations: allStations.filter((_, i) => !disabled.has(i)),
    disabledStationNames: allStations.filter((_, i) => disabled.has(i)).map((st) => st.name),
  };
}
