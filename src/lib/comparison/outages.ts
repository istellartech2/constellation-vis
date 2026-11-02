import { parseConstellationToml, parseGroundStationsToml, parseSatellitesToml } from "../config";
import { selectFailedIndices } from "../constellationPatterns/failure";
import type { ComparisonScenario } from "../constellationComparison";

/** Additional failures of the satellites already present in the captured source. */
export interface ComparisonOutage {
  failedSatelliteCount: number;
  seed: number;
  disabledStationIndices: number[];
}
export function comparisonScenarioInputs(s: ComparisonScenario) {
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
