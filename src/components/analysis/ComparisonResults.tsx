import { useState } from "react";
import type { ComparisonCase, ComparisonDocument, ComparisonResult } from "../../lib/constellationComparison";
import { currentComparisonResult } from "../../lib/comparison/document";

const cell = "px-3 py-2 border-b border-line text-left";
const signed = (n: number, unit: string) => `${n > 0 ? "+" : ""}${n.toFixed(2)} ${unit}`;
const status = (s: ComparisonCase, r: ComparisonResult | null) => r ? r.meetsRequirements ? "達成" : "未達" : s.result ? "条件変更・要再解析" : "未解析";
interface Props {
  doc: ComparisonDocument; selectedId: string | null; onSelect: (id: string) => void;
  onRemove: (id: string) => void; onMakeBaseline: (id: string) => void;
  onCreateVariant: () => void; onTimeline: () => void; disabled: boolean;
}
export default function ComparisonResults({ doc, selectedId, onSelect, onRemove, onMakeBaseline, onCreateVariant, onTimeline, disabled }: Props) {
  const baseline = doc.cases[0] && currentComparisonResult(doc.cases[0], doc);
  const selected = doc.cases.find((s) => s.id === selectedId) ?? doc.cases[0];
  const result = selected && currentComparisonResult(selected, doc);
  return <div className="space-y-4">
    <p className="text-xs text-fg-muted">平均は地点の等重み／地域の面積加重です。判定は全評価点で「要求同時可視数・可用率」と「許容未達時間」を満たすかで決まります。地上局は別評価です。</p>
    <div className="hidden overflow-x-auto rounded border border-line md:block">
      <table className="w-full text-sm tabular-nums"><caption className="p-2 text-left text-xs text-fg-muted">案名を選ぶと差分と詳細を表示します。基準: {doc.cases[0]?.name}</caption>
        <thead><tr>{["設計案", "稼働/入力機数", "平均達成率", "最悪地点の達成率", "最大未達時間", "判定"].map((h) => <th key={h} scope="col" className={cell}>{h}</th>)}</tr></thead>
        <tbody>{doc.cases.map((s, i) => {
          const r = currentComparisonResult(s, doc);
          return <tr key={s.id} className={s.id === selected?.id ? "bg-brand-soft" : ""}>
            <th scope="row" className={`${cell} max-w-64 break-words`}><button className="min-h-10 text-left text-brand-text underline" aria-pressed={s.id === selected?.id} onClick={() => onSelect(s.id)}>{s.name}{i === 0 ? "（基準）" : ""}</button></th>
            <td className={cell}>{r ? `${r.satelliteCount}/${r.nominalSatelliteCount}` : "—"}</td>
            <td className={cell}>{r ? `${r.averageFoldAvailabilityPct.toFixed(2)}%` : "—"}</td>
            <td className={cell}>{r ? `${r.worstFoldAvailabilityPct.toFixed(2)}%` : "—"}</td>
            <td className={cell}>{r ? `${r.maxGapMin.toFixed(2)} 分` : "—"}</td>
            <td className={`${cell} ${r ? r.meetsRequirements ? "text-success" : "text-danger" : "text-fg-muted"}`}>{status(s, r)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="space-y-3 md:hidden">{doc.cases.map((s, i) => {
      const r = currentComparisonResult(s, doc);
      return <article key={s.id} className={`rounded-lg border p-3 ${s.id === selected?.id ? "border-brand bg-brand-soft" : "border-line"}`}>
        <button className="min-h-11 w-full break-words text-left font-medium text-brand-text underline" aria-pressed={s.id === selected?.id} onClick={() => onSelect(s.id)}>{s.name}{i === 0 ? "（基準）" : ""}</button>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm tabular-nums">
          <div><dt className="text-xs text-fg-muted">稼働/入力機数</dt><dd>{r ? `${r.satelliteCount}/${r.nominalSatelliteCount}` : "—"}</dd></div>
          <div><dt className="text-xs text-fg-muted">判定</dt><dd className={r ? r.meetsRequirements ? "text-success" : "text-danger" : "text-fg-muted"}>{status(s, r)}</dd></div>
          <div><dt className="text-xs text-fg-muted">平均達成率</dt><dd>{r ? `${r.averageFoldAvailabilityPct.toFixed(2)}%` : "—"}</dd></div>
          <div><dt className="text-xs text-fg-muted">最悪地点の達成率</dt><dd>{r ? `${r.worstFoldAvailabilityPct.toFixed(2)}%` : "—"}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-fg-muted">最大未達時間</dt><dd>{r ? `${r.maxGapMin.toFixed(2)} 分` : "—"}</dd></div>
        </dl>
      </article>;
    })}</div>
    {selected && <section className="rounded border border-line p-3 space-y-3">
      <h4 className="break-words font-medium">選択案: {selected.name}</h4>
      <div className="flex flex-wrap gap-2">
        <button className="analysis-secondary-button" disabled={disabled || selected.id === doc.cases[0]?.id} onClick={() => onMakeBaseline(selected.id)}>この案を基準にする</button>
        <button className="analysis-secondary-button" disabled={disabled || doc.cases.length >= 6} onClick={onCreateVariant}>故障・局停止案を作る</button>
        <button className="analysis-secondary-button" disabled={disabled} onClick={onTimeline}>この案のタイムライン</button>
        <button className="analysis-secondary-button text-danger" disabled={disabled} onClick={() => onRemove(selected.id)}>この案を削除</button>
      </div>
      {result ? <>
        {baseline && selected.id !== doc.cases[0]?.id && <div className="rounded bg-sunken p-3 text-sm">
          <p className="mb-2 break-words font-medium">基準案「{doc.cases[0].name}」との差</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div><dt className="text-xs text-fg-muted">最悪地点の達成率（高い方が良い）</dt><dd>{signed(result.worstFoldAvailabilityPct - baseline.worstFoldAvailabilityPct, "ポイント")}</dd></div>
            <div><dt className="text-xs text-fg-muted">最大未達時間（短い方が良い）</dt><dd>{signed(result.maxGapMin - baseline.maxGapMin, "分")}</dd></div>
            <div><dt className="text-xs text-fg-muted">地上局ネットワーク可用率</dt><dd>{signed(result.networkAvailabilityPct - baseline.networkAvailabilityPct, "ポイント")}</dd></div>
          </dl>
        </div>}
        <p className="text-sm">地上局ネットワーク: 可用率 {result.networkAvailabilityPct.toFixed(2)}% ・ 最大断 {result.networkMaxGapMin.toFixed(2)} 分</p>
        <p className="text-xs text-fg-muted">1局以上で1機以上見える時間の割合です。停止局: {result.disabledStationNames.join("、") || "なし"}。</p>
        <PointDetails key={selected.id} result={result} />
        <details><summary className="min-h-10 cursor-pointer text-sm">地上局ごとの詳細（{result.stationCount}局・対象地点とは別評価）</summary>
          <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr><th scope="col" className={cell}>局</th><th scope="col" className={cell}>可用率</th><th scope="col" className={cell}>最大断</th></tr></thead><tbody>{result.stationSummaries.map((s, i) => <tr key={i}><th scope="row" className={cell}>{s.name}</th><td className={cell}>{s.availabilityPct.toFixed(2)}%</td><td className={cell}>{s.maxGapMin.toFixed(2)} 分</td></tr>)}</tbody></table></div>
          {!result.stationCount && <p className="text-sm text-fg-muted">稼働している地上局はありません。</p>}
        </details>
        <details><summary className="min-h-10 cursor-pointer text-sm text-fg-muted">解析モデルと結果の読み方</summary>{result.warnings.map((w) => <p key={w} className="mt-2 text-xs text-fg-muted">{w}</p>)}</details>
      </> : <p className="text-sm text-fg-muted">「全案を解析」で共通条件による結果を表示します。条件変更前の結果は書き出し対象に含めません。</p>}
      <ScenarioInputs scenario={selected} />
    </section>}
  </div>;
}
function PointDetails({ result }: { result: ComparisonResult }) {
  const [visible, setVisible] = useState(50);
  const worst = result.points.reduce((a, b) => b.foldAvailabilityPct < a.foldAvailabilityPct ? b : a);
  const longest = result.points.reduce((a, b) => b.maxFoldGapMin > a.maxFoldGapMin ? b : a);
  return <details>
    <summary className="min-h-10 cursor-pointer text-sm">地点別の詳細（{result.points.length}地点）</summary>
    <p className="my-2 break-words text-xs text-fg-muted">最低達成率: {worst.name}。最長未達: {longest.name}。</p>
    <div className="max-h-80 overflow-auto rounded border border-line" role="region" aria-label="地点別の評価結果" tabIndex={0}>
      <table className="w-full text-sm tabular-nums"><thead className="sticky top-0 bg-surface-solid"><tr>{["地点", "可用率（1機以上）", "要求同時可視達成率", "最大未達時間"].map((h) => <th scope="col" key={h} className={cell}>{h}</th>)}</tr></thead>
        <tbody>{result.points.slice(0, visible).map((p, i) => <tr key={i}><th scope="row" className={cell}>{p.name}</th><td className={cell}>{p.availabilityPct.toFixed(2)}%</td><td className={cell}>{p.foldAvailabilityPct.toFixed(2)}%</td><td className={cell}>{p.maxFoldGapMin.toFixed(2)} 分</td></tr>)}</tbody></table>
    </div>
    {visible < result.points.length && <button className="analysis-secondary-button mt-2" onClick={() => setVisible((n) => n + 50)}>さらに50地点表示（残り{result.points.length - visible}地点）</button>}
  </details>;
}
function ScenarioInputs({ scenario }: { scenario: ComparisonCase }) {
  return <details><summary className="min-h-10 cursor-pointer text-sm text-fg-muted">この案に取り込んだ入力</summary>
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-sunken p-2 text-xs">{[scenario.satText, scenario.constText, scenario.gsText, JSON.stringify(scenario.outage ?? null, null, 2)].join("\n\n")}</pre>
  </details>;
}
