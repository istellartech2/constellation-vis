import { parseFilingTables } from "./parse";
import type { FilingDataset, FilingRow, FilingTables } from "./types";

/**
 * A minimal subset of one SNS MDB, saved on the user's device so later sessions
 * can skip the heavy database. The app never bundles or uploads these files.
 */
export const FILING_EXTRACT_FORMAT = "constellation-vis/itu-filing-extract";
export const FILING_EXTRACT_VERSION = 1;
export const MAX_FILING_EXTRACT_BYTES = 16 * 1024 * 1024;
const COLUMNS: Record<keyof FilingTables, readonly string[]> = {
  notice: ["ntc_id", "adm", "d_rcv"],
  non_geo: ["ntc_id", "sat_name"],
  orbit: ["ntc_id", "orb_id", "orbit_set_id", "nbr_sat_pl", "inclin_ang", "apog_km", "perig_km", "long_asc", "perig_arg", "act_code"],
  phase: ["ntc_id", "orb_id", "orb_sat_id", "phase_ang"],
};
const TABLES = Object.keys(COLUMNS) as (keyof FilingTables)[];
export interface FilingExtract {
  format: typeof FILING_EXTRACT_FORMAT;
  version: typeof FILING_EXTRACT_VERSION;
  notice: string;
  source: { filename: string; sha256: string };
  tables: FilingTables;
}

function pick(row: FilingRow, columns: readonly string[]): FilingRow {
  const out: FilingRow = {};
  for (const key of columns) {
    const value = row[key];
    if (value instanceof Date) out[key] = value.toISOString();
    else if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
  }
  return out;
}
/** Keep only the columns the parser reads; frequency, beam and antenna tables are dropped. */
export function createFilingExtract(tables: FilingTables, filename: string, sha256: string): FilingExtract {
  return {
    format: FILING_EXTRACT_FORMAT,
    version: FILING_EXTRACT_VERSION,
    notice: "ITUの申請データ（SNS MDB）から抽出した軌道関連の値です。再配布はITUの利用条件に従ってください。承認・配備・運用を示しません。",
    source: { filename, sha256 },
    tables: Object.fromEntries(TABLES.map(name => [name, tables[name].map(row => pick(row, COLUMNS[name]))])) as unknown as FilingTables,
  };
}
export function filingExtractFilename(dataset: FilingDataset): string {
  const base = dataset.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "filing";
  return `${base}-${dataset.sha256.slice(0, 8)}.filing.json`;
}
/** Re-validate through the same parser as an MDB; the recorded hash is not proof the values are unmodified. */
export function parseFilingExtract(text: string): { dataset: FilingDataset; extract: FilingExtract } {
  if (text.length > MAX_FILING_EXTRACT_BYTES) throw new Error("抽出ファイルが大きすぎます（上限16 MB）。");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("抽出ファイルのJSONを読めませんでした。"); }
  const data = raw as Partial<FilingExtract> | null;
  if (data?.format !== FILING_EXTRACT_FORMAT) throw new Error("このアプリで保存した申請の抽出ファイル（.filing.json）を選んでください。");
  if (data.version !== FILING_EXTRACT_VERSION) throw new Error(`未対応の抽出ファイル版です（${String(data.version)}）。アプリを更新するか、MDBから保存し直してください。`);
  const source = data.source;
  if (typeof source?.filename !== "string" || typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error("抽出ファイルに元MDBの記録がありません。");
  const tables = {} as FilingTables;
  for (const name of TABLES) {
    const rows = (data.tables as Record<string, unknown> | undefined)?.[name];
    if (!Array.isArray(rows) || rows.some(row => typeof row !== "object" || row === null || Array.isArray(row))) throw new Error(`抽出ファイルの「${name}」が壊れています。`);
    tables[name] = rows.map(row => pick(row as FilingRow, COLUMNS[name]));
  }
  for (const row of tables.notice) {
    const date = typeof row.d_rcv === "string" ? new Date(row.d_rcv) : null;
    row.d_rcv = date && Number.isFinite(date.valueOf()) ? date : null;
  }
  const dataset = parseFilingTables(tables, source.filename, source.sha256);
  dataset.fromExtract = true;
  dataset.warnings.push("保存済みの抽出ファイルから読み込みました。元MDBとの一致はファイル内の記録のみで、改変の有無は検証していません。");
  return { dataset, extract: createFilingExtract(tables, source.filename, source.sha256) };
}
