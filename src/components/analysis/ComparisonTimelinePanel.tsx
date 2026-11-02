import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { comparisonTargets, type ComparisonDocument, type ComparisonScenario } from "../../lib/constellationComparison";
import { comparisonScenarioInputs } from "../../lib/comparison/outages";
import { timelineInputKey, type ComparisonTimeline, type ComparisonTimelineJob } from "../../lib/comparison/timeline";
import { useComparisonTimelineJob } from "./utils/useComparisonJob";
import { AnalysisCancelledError } from "./utils/useAccessGridJob";
import { createComparisonTimelineOption } from "./utils/chartOptions";
import { useChartTheme } from "./utils/chartTheme";
import { useCompactChart } from "./utils/useCompactChart";
import NoticeDialog from "../ui/NoticeDialog";
import { downloadCSV, downloadJSON } from "./utils/downloadUtils";

interface Props { scenario: ComparisonScenario; doc: ComparisonDocument; disabled: boolean; onPreview: (scenario: ComparisonScenario, timestampMs: number) => void }
export default function ComparisonTimelinePanel({ scenario, doc, disabled, onPreview }: Props) {
  const [satelliteIndex, setSatelliteIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [result, setResult] = useState<ComparisonTimeline | null>(null);
  const [error, setError] = useState("");
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [visibleEvents, setVisibleEvents] = useState(100);
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null);
  const job = useComparisonTimelineJob();
  const theme = useChartTheme();
  const compact = useCompactChart();
  const inputs = useMemo(() => {
    try { return { satellites: comparisonScenarioInputs(scenario).satellites,
      targets: comparisonTargets(doc.target, doc.conditions.minElevationDeg), error: "" }; }
    catch (e) { return { satellites: [], targets: [], error: e instanceof Error ? e.message : "入力が不正です" }; }
  }, [scenario, doc.target, doc.conditions.minElevationDeg]);
  const selectedSatelliteIndex = Math.min(satelliteIndex, inputs.satellites.length - 1);
  const selectedTargetIndex = Math.min(targetIndex, inputs.targets.length - 1);
  const request: ComparisonTimelineJob = { scenario, conditions: doc.conditions, target: doc.target,
    satelliteIndex: selectedSatelliteIndex, targetIndex: selectedTargetIndex };
  const current = result?.inputKey === timelineInputKey(request) ? result : null;
  const option = useMemo(() => current ? createComparisonTimelineOption(current, theme, compact) : null, [current, theme, compact]);
  const events = useMemo(() => current?.lanes.flatMap((lane) => lane.intervals.map((interval) => ({ ...interval, label: lane.label, laneId: lane.id })))
    .sort((a, b) => a.startMs - b.startMs || a.laneId.localeCompare(b.laneId)) ?? [], [current]);
  async function analyze() {
    setError("");
    try { const next = await job.run(request); setResult(next); setSelectedTime(next.startMs); setVisibleEvents(100); }
    catch (e) { if (!(e instanceof AnalysisCancelledError)) setError(e instanceof Error ? e.message : "タイムライン解析エラー"); }
  }
  const exportCsv = () => downloadCSV(["衛星", "イベント", "開始UTC", "終了UTC", "時間(s)", "刻み(s)"],
    events.map((e) => [current!.satelliteLabel, e.label, new Date(e.startMs).toISOString(), new Date(e.endMs).toISOString(), (e.endMs - e.startMs) / 1000, current!.stepSeconds]), "comparison-timeline.csv");
  return <section className="rounded border border-line p-3 space-y-3">
    <h4 className="font-medium">共通イベントタイムライン — {scenario.name}</h4>
    <p className="text-xs text-fg-muted">1機の時間表示です。同時可視数の要求達成率は「比較結果」で確認してください。選んだ1機の食・地上局接触・対象地点の可視機会を共通条件で表示します。対象地点はFOV条件を任意適用した幾何評価です。地上の日照・姿勢変更・運用割当は含みません。</p>
    <fieldset disabled={disabled || job.progress !== null} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">稼働衛星<select className="analysis-input max-w-64" value={selectedSatelliteIndex} disabled={!inputs.satellites.length} onChange={(e) => setSatelliteIndex(Number(e.target.value))}>
        {!inputs.satellites.length && <option value={-1}>稼働衛星なし</option>}
        {inputs.satellites.map((s, i) => <option key={i} value={i}>{s.meta?.objectName || `衛星 ${i + 1}`}</option>)}
      </select></label>
      <label className="flex flex-col gap-1 text-sm">対象地点<select className="analysis-input max-w-64" value={selectedTargetIndex} disabled={!inputs.targets.length} onChange={(e) => setTargetIndex(Number(e.target.value))}>
        {!inputs.targets.length && <option value={-1}>対象地点なし</option>}
        {inputs.targets.map((t, i) => <option key={i} value={i}>{t.station.name}</option>)}
      </select></label>
      <button className="analysis-secondary-button" disabled={!!inputs.error || !inputs.satellites.length || !inputs.targets.length} onClick={() => void analyze()}>タイムラインを解析</button>
    </fieldset>
    {!inputs.satellites.length && !inputs.error && <p className="text-xs text-fg-muted">全機停止している案には稼働衛星のタイムラインがありません。</p>}
    {(error || inputs.error) && <p role="alert" className="text-sm text-danger">{error || inputs.error}</p>}
    {job.progress !== null && <div role="status" className="flex items-center gap-2 text-sm">解析中 {Math.round(job.progress * 100)}%<button className="analysis-secondary-button" onClick={job.cancel}>タイムライン解析を中止</button></div>}
    {result && !current && <p className="text-sm text-fg-muted">選択または条件が変わりました。タイムラインを再解析してください。</p>}
    {current && option && <>
      <p className="text-xs text-fg-muted">{current.satelliteLabel} / {new Date(current.startMs).toISOString()}〜{new Date(current.endMs).toISOString()} / {current.stepSeconds}秒刻み。境界精度は刻みに依存します。バーをクリックすると区間開始時刻を選択します。</p>
      <ReactECharts ref={chartRef} option={option} notMerge style={{ height: Math.max(230, current.lanes.length * 34 + 88), width: "100%" }}
        onEvents={{ click: (params: { value?: unknown }) => { if (Array.isArray(params.value) && typeof params.value[1] === "number") setSelectedTime(params.value[1]); } }} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">選択時刻: {selectedTime === null ? "—" : new Date(selectedTime).toISOString()}</span>
        <button className="analysis-secondary-button" disabled={disabled || job.progress !== null || selectedTime === null} onClick={() => setPreviewTime(selectedTime)}>この案・時刻を3Dに反映</button>
        <button className="analysis-secondary-button" disabled={disabled || job.progress !== null} onClick={exportCsv}>イベントCSV</button>
        <button className="analysis-secondary-button" disabled={disabled || job.progress !== null} onClick={() => downloadJSON({ request, result: current }, "comparison-timeline.json")}>タイムラインJSON</button>
      </div>
      <p className="text-xs text-fg-muted">3D反映では、編集中の構成をこの案の稼働衛星・稼働局で置き換え、選択時刻で一時停止します。比較用に取り込んだ各案は保持されます。</p>
      <details><summary className="cursor-pointer text-sm">イベント一覧（{events.length}件・時刻をキーボードで選択可能）</summary>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th scope="col" className="p-2 text-left">イベント</th><th scope="col" className="p-2 text-left">開始UTC</th><th scope="col" className="p-2 text-left">終了UTC</th></tr></thead><tbody>{events.slice(0, visibleEvents).map((e) => <tr key={`${e.laneId}:${e.startMs}`}><th scope="row" className="p-2 text-left">{e.label}</th><td className="p-2"><button className="text-brand-text underline" onClick={() => setSelectedTime(e.startMs)}>{new Date(e.startMs).toISOString()}</button></td><td className="p-2">{new Date(e.endMs).toISOString()}</td></tr>)}</tbody></table></div>
        {events.length > visibleEvents && <button className="analysis-secondary-button" onClick={() => setVisibleEvents((n) => n + 100)}>さらに100件表示</button>}
      </details>
    </>}
    <NoticeDialog open={previewTime !== null} onClose={() => setPreviewTime(null)} title="編集中のシナリオを置き換えますか？"
      description={`「${scenario.name}」の稼働衛星・地上局とFOV条件へ切り替え、${previewTime === null ? "" : new Date(previewTime).toISOString()}で一時停止します。現在編集中の構成を残す場合は、キャンセルして先に比較案として追加するか設定を保存してください。`}
      confirmLabel="切り替えて3Dで確認" initialFocus="cancel" onConfirm={() => { if (previewTime !== null) onPreview(scenario, previewTime); }} />
  </section>;
}
