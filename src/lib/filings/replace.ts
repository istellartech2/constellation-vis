import { expandSatelliteEditorConfig, parseSatelliteEditorConfig, serializeSatelliteEditorConfig } from "../satelliteEditorSerializer";
import { satellitesToToml } from "../../utils/celestrakUtils";
import { filingSatellites } from "./geometry";
import type { FilingDataset } from "./types";
/** Replace only this filing, preserving manual satellites, formations and other filings. */
export function replaceFilingText(text: string, dataset: FilingDataset, configuration: string, epoch: Date): string {
  const current = parseSatelliteEditorConfig(text);
  const retained = current.entries.filter(entry => entry.kind !== "manual" || entry.meta?.dataStatus !== "filing" || entry.meta.filingKey !== dataset.key);
  const used = new Set(expandSatelliteEditorConfig({ entries: retained }).map(s => s.type === "elements" ? s.elements.satnum : Number(s.lines[0].slice(2, 7))));
  const added = filingSatellites(dataset, configuration, epoch);
  let id = 90000;
  for (const sat of added) {
    while (used.has(id) && id <= 99999) id++;
    if (id > 99999) throw new Error("仮配置用の衛星IDが足りません。他の仮配置を減らしてから読み込んでください。");
    if (sat.type === "elements") sat.elements.satnum = id;
    used.add(id++);
  }
  return serializeSatelliteEditorConfig({ entries: [...retained, ...parseSatelliteEditorConfig(satellitesToToml(added)).entries] });
}
