import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SatelliteFovCriteria } from "../../lib/visibility";
import { parseConstellationToml, parseSatellitesToml, downloadFile } from "../../lib/config";
import { comparisonTargets, validateComparisonConditions, type ComparisonDocument, type ComparisonScenario } from "../../lib/constellationComparison";
import { comparisonReportHtml, currentComparisonResult, parseComparisonDocument, serializeComparisonDocument } from "../../lib/comparison/document";
import { validateComparisonSourceSize } from "../../lib/comparison/outages";
import { downloadCSV } from "./utils/downloadUtils";
import { useComparisonJob } from "./utils/useComparisonJob";
import { AnalysisCancelledError } from "./utils/useAccessGridJob";
import { BusyOverlay } from "./AnalysisLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import CollapsibleSubsection from "../ui/CollapsibleSubsection";
import NoticeDialog from "../ui/NoticeDialog";
import ComparisonConditionsEditor from "./ComparisonConditionsEditor";
import ComparisonTargetEditor from "./ComparisonTargetEditor";
import ComparisonResults from "./ComparisonResults";
import ComparisonTimelinePanel from "./ComparisonTimelinePanel";
import ComparisonOutageEditor from "./ComparisonOutageEditor";

interface Props {
  satText: string; constText: string; gsText: string;
  sceneFov: SatelliteFovCriteria;
  onPreview: (scenario: ComparisonScenario, timestampMs: number) => void;
  onEditScenario: () => void;
  doc: ComparisonDocument;
  setDoc: Dispatch<SetStateAction<ComparisonDocument>>;
}
export default function ConstellationComparisonAnalysis({ satText, constText, gsText, sceneFov, doc, setDoc, onPreview, onEditScenario }: Props) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState(() => doc.cases.some((s) => currentComparisonResult(s, doc)) ? "results" : "setup");
  const [outageOpen, setOutageOpen] = useState(false);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRevision, setImportRevision] = useState(0);
  const [pendingImport, setPendingImport] = useState<ComparisonDocument | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ComparisonScenario | null>(null);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [runningName, setRunningName] = useState("");
  const stop = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const outageRef = useRef<HTMLDivElement>(null);
  const job = useComparisonJob();
  const busy = running || importing;
  useEffect(() => { stop.current = false; return () => { stop.current = true; }; }, []);

  function choosePane(next: string) { setPane(next); scrollRef.current?.scrollTo(0, 0); }
  function capture() {
    try {
      if (doc.cases.length >= 6) throw new Error("比較は最大6案です。不要な案を削除してください");
      validateComparisonSourceSize({ satText, constText, gsText });
      const count = parseSatellitesToml(satText).length + parseConstellationToml(constText).length;
      if (!count) throw new Error("シナリオに衛星を追加してから取り込んでください");
      const id = crypto.randomUUID();
      setDoc((d) => ({ ...d, cases: [...d.cases, { id, name: name.trim() || `案 ${d.cases.length + 1}`, satText, constText, gsText }] }));
      setSelectedId(id); setName(""); setError(""); setNotice("現在の構成を取り込みました。条件を確認して解析するか、シナリオを編集して次の案を追加できます。");
    } catch (e) { setError(e instanceof Error ? e.message : "取り込みエラー"); }
  }
  async function analyze() {
    setError(""); setNotice("");
    try { validateComparisonConditions(doc.conditions); comparisonTargets(doc.target, doc.conditions.minElevationDeg); }
    catch (e) { setError(e instanceof Error ? e.message : "条件が不正です"); choosePane("setup"); return; }
    stop.current = false; setRunning(true);
    let activeName = "";
    try {
      for (const scenario of doc.cases) {
        activeName = scenario.name; setRunningName(scenario.name);
        const result = await job.run({ scenario, conditions: doc.conditions, target: doc.target });
        if (stop.current) return;
        setDoc((d) => ({ ...d, cases: d.cases.map((s) => s.id === scenario.id ? { ...s, result } : s) }));
      }
      if (!stop.current) {
        setNotice("全案を同じ条件で解析しました。"); choosePane("results");
        requestAnimationFrame(() => resultsHeadingRef.current?.focus());
      }
    } catch (e) {
      if (!(e instanceof AnalysisCancelledError) && !stop.current) setError(`${activeName || "設計案"}: ${e instanceof Error ? e.message : "比較解析エラー"}`);
    } finally { if (!stop.current) setRunning(false); }
  }
  function cancel() { job.cancel(); stop.current = true; setRunning(false); setNotice("解析を中止しました。完了済みの結果は比較結果で確認できます。"); }
  function applyImported(restored: ComparisonDocument) {
    setDoc(restored); setSelectedId(restored.cases[0]?.id ?? null); setTargetError(""); setError(""); setImportRevision((n) => n + 1);
    setPendingImport(null); choosePane("setup");
    setNotice("入力条件と設計案を復元しました。現在のモデルで「全案を解析」を実行してください。保存時の結果は元のファイルに残っています。");
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    stop.current = false; setImporting(true);
    try {
      if (file.size > 10_000_000) throw new Error("比較ファイルは10 MB以下にしてください");
      const restored = parseComparisonDocument(await file.text());
      if (stop.current) return;
      if (doc.cases.length) setPendingImport(restored); else applyImported(restored);
    } catch (e) { if (!stop.current) setError(e instanceof Error ? e.message : "比較ファイルの読み込みエラー"); }
    finally { if (!stop.current) setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  function exportCsv() {
    const rows = doc.cases.flatMap((s) => currentComparisonResult(s, doc)?.points.map((p) => [s.name, p.name, p.latitudeDeg, p.longitudeDeg,
      p.availabilityPct, p.foldAvailabilityPct, p.maxFoldGapMin, doc.conditions.startTimeIso, doc.conditions.durationHours,
      doc.conditions.stepSeconds, doc.conditions.minElevationDeg, doc.conditions.requiredFold, JSON.stringify(doc.conditions.fov),
      doc.conditions.targetAvailabilityPct, doc.conditions.maxGapMinutes, JSON.stringify(s.outage ?? null)]) ?? []);
    downloadCSV(["案", "地点", "緯度", "経度", "可用率(%)", "要求同時可視達成率(%)", "最大未達(分)", "開始UTC", "期間(h)", "刻み(s)", "最低仰角(deg)", "要求同時可視数", "FOV条件", "要求可用率(%)", "許容未達(分)", "故障・停止条件"], rows, "constellation-comparison.csv");
  }
  let conditionsError = "";
  try { validateComparisonConditions(doc.conditions); comparisonTargets(doc.target, doc.conditions.minElevationDeg); }
  catch (e) { conditionsError = e instanceof Error ? e.message : "共通条件が不正です"; }
  const selectedCase = doc.cases.find((s) => s.id === selectedId) ?? doc.cases[0];
  const valid = !targetError && !conditionsError;
  const currentCount = doc.cases.filter((s) => currentComparisonResult(s, doc)).length;
  const canExport = valid && currentCount > 0 && !busy;
  function createVariant() {
    choosePane("setup"); setOutageOpen(true);
    requestAnimationFrame(() => outageRef.current?.scrollIntoView({ block: "start" }));
  }
  return <div className="relative flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-2">
      <button className="analysis-primary-button" disabled={busy || !doc.cases.length || !valid} onClick={() => void analyze()}>全案を解析</button>
      <button className="analysis-secondary-button" disabled={busy || !doc.cases.length || !valid} onClick={() => { try { downloadFile("constellation-comparison.json", serializeComparisonDocument(doc)); setNotice("入力条件と解析結果をJSONへ保存しました。"); } catch (e) { setError(e instanceof Error ? e.message : "保存エラー"); } }}>比較を保存</button>
      <button className="analysis-secondary-button" disabled={busy} onClick={() => fileRef.current?.click()}>読み込む</button>
      <input ref={fileRef} aria-label="比較ファイル" className="hidden" type="file" accept=".json,application/json" onChange={(e) => void importFile(e.target.files?.[0])} />
    </div>
    <Tabs value={pane} onValueChange={choosePane} className="min-h-0 flex-1 gap-0">
      <TabsList aria-label="設計比較の手順" className="h-auto w-full shrink-0 rounded-none border-x-0 border-t-0 p-1">
        <TabsTrigger value="setup" disabled={busy} className="min-h-11">案と条件</TabsTrigger>
        <TabsTrigger value="results" disabled={busy} className="min-h-11">比較結果</TabsTrigger>
        <TabsTrigger value="timeline" disabled={busy || !doc.cases.length} className="min-h-11">タイムライン</TabsTrigger>
      </TabsList>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {conditionsError && <p role="alert" className="mb-3 text-sm text-danger">{conditionsError}</p>}
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="mb-3 text-sm text-fg-muted">{notice}</p>}
        <TabsContent value="setup" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <p className="text-sm text-fg-muted">① 現在の構成を案として追加 → ② 評価条件を設定 → ③ 全案を解析。案は最大6つ、保存すると次回も読み込めます。</p>
          <fieldset disabled={busy} className="flex flex-wrap items-end gap-2 rounded border border-line p-3">
            <legend className="px-1 text-sm font-medium">設計案を追加（{doc.cases.length}/6）</legend>
            <label className="flex min-w-0 flex-col gap-1 text-sm">案の名前<input className="analysis-input max-w-full" maxLength={120} value={name} placeholder={`案 ${doc.cases.length + 1}`} onChange={(e) => setName(e.target.value)} /></label>
            <button className="analysis-secondary-button" disabled={doc.cases.length >= 6} onClick={capture}>現在の構成を追加</button>
            <button className="analysis-secondary-button" onClick={onEditScenario}>シナリオを編集</button>
            <p className="basis-full text-xs text-fg-muted">取り込んだ案は、シナリオを編集しても保持します。結果の「案名」で比較する案を選べます。</p>
          </fieldset>
          {doc.cases.length > 0 && <p className="break-words text-sm">取り込み済み: {doc.cases.map((s) => s.name).join(" ／ ")}</p>}
          <ComparisonConditionsEditor value={doc.conditions} onChange={(conditions) => setDoc((d) => ({ ...d, conditions }))} sceneFov={sceneFov} disabled={busy} />
          <ComparisonTargetEditor key={importRevision} value={doc.target} onChange={(target) => setDoc((d) => ({ ...d, target }))} onError={setTargetError} disabled={busy} />
          {selectedCase && <div ref={outageRef}><CollapsibleSubsection title="故障・地上局停止の比較案" open={outageOpen} onOpenChange={setOutageOpen}>
            <ComparisonOutageEditor key={`outage:${importRevision}:${selectedCase.id}`} base={selectedCase} disabled={busy || doc.cases.length >= 6}
              onCreate={(scenario) => { setDoc((d) => ({ ...d, cases: [...d.cases, scenario] })); setSelectedId(scenario.id); setNotice("元の案を保持して故障・局停止案を追加しました。全案を再解析してください。"); }} />
          </CollapsibleSubsection></div>}
        </TabsContent>
        <TabsContent value="results" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <h4 ref={resultsHeadingRef} tabIndex={-1} className="font-medium outline-none">比較結果（解析済み {currentCount}/{doc.cases.length}案）</h4>
          <p className="break-words text-xs text-fg-muted">開始 {doc.conditions.startTimeIso} ／ {doc.conditions.durationHours}時間・{doc.conditions.stepSeconds}秒刻み ／ 最低仰角 {doc.conditions.minElevationDeg}° ／ 同時{doc.conditions.requiredFold}機以上を{doc.conditions.targetAvailabilityPct}%・未達は最大{doc.conditions.maxGapMinutes}分 ／ FOV {doc.conditions.fov ? "適用" : "なし"}</p>
          {!valid && <p className="text-sm text-danger">「案と条件」の入力を修正してください。現在の条件で有効な結果だけを表示します。</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className="analysis-secondary-button" disabled={!canExport} onClick={() => downloadFile("constellation-comparison.html", comparisonReportHtml(doc))}>HTMLレポート</button>
            <button className="analysis-secondary-button" disabled={!canExport} onClick={exportCsv}>地点別CSV</button>
            <span className="text-xs text-fg-muted">現在の条件で解析済みの案が出力対象です。</span>
          </div>
          {!doc.cases.length ? <p className="text-sm text-fg-muted">「案と条件」で設計案を追加してください。</p> : <ComparisonResults doc={doc} selectedId={selectedId} onSelect={setSelectedId} disabled={busy}
            onCreateVariant={createVariant} onTimeline={() => choosePane("timeline")}
            onMakeBaseline={(id) => setDoc((d) => ({ ...d, cases: [...d.cases.filter((s) => s.id === id), ...d.cases.filter((s) => s.id !== id)] }))}
            onRemove={(id) => setPendingDelete(doc.cases.find((s) => s.id === id) ?? null)} />}
        </TabsContent>
        <TabsContent value="timeline" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <label className="flex min-w-0 flex-col gap-1 text-sm">タイムラインの設計案<select className="analysis-input max-w-full" value={selectedCase?.id ?? ""} disabled={busy} onChange={(e) => setSelectedId(e.target.value)}>{doc.cases.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {selectedCase && <ComparisonTimelinePanel key={`timeline:${importRevision}:${selectedCase.id}`} scenario={selectedCase} doc={doc} disabled={busy || !valid} onPreview={onPreview} />}
        </TabsContent>
      </div>
    </Tabs>
    {busy && <BusyOverlay progress={importing ? null : job.progress} onCancel={importing ? undefined : cancel} detail={importing ? "比較ファイルを読み込み中" : `${runningName} を解析中`} />}
    <NoticeDialog open={pendingImport !== null} onClose={() => setPendingImport(null)} title="比較データを読み替えますか？"
      description={`現在の${doc.cases.length}案を、ファイル内の${pendingImport?.cases.length ?? 0}案で置き換えます。残したい比較はキャンセルして先に保存してください。`}
      confirmLabel="読み替える" initialFocus="cancel" onConfirm={() => { if (pendingImport) applyImported(pendingImport); }} />
    <NoticeDialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="比較案を削除しますか？"
      description={`「${pendingDelete?.name ?? ""}」の入力と解析結果を、この比較から削除します。編集中のシナリオは変わりません。`}
      confirmLabel="この案を削除" destructive initialFocus="cancel" onConfirm={() => { if (pendingDelete) setDoc((d) => ({ ...d, cases: d.cases.filter((s) => s.id !== pendingDelete.id) })); }} />
  </div>;
}
