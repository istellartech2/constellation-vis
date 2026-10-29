import { gstime } from "satellite.js";
import type { SatelliteSpec } from "../satellites";
import { addCatalogMeta, createCatalog, setCatalogRow, type SatelliteCatalog } from "../satelliteCatalog";
import type { FilingDataset } from "./types";
const normalize = (v: number) => ((v % 360) + 360) % 360;
const SPEC_MU_KM3_S2 = 398600.4418;
interface FilingElements { semiMajorAxisKm: number; eccentricity: number; inclinationDeg: number; raanDeg: number; argPerigeeDeg: number; meanAnomalyDeg: number }
/** Walk the declared geometry, one callback per satellite. */
function forEachFilingSatellite(dataset: FilingDataset, configuration: string, epoch: Date, visit: (planeId: number, index: number, el: FilingElements) => void): number {
  if (!Number.isFinite(epoch.valueOf())) throw new Error("仮配置の基準日時をUTCで指定してください。");
  const config = dataset.configurations.find(c => c.id === configuration);
  if (!config) throw new Error("選択した構成が見つかりません。");
  const gmst = gstime(epoch) * 180 / Math.PI;
  let count = 0;
  config.planes.forEach((plane, planeIndex) => {
    const a = 6378.137 + (plane.apogee + plane.perigee) / 2;
    const e = (plane.apogee - plane.perigee) / (2 * a);
    for (let i = 0; i < plane.satellites; i++) {
      // Assumption: phase is argument of latitude; convert true anomaly to mean anomaly.
      const nu = normalize((plane.phases[i] ?? 360 * i / plane.satellites) - plane.argumentOfPerigee) * Math.PI / 180;
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      visit(plane.id, i, { semiMajorAxisKm: a, eccentricity: e, inclinationDeg: plane.inclination, raanDeg: normalize(gmst + (plane.ascendingLongitude ?? 360 * planeIndex / config.planes.length)), argPerigeeDeg: plane.argumentOfPerigee, meanAnomalyDeg: normalize((E - e * Math.sin(E)) * 180 / Math.PI) });
      count++;
    }
  });
  return count;
}
/** A declared geometry at a user-chosen synthetic epoch, never an operational ephemeris. */
export function filingSatellites(dataset: FilingDataset, configuration: string, epoch: Date): SatelliteSpec[] {
  let syntheticId = 90000;
  const out: SatelliteSpec[] = [];
  forEachFilingSatellite(dataset, configuration, epoch, (planeId, i, el) => {
    out.push({ type: "elements", elements: { satnum: syntheticId++, epoch, ...el }, meta: { objectName: `${dataset.name} / 仮配置 ${configuration} / P${planeId}-${i + 1}`, dataStatus: "filing", filingKey: dataset.key, filingName: dataset.name, filingConfiguration: configuration, filingSource: dataset.sourceUrl, filingSha256: dataset.sha256 } });
  });
  return out;
}
/** First synthetic catalog number for filings placed as a large catalog (9 digits, never a NORAD id in use). */
export const FILING_CATALOG_SATNUM_BASE = 900_000_000;
/**
 * The same declared geometry as {@link filingSatellites}, written straight
 * into a columnar catalog so filings far beyond the editor's 10,000-ID
 * placeholder range (e.g. 10^5–10^6 satellites) stay compact.
 */
export function filingCatalog(dataset: FilingDataset, configuration: string, epoch: Date): SatelliteCatalog {
  const config = dataset.configurations.find(c => c.id === configuration);
  const cat = createCatalog(config?.planes.reduce((sum, p) => sum + p.satellites, 0) ?? 0);
  const metaIndex = addCatalogMeta(cat, { dataStatus: "filing", filingKey: dataset.key, filingName: dataset.name, filingConfiguration: configuration, filingSource: dataset.sourceUrl, filingSha256: dataset.sha256 });
  let row = 0;
  forEachFilingSatellite(dataset, configuration, epoch, (planeId, i, el) => {
    const nRadS = Math.sqrt(SPEC_MU_KM3_S2 / el.semiMajorAxisKm ** 3);
    setCatalogRow(cat, row, { ...el, satnum: FILING_CATALOG_SATNUM_BASE + row, epochMs: epoch.getTime(), meanMotionRevDay: nRadS * 86400 / (2 * Math.PI), name: `P${planeId}-${i + 1}`, metaIndex });
    row++;
  });
  return cat;
}
