import { comparisonScenarioInputs } from "./outages";
import {
  COMPARISON_MODEL_VERSION, comparisonInputKey, comparisonTargets, validateComparisonConditions,
  type ComparisonCase, type ComparisonConditions, type ComparisonDocument, type ComparisonTarget,
} from "../constellationComparison";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("比較ファイルの構造が不正です");
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("比較ファイルに不正な数値があります");
  return value;
}
function string(value: unknown, max = 120): string {
  if (typeof value !== "string" || value.length > max) throw new Error("比較ファイルに不正な文字列があります");
  return value;
}

/** Restore trusted inputs only. Archived results remain in the export; recalculate in this engine. */
export function parseComparisonDocument(text: string): ComparisonDocument {
  if (new TextEncoder().encode(text).byteLength > 10_000_000) throw new Error("比較ファイルは10 MB以下にしてください");
  const doc = object(JSON.parse(text));
  if (doc.format !== "constellation-comparison" || doc.version !== 1) throw new Error("対応していない比較ファイル形式です");
  const c = object(doc.conditions);
  const fov = c.fov === null ? null : object(c.fov);
  const conditions: ComparisonConditions = {
    startTimeIso: string(c.startTimeIso), durationHours: number(c.durationHours), stepSeconds: number(c.stepSeconds),
    minElevationDeg: number(c.minElevationDeg), requiredFold: number(c.requiredFold),
    targetAvailabilityPct: number(c.targetAvailabilityPct), maxGapMinutes: number(c.maxGapMinutes),
    fov: fov && { halfAngleDeg: number(fov.halfAngleDeg), alongTrackDeg: number(fov.alongTrackDeg), crossTrackDeg: number(fov.crossTrackDeg) },
  };
  validateComparisonConditions(conditions);
  conditions.startTimeIso = new Date(conditions.startTimeIso).toISOString();
  const t = object(doc.target);
  let target: ComparisonTarget;
  if (t.kind === "points") {
    if (!Array.isArray(t.points) || t.points.length > 400) throw new Error("地点リストが不正です");
    target = { kind: "points", points: t.points.map((p: unknown) => {
      const point = object(p);
      return { name: string(point.name), latitudeDeg: number(point.latitudeDeg), longitudeDeg: number(point.longitudeDeg) };
    }) };
  } else if (t.kind === "rectangle") {
    target = { kind: "rectangle", southDeg: number(t.southDeg), northDeg: number(t.northDeg),
      westDeg: number(t.westDeg), eastDeg: number(t.eastDeg), spacingDeg: number(t.spacingDeg) };
  } else throw new Error("地域の形式が不正です");
  comparisonTargets(target, conditions.minElevationDeg);
  if (!Array.isArray(doc.cases) || doc.cases.length > 6) throw new Error("設計案は6案以下にしてください");
  const ids = new Set<string>();
  const cases: ComparisonCase[] = doc.cases.map((value: unknown) => {
    const s = object(value);
    const id = string(s.id);
    const name = string(s.name).trim();
    if (!name) throw new Error("比較案の名前を入力してください");
    if (!id || ids.has(id)) throw new Error("設計案IDが重複または空欄です");
    ids.add(id);
    const o = s.outage === undefined ? null : object(s.outage);
    if (o && (!Array.isArray(o.disabledStationIndices) || o.disabledStationIndices.length > 200)) throw new Error("停止地上局の指定が不正です");
    const outage = o ? { failedSatelliteCount: number(o.failedSatelliteCount), seed: number(o.seed),
      disabledStationIndices: (o.disabledStationIndices as unknown[]).map(number) } : undefined;
    return { id, ...(outage ? { outage } : {}), name, satText: string(s.satText, 1_000_000), constText: string(s.constText, 1_000_000),
      gsText: string(s.gsText, 1_000_000) };
  });
  cases.forEach(comparisonScenarioInputs);
  return { format: "constellation-comparison", version: 1, conditions, target, cases };
}
export function serializeComparisonDocument(doc: ComparisonDocument): string {
  validateComparisonConditions(doc.conditions);
  comparisonTargets(doc.target, doc.conditions.minElevationDeg);
  const text = JSON.stringify(doc, null, 2);
  if (new TextEncoder().encode(text).byteLength > 10_000_000) throw new Error("保存ファイルが10 MBを超えます。案を減らして保存してください");
  return text;
}
export function currentComparisonResult(s: ComparisonCase, doc: Pick<ComparisonDocument, "conditions" | "target">) {
  return s.result?.modelVersion === COMPARISON_MODEL_VERSION
    && s.result.inputKey === comparisonInputKey(s, doc.conditions, doc.target) ? s.result : null;
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Standalone, script-free report. No imported names or TOML are interpreted as markup. */
export function comparisonReportHtml(doc: ComparisonDocument): string {
  const table = (headers: string[], rows: string[][]) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const rows = doc.cases.map((s) => {
    const r = currentComparisonResult(s, doc);
    return [s.name, r ? `${r.satelliteCount}/${r.nominalSatelliteCount}` : "—", r?.averageFoldAvailabilityPct.toFixed(3) ?? "—",
      r?.worstFoldAvailabilityPct.toFixed(3) ?? "—", r?.maxGapMin.toFixed(2) ?? "—", r?.networkAvailabilityPct.toFixed(3) ?? "—", r ? r.meetsRequirements ? "達成" : "未達" : "要再解析"];
  });
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>コンステレーション設計比較</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 16px;color:#17232d}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #c8d0d7;padding:8px;text-align:left}th{background:#edf2f6}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin-top:32px}</style><h1>コンステレーション設計比較</h1><p>モデル: ${COMPARISON_MODEL_VERSION} / 全時刻 UTC。幾何的なサンプル評価であり、連続時間の保証・電波性能・運用計画を含みません。</p><h2>共通条件</h2><pre>${escapeHtml(JSON.stringify({ conditions: doc.conditions, target: doc.target }, null, 2))}</pre>${table(["案", "稼働/元の衛星数", "平均要求達成率 %", "最悪地点 %", "最大要求未達時間 min", "地上局ネットワーク可用率 %", "判定（対象地点）"], rows)}${doc.cases.map((s) => {
    const r = currentComparisonResult(s, doc);
    return `<section><h2>${escapeHtml(s.name)}</h2>${r ? table(["地点", "緯度", "経度", "可用率 %", "要求同時可視達成率 %", "最大要求未達 min"], r.points.map((p) => [p.name, String(p.latitudeDeg), String(p.longitudeDeg), p.availabilityPct.toFixed(3), p.foldAvailabilityPct.toFixed(3), p.maxFoldGapMin.toFixed(2)])) : "<p>再解析が必要です。</p>"}<pre>${escapeHtml(JSON.stringify({ outage: s.outage ?? null, failedIndices: r?.failedSatelliteIndices ?? [] }, null, 2))}</pre><h3>地上局（別評価）</h3>${r ? table(["局", "可用率 %", "最大断 min"], r.stationSummaries.map((p) => [p.name, p.availabilityPct.toFixed(3), p.maxGapMin.toFixed(2)])) : ""}<details><summary>入力シナリオ</summary><pre>${escapeHtml([s.satText, s.constText, s.gsText].join("\n\n"))}</pre></details></section>`;
  }).join("")}</html>`;
}
