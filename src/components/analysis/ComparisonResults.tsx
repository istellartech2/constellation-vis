import type { ComparisonCase, ComparisonDocument } from "../../lib/constellationComparison";
import { currentComparisonResult } from "../../lib/comparison/document";

const cell = "px-3 py-2 border-b border-line text-left whitespace-nowrap";
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
interface Props { doc: ComparisonDocument; selectedId: string | null; onSelect: (id: string) => void; onRemove: (id: string) => void; disabled: boolean }
export default function ComparisonResults({ doc, selectedId, onSelect, onRemove, disabled }: Props) {
  const baseline = doc.cases[0] && currentComparisonResult(doc.cases[0], doc);
  const selected = doc.cases.find((s) => s.id === selectedId) ?? doc.cases[0];
  const result = selected && currentComparisonResult(selected, doc);
  return <div className="space-y-4">
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full text-sm tabular-nums"><caption className="p-2 text-left text-xs text-fg-muted">先頭案を基準に差分を表示。判定は全評価点の要求同時可視達成率と最大要求未達時間で行います。</caption>
        <thead><tr>{["設計案", "衛星数", "平均達成率", "最悪地点", "最大要求未達", "基準との差", "判定", "操作"].map((h) => <th key={h} scope="col" className={cell}>{h}</th>)}</tr></thead>
        <tbody>{doc.cases.map((s, i) => {
          const r = currentComparisonResult(s, doc);
          return <tr key={s.id} className={s.id === selected?.id ? "bg-brand-soft" : ""}>
            <th scope="row" className={cell}><button className="text-brand-text underline" onClick={() => onSelect(s.id)}>{s.name}{i === 0 ? "（基準）" : ""}</button></th>
            <td className={cell}>{r?.satelliteCount ?? "—"}</td>
            <td className={cell}>{r ? `${r.averageFoldAvailabilityPct.toFixed(2)}%` : "—"}</td>
            <td className={cell}>{r ? `${r.worstFoldAvailabilityPct.toFixed(2)}%` : "—"}</td>
            <td className={cell}>{r ? `${r.maxGapMin.toFixed(2)} min` : "—"}</td>
            <td className={cell}>{r && baseline && i > 0 ? `${signed(r.worstFoldAvailabilityPct - baseline.worstFoldAvailabilityPct)} pt / ${signed(r.maxGapMin - baseline.maxGapMin)} min` : "—"}</td>
            <td className={cell}>{r ? r.meetsRequirements ? "達成" : "未達" : s.result ? "条件変更・要再解析" : "未解析"}</td>
            <td className={cell}><button disabled={disabled} className="analysis-secondary-button" aria-label={`${s.name}を削除`} onClick={() => onRemove(s.id)}>削除</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {selected && <div className="rounded border border-line p-3 space-y-3">
      <h4 className="font-medium">{selected.name} の詳細</h4>
      {result ? <>
        <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums"><thead><tr>{["地点", "可用率（1機以上）", "要求同時可視達成率", "最大要求未達"].map((h) => <th scope="col" key={h} className={cell}>{h}</th>)}</tr></thead>
          <tbody>{result.points.map((p, i) => <tr key={i}><th scope="row" className={cell}>{p.name}</th><td className={cell}>{p.availabilityPct.toFixed(2)}%</td><td className={cell}>{p.foldAvailabilityPct.toFixed(2)}%</td><td className={cell}>{p.maxFoldGapMin.toFixed(2)} min</td></tr>)}</tbody></table></div>
        <details><summary className="cursor-pointer text-sm">地上局の評価（対象地域とは別評価・{result.stationCount}局）</summary>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col" className={cell}>局</th><th scope="col" className={cell}>可用率</th><th scope="col" className={cell}>最大断</th></tr></thead><tbody>{result.stationSummaries.map((s, i) => <tr key={i}><th scope="row" className={cell}>{s.name}</th><td className={cell}>{s.availabilityPct.toFixed(2)}%</td><td className={cell}>{s.maxGapMin.toFixed(2)} min</td></tr>)}</tbody></table></div>
        </details>
        {result.warnings.map((w) => <p key={w} className="text-xs text-fg-muted">{w}</p>)}
      </> : <p className="text-sm text-fg-muted">共通条件で解析すると、この案の地点別評価を表示します。</p>}
      <ScenarioInputs scenario={selected} />
    </div>}
  </div>;
}
function ScenarioInputs({ scenario }: { scenario: ComparisonCase }) {
  return <details><summary className="cursor-pointer text-sm text-fg-muted">この案に取り込んだ入力</summary>
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-sunken p-2 text-xs">{[scenario.satText, scenario.constText, scenario.gsText].join("\n\n")}</pre>
  </details>;
}
