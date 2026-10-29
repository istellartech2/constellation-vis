import { gstime } from "satellite.js";
import type { SatelliteSpec } from "../satellites";
import type { FilingDataset } from "./types";
const normalize = (v: number) => ((v % 360) + 360) % 360;
/** A declared geometry at a user-chosen synthetic epoch, never an operational ephemeris. */
export function filingSatellites(dataset: FilingDataset, configuration: string, epoch: Date): SatelliteSpec[] {
  if (!Number.isFinite(epoch.valueOf())) throw new Error("仮配置の基準日時をUTCで指定してください。");
  const config = dataset.configurations.find(c => c.id === configuration);
  if (!config) throw new Error("選択した構成が見つかりません。");
  const gmst = gstime(epoch) * 180 / Math.PI;
  let syntheticId = 90000;
  return config.planes.flatMap((plane, planeIndex) => {
    const a = 6378.137 + (plane.apogee + plane.perigee) / 2;
    const e = (plane.apogee - plane.perigee) / (2 * a);
    return Array.from({ length: plane.satellites }, (_, i): SatelliteSpec => {
      // Assumption: phase is argument of latitude; convert true anomaly to mean anomaly.
      const nu = normalize((plane.phases[i] ?? 360 * i / plane.satellites) - plane.argumentOfPerigee) * Math.PI / 180;
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      return { type: "elements", elements: { satnum: syntheticId++, epoch, semiMajorAxisKm: a, eccentricity: e, inclinationDeg: plane.inclination, raanDeg: normalize(gmst + (plane.ascendingLongitude ?? 360 * planeIndex / config.planes.length)), argPerigeeDeg: plane.argumentOfPerigee, meanAnomalyDeg: normalize((E - e * Math.sin(E)) * 180 / Math.PI) }, meta: { objectName: `${dataset.name} / 仮配置 ${configuration} / P${plane.id}-${i + 1}`, dataStatus: "filing", filingKey: dataset.key, filingName: dataset.name, filingConfiguration: configuration, filingSource: dataset.sourceUrl, filingSha256: dataset.sha256 } };
    });
  });
}
