import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SatelliteFovCriteria } from "../../lib/visibility";
import { parseConstellationToml, parseSatellitesToml, downloadFile } from "../../lib/config";
import { comparisonTargets, validateComparisonConditions, type ComparisonDocument } from "../../lib/constellationComparison";
import { comparisonReportHtml, parseComparisonDocument } from "../../lib/comparison/document";
import { downloadCSV, downloadJSON } from "./utils/downloadUtils";
import { useComparisonJob } from "./utils/useComparisonJob";
import { AnalysisCancelledError } from "./utils/useAccessGridJob";
import { BusyOverlay } from "./AnalysisLayout";
import ComparisonConditionsEditor from "./ComparisonConditionsEditor";
import ComparisonTargetEditor from "./ComparisonTargetEditor";
import ComparisonResults from "./ComparisonResults";
import { currentComparisonResult } from "../../lib/comparison/document";

interface Props {
  satText: string; constText: string; gsText: string;
  sceneFov: SatelliteFovCriteria;
  doc: ComparisonDocument;
  setDoc: Dispatch<SetStateAction<ComparisonDocument>>;
}
export default function ConstellationComparisonAnalysis({ satText, constText, gsText, sceneFov, doc, setDoc }: Props) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRevision, setImportRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [runningName, setRunningName] = useState("");
  const stop = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useComparisonJob();
  useEffect(() => { stop.current = false; return () => { stop.current = true; }; }, []);

  function capture() {
    try {
      if (doc.cases.length >= 6) throw new Error("比較は最大6案です。不要な案を削除してください");
      const count = parseSatellitesToml(satText).length + parseConstellationToml(constText).length;
      if (!count) throw new Error("シナリオに衛星を追加してから取り込んでください");
      const id = crypto.randomUUID();
      setDoc((d) => ({ ...d, cases: [...d.cases, { id, name: name.trim() || `案 ${d.cases.length + 1}`, satText, constText, gsText }] }));
      setSelectedId(id); setName(""); setError(""); setNotice("現在編集中の構成を取り込みました。シナリオを変更して別案を追加できます。");
    } catch (e) { setError(e instanceof Error ? e.message : "取り込みエラー"); }
  }
  async function analyze() {
    setError(""); setNotice("");
    try { validateComparisonConditions(doc.conditions); comparisonTargets(doc.target, doc.conditions.minElevationDeg); }
    catch (e) { setError(e instanceof Error ? e.message : "条件が不正です"); return; }
    stop.current = false; setRunning(true);
    try {
      for (const scenario of doc.cases) {
        setRunningName(scenario.name);
        const result = await job.run({ scenario, conditions: doc.conditions, target: doc.target });
        if (stop.current) return;
        setDoc((d) => ({ ...d, cases: d.cases.map((s) => s.id === scenario.id ? { ...s, result } : s) }));
      }
      if (!stop.current) setNotice("全案を同じ条件で解析しました。");
    } catch (e) {
      if (!(e instanceof AnalysisCancelledError) && !stop.current) setError(e instanceof Error ? e.message : "比較解析エラー");
    } finally { if (!stop.current) setRunning(false); }
  }
  function cancel() { job.cancel(); stop.current = true; setRunning(false); setNotice("解析を中止しました。完了済みの結果は保持しています。"); }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("比較ファイルは10 MB以下にしてください");
      const restored = parseComparisonDocument(await file.text());
      setDoc(restored); setSelectedId(restored.cases[0]?.id ?? null); setTargetError(""); setError(""); setImportRevision((n) => n + 1);
      setNotice("入力条件と設計案を復元しました。保存結果はファイルに記録されています。現在のモデルで再解析してください。");
    } catch (e) { setError(e instanceof Error ? e.message : "比較ファイルの読み込みエラー"); }
    if (fileRef.current) fileRef.current.value = "";
  }
  function exportCsv() {
    const rows = doc.cases.flatMap((s) => currentComparisonResult(s, doc)?.points.map((p) => [s.name, p.name, p.latitudeDeg, p.longitudeDeg,
      p.availabilityPct, p.foldAvailabilityPct, p.maxFoldGapMin, doc.conditions.startTimeIso, doc.conditions.durationHours,
      doc.conditions.stepSeconds, doc.conditions.minElevationDeg, doc.conditions.requiredFold]) ?? []);
    downloadCSV(["案", "地点", "緯度", "経度", "可用率(%)", "要求同時可視達成率(%)", "最大要求未達(min)", "開始UTC", "期間(h)", "刻み(s)", "最低仰角(deg)", "要求同時可視数"], rows, "constellation-comparison.csv");
  }
  return <div className="relative flex h-full min-h-0 flex-col">
    <div className="analysis-toolbar flex-wrap">
      <button className="analysis-primary-button" disabled={running || !doc.cases.length || !!targetError} onClick={() => void analyze()}>全案を解析</button>
      <button className="analysis-secondary-button" disabled={running || !!targetError} onClick={() => downloadJSON(doc, "constellation-comparison.json")}>比較を保存</button>
      <button className="analysis-secondary-button" disabled={running} onClick={() => fileRef.current?.click()}>比較を読み込む</button>
      <input ref={fileRef} aria-label="比較ファイル" className="hidden" type="file" accept=".json,application/json" onChange={(e) => void importFile(e.target.files?.[0])} />
      <button className="analysis-secondary-button" disabled={running || !!targetError} onClick={() => downloadFile("constellation-comparison.html", comparisonReportHtml(doc))}>HTMLレポート</button>
      <button className="analysis-secondary-button" disabled={running || !!targetError} onClick={exportCsv}>地点別CSV</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
      <p className="text-sm text-fg-muted">シナリオを案として取り込み、構成を変更して次の案を追加します。共通条件の変更後は再解析が必要です。入力と結果はJSONで保存できます。</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-fg-muted">{notice}</p>}
      <fieldset disabled={running} className="flex flex-wrap items-end gap-2 rounded border border-line p-3">
        <legend className="px-1 text-sm font-medium">設計案を追加（{doc.cases.length}/6）</legend>
        <label className="flex flex-col gap-1 text-sm">案の名前<input className="analysis-input" maxLength={120} value={name} placeholder={`案 ${doc.cases.length + 1}`} onChange={(e) => setName(e.target.value)} /></label>
        <button className="analysis-secondary-button" disabled={doc.cases.length >= 6} onClick={capture}>現在の構成を追加</button>
      </fieldset>
      <ComparisonConditionsEditor value={doc.conditions} onChange={(conditions) => setDoc((d) => ({ ...d, conditions }))} sceneFov={sceneFov} disabled={running} />
      <ComparisonTargetEditor key={importRevision} value={doc.target} onChange={(target) => setDoc((d) => ({ ...d, target }))} onError={setTargetError} disabled={running} />
      <ComparisonResults doc={doc} selectedId={selectedId} onSelect={setSelectedId} disabled={running} onRemove={(id) => setDoc((d) => ({ ...d, cases: d.cases.filter((s) => s.id !== id) }))} />
    </div>
    {running && <BusyOverlay progress={job.progress} onCancel={cancel} detail={`${runningName} を解析中`} />}
  </div>;
}
