import { FILING_CATALOG } from "./catalog";
import type { FilingConfiguration, FilingDataset, FilingRow, FilingTables } from "./types";

export const MAX_FILING_SATELLITES = 10000;
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function required(row: FilingRow, key: string): number {
  const value = number(row[key]);
  if (value === null) throw new Error(`軌道 ${String(row.orb_id ?? "?")} の ${key} がありません。SNS形式のMDBを選んでください。`);
  return value;
}
/** Keep configurations and action codes intact; never sum alternative configurations. */
export function parseFilingTables(tables: FilingTables, filename: string, sha256: string): FilingDataset {
  if (tables.non_geo.length !== 1 || tables.notice.length !== 1) throw new Error("1件の非静止衛星ネットワークを含むSNS MDBを選んでください。全体DB・GIMS・マスク用DBには対応していません。");
  if (!tables.orbit.length || tables.orbit.length > MAX_FILING_SATELLITES) throw new Error("軌道情報がないか、対応上限（10,000軌道面）を超えています。");
  const profile = FILING_CATALOG.find(item => item.sha256 === sha256);
  const configurations = new Map<string, FilingConfiguration>();
  const phases = new Map<string, Map<number, number>>();
  for (const row of tables.phase) {
    const planeId = number(row.orb_id), satId = number(row.orb_sat_id), angle = number(row.phase_ang);
    if (planeId === null || satId === null || angle === null) continue;
    const key = `${String(row.ntc_id)}:${planeId}`;
    if (!phases.has(key)) phases.set(key, new Map());
    const group = phases.get(key)!;
    if (group.has(satId)) throw new Error("衛星の位相IDが重複しています。対応する申請ファイルを確認してください。");
    group.set(satId, angle);
  }
  const seen = new Set<number>();
  let totalDeclared = 0;
  for (const row of tables.orbit) {
    const id = required(row, "orb_id");
    if (seen.has(id)) throw new Error("軌道面IDが重複しています。");
    seen.add(id);
    const satellites = required(row, "nbr_sat_pl");
    const inclination = required(row, "inclin_ang"), apogee = required(row, "apog_km"), perigee = required(row, "perig_km");
    if (!Number.isInteger(satellites) || satellites < 1 || satellites > MAX_FILING_SATELLITES || inclination < 0 || inclination > 180 || perigee < 100 || apogee < perigee || apogee > 100000) throw new Error(`軌道 ${id} の衛星数・高度・傾斜角が対応範囲外です。`);
    totalDeclared += satellites;
    if (totalDeclared > 100000) throw new Error("全構成の合計が100,000機を超えています。個別申請のSNS MDBを確認してください。");
    const configId = row.orbit_set_id == null ? "default" : String(row.orbit_set_id);
    let config = configurations.get(configId);
    if (!config) { config = { id: configId, planes: [], count: 0, hasSuppressedRows: false }; configurations.set(configId, config); }
    config.count += satellites;
    if (config.count > MAX_FILING_SATELLITES) throw new Error("1構成の表示上限は10,000機です。衛星の一部だけを自動で省略することはありません。");
    config.hasSuppressedRows ||= row.act_code === "S";
    const sourcePhases = phases.get(`${String(row.ntc_id)}:${id}`);
    config.planes.push({ id, satellites, inclination, apogee, perigee, ascendingLongitude: number(row.long_asc), argumentOfPerigee: number(row.perig_arg) ?? 0, action: String(row.act_code ?? ""), phases: Array.from({ length: satellites }, (_, i) => sourcePhases?.get(i + 1) ?? null) });
  }
  const list = [...configurations.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const warnings = ["受領された申請の配置です。承認・配備・運用を示しません。変更申請は元の申請全体を含まない場合があります。"];
  if (!profile) warnings.push("未レビューのファイルです。公式ページと添付注記を確認してください。削除・変更フラグは自動適用していません。");
  if (list.some(c => c.hasSuppressedRows)) warnings.push("削除フラグ（S）を含む構成があります。費用計算のための場合もあるので、添付注記を確認してから選択してください。");
  if (list.some(c => c.planes.some(p => p.ascendingLongitude === null || p.phases.some(v => v === null)))) warnings.push("昇交点の経度または位相が欠けています。欠損値は等間隔の仮配置で補います。");
  const date = tables.notice[0].d_rcv;
  return { key: `${String(tables.notice[0].adm ?? "UNKNOWN")}:${String(tables.non_geo[0].sat_name ?? "")}`, name: String(tables.non_geo[0].sat_name ?? "名称不明の申請"), filename, sha256, sourceUrl: profile?.url ?? "", reference: profile?.reference ?? "", sourceDate: profile?.date ?? (date instanceof Date ? date.toISOString().slice(0, 10) : ""), note: profile?.note ?? "", configurations: list, preferredConfiguration: profile?.preferredConfiguration ?? list.find(c => !c.hasSuppressedRows)?.id ?? list[0].id, warnings };
}
