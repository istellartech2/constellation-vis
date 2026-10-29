import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileUp, Loader2, Diamond, Check, ArrowRight, ShieldCheck, Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { cn } from "../../lib/utils";
import { AI_FILING, FILING_CATALOG } from "../../lib/filings/catalog";
import { MAX_FILING_EXTRACT_BYTES, filingExtractFilename, parseFilingExtract, type FilingExtract } from "../../lib/filings/extract";
import type { FilingDataset, FilingWorkerResponse } from "../../lib/filings/types";
import { downloadFile } from "../../lib/config";

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (dataset: FilingDataset, configuration: string, epoch: Date) => void;
}
function configurationLabel(id: string) { return id === "default" ? "単一構成" : `構成 ${id}`; }

export default function FilingImportDialog({ open, onClose, onApply }: Props) {
  const [catalogId, setCatalogId] = useState<string>(FILING_CATALOG[0].id);
  const [datasets, setDatasets] = useState<FilingDataset[]>([]);
  const [extracts, setExtracts] = useState<Record<string, FilingExtract>>({});
  const [selectedHash, setSelectedHash] = useState("");
  const [configuration, setConfiguration] = useState("");
  const [epoch, setEpoch] = useState(() => new Date().toISOString().slice(0, 10) + "T00:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedHash, setAppliedHash] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const catalog = FILING_CATALOG.find(item => item.id === catalogId)!;
  const dataset = datasets.find(item => item.sha256 === selectedHash);
  const config = dataset?.configurations.find(item => item.id === configuration);
  const extract = dataset ? extracts[dataset.sha256] : undefined;
  const canApply = Boolean(config && !busy && epoch && Number.isFinite(new Date(epoch + "Z").valueOf()));

  function stop() {
    generation.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setBusy(false);
  }
  useEffect(() => () => {
    generation.current++;
    workerRef.current?.terminate();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  useEffect(() => {
    if (open && selectedHash) resultRef.current?.scrollIntoView({ block: "start" });
  }, [open, selectedHash]);
  function selectDataset(next: FilingDataset) {
    setSelectedHash(next.sha256);
    setConfiguration(next.preferredConfiguration);
    setError(null);
  }
  function selectCatalog(id: string) {
    setCatalogId(id);
    setError(null);
    const item = FILING_CATALOG.find(c => c.id === id)!;
    const loaded = datasets.find(d => d.sourceUrl === item.url);
    if (loaded) selectDataset(loaded);
    else { setSelectedHash(""); setConfiguration(""); }
  }
  function addDataset(next: FilingDataset, nextExtract: FilingExtract) {
    setDatasets(prev => [...prev.filter(d => d.key !== next.key), next]);
    setExtracts(prev => ({ ...prev, [next.sha256]: nextExtract }));
    selectDataset(next);
    const matched = FILING_CATALOG.find(item => item.url === next.sourceUrl);
    if (matched) setCatalogId(matched.id);
  }
  async function loadExtract(file: File) {
    if (file.size > MAX_FILING_EXTRACT_BYTES) { setError("抽出ファイルが大きすぎます（上限16 MB）。"); return; }
    const token = generation.current;
    try {
      const result = parseFilingExtract(await file.text());
      if (token === generation.current) addDataset(result.dataset, result.extract);
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : "抽出ファイルを読み込めませんでした。");
    }
  }
  async function loadFile(file: File) {
    stop();
    setError(null);
    if (/\.json$/i.test(file.name)) { await loadExtract(file); return; }
    if (!/\.mdb$/i.test(file.name)) { setError("ZIPは展開してから、SNS形式の .mdb ファイルか、保存した抽出ファイル（.filing.json）を選んでください。PDF・GIMS・マスク用MDBは読み込めません。"); return; }
    if (file.size > 128 * 1024 * 1024) { setError("ファイル上限は128 MBです。全体DBではなく、個別申請のSNS MDBを選んでください。"); return; }
    setBusy(true);
    const token = generation.current;
    try {
      const buffer = await file.arrayBuffer();
      if (token !== generation.current) return;
      const worker = new Worker(new URL("../../workers/filingImportWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      const fail = (message: string) => { if (token !== generation.current) return; stop(); setError(message); };
      worker.onmessage = (event: MessageEvent<FilingWorkerResponse>) => {
        if (token !== generation.current) return;
        stop();
        const result = event.data;
        if (!result.ok) { setError(result.message); return; }
        addDataset(result.dataset, result.extract);
      };
      worker.onerror = () => fail("MDBの解析に失敗しました。ファイルが破損していないか、SNS形式かを確認してください。");
      timerRef.current = setTimeout(() => fail("解析を中止しました。個別申請のSNS MDBを選び直してください。"), 60000);
      worker.postMessage({ buffer, filename: file.name }, [buffer]);
    } catch (cause) {
      if (token !== generation.current) return;
      stop(); setError(cause instanceof Error ? cause.message : "ファイルを読み込めませんでした。");
    }
  }
  function close() { stop(); onClose(); }
  function apply() {
    if (!dataset || !canApply) return;
    try {
      onApply(dataset, configuration, new Date(epoch + "Z"));
      setAppliedHash(dataset.sha256);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "配置を反映できませんでした。"); }
  }
  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="!max-w-4xl !w-[96vw] max-h-[92dvh] flex flex-col gap-0 overflow-hidden p-0 bg-surface-solid text-fg border-line">
        <DialogHeader className="border-b border-line px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base"><Diamond className="size-4 text-amber-400" />申請・計画から探す</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">まだ運用されていない配置も、出典を確認しながら地球上で比較できます。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-[240px_1fr]">
            <aside className="border-b md:border-b-0 md:border-r md:sticky md:top-0 md:self-start border-line bg-sunken/50 p-3 space-y-2" aria-label="公式申請のカタログ">
              <p className="px-2 text-[10px] font-semibold tracking-widest text-fg-subtle">ITU · 公開申請</p>
              <label className="block text-xs text-fg-muted md:hidden">公式申請を選ぶ<select aria-label="公式申請を選ぶ" className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg" value={catalogId} onChange={event => selectCatalog(event.target.value)}>{FILING_CATALOG.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <div className="hidden md:block space-y-2">
              {FILING_CATALOG.map(item => (
                <button key={item.id} type="button" aria-pressed={catalogId === item.id} onClick={() => selectCatalog(item.id)} className={cn("w-full rounded-lg border p-3 text-left transition-colors", catalogId === item.id ? "border-amber-400/60 bg-amber-400/10" : "border-transparent hover:bg-raised")}>
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">{item.name}<span className="text-[10px] text-fg-muted">{item.country}</span></span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-fg-muted">{item.description}</span>
                </button>
              ))}
              </div>
              <div className="border-t border-line pt-3 px-2 text-[11px] text-fg-muted">
                <a href={AI_FILING.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-fg hover:underline">{AI_FILING.name}<ExternalLink className="size-3" /></a>
                <details className="mt-1 md:hidden"><summary className="cursor-pointer">この構想について</summary><p className="mt-1 leading-relaxed">{AI_FILING.description}</p></details>
                <p className="mt-1 hidden md:block leading-relaxed">{AI_FILING.description}</p>
              </div>
            </aside>
            <main className="p-4 md:p-5 space-y-5">
              <section>
                <h3 className="text-sm font-semibold">1. 公式サイトでデータを取得</h3>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised p-3">
                  <div><p className="text-sm font-medium">{catalog.name}</p><p className="text-[11px] text-fg-muted">{catalog.reference} · {catalog.date} 受領</p></div>
                  <a href={catalog.url} target="_blank" rel="noopener noreferrer" className="analysis-button inline-flex items-center gap-1.5 text-xs">公式申請を開く<ExternalLink className="size-3" /></a>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-fg-muted">添付一覧の <strong className="text-fg">SNS(MDB) As Received Copy</strong> をダウンロードします。GIMS・MASKSは別のデータです。ZIPを取得した場合は先に展開してください。一度読み込んで抽出ファイルを保存すれば、次回からはMDBの取得は不要です。</p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">2. 取得したMDBか抽出ファイルをこの端末で開く</h3>
                <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy) void loadFile(file); }} className="mt-2 rounded-lg border border-dashed border-line-strong bg-sunken/50 p-4 text-center">
                  <input ref={inputRef} type="file" accept=".mdb,.json" className="hidden" aria-label="申請のSNS MDBまたは抽出ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void loadFile(file); }} />
                  <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()} className="gap-2">{busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{busy ? "端末内で解析中…" : "SNS MDBを選択"}</Button>
                  <p className="mt-2 text-[11px] text-fg-muted">ここにドロップもできます · MDBは最大128 MB · 抽出ファイル（.filing.json）も可</p>
                  <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-fg-muted"><ShieldCheck className="size-3" />ファイルはサーバーに送信しません</p>
                  {busy && <button type="button" onClick={stop} className="mt-2 text-xs underline">解析を中止</button>}
                </div>
              </section>
              {datasets.length > 1 && <label className="block text-xs text-fg-muted">読み込み済みの申請<select aria-label="読み込み済みの申請" className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg" value={selectedHash} onChange={event => { const next = datasets.find(d => d.sha256 === event.target.value); if (next) selectDataset(next); }}><option value="" disabled>読み込んだ申請を選択</option>{datasets.map(d => <option key={d.sha256} value={d.sha256}>{d.name}</option>)}</select></label>}
              {dataset && <section ref={resultRef} className="space-y-3 scroll-mt-3">
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">3. 表示する構成を選ぶ</h3><span className="text-[10px] text-fg-muted">{dataset.fromExtract ? "抽出ファイルから読み込み" : dataset.reference ? "確認済みの申請版" : "添付注記の確認が必要"}</span></div>
                <div className="rounded-lg border border-line p-3"><p className="text-sm font-medium break-all">{dataset.name}</p><p className="text-[11px] text-fg-muted break-all">{dataset.filename}</p><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">{dataset.sourceUrl && <a href={dataset.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-text underline">このファイルの出典<ExternalLink className="size-3" /></a>}{extract && <button type="button" onClick={() => downloadFile(filingExtractFilename(dataset), JSON.stringify(extract))} className="inline-flex items-center gap-1 text-xs underline" title="軌道に必要な値だけをこの端末に保存します。ITUの利用条件に従い、再配布には注意してください。"><Download className="size-3" />抽出ファイルを保存{!dataset.fromExtract && <span className="text-fg-muted no-underline">（次回はMDB不要）</span>}</button>}</div></div>
                <div role="group" aria-label="配置の構成" className="grid gap-2 sm:grid-cols-3">
                  {dataset.configurations.map(item => {
                    const inclinations = [...new Set(item.planes.map(p => p.inclination))].sort((a,b) => a-b);
                    const counts = new Map<number, number>();
                    item.planes.forEach(p => counts.set(p.inclination, (counts.get(p.inclination) ?? 0) + p.satellites));
                    const mainInclination = [...counts].sort((a, b) => b[1] - a[1])[0][0];
                    const low = Math.min(...item.planes.map(p => p.perigee));
                    const high = Math.max(...item.planes.map(p => p.apogee));
                    return <button key={item.id} type="button" aria-pressed={configuration === item.id} onClick={() => setConfiguration(item.id)} className={cn("rounded-lg border p-3 text-left transition-colors", configuration === item.id ? "border-amber-400 bg-amber-400/10" : "border-line hover:border-line-strong")}>
                      <span className="flex items-center justify-between text-xs">{configurationLabel(item.id)}{configuration === item.id && <Check className="size-3 text-amber-400" />}</span>
                      <span className="mt-1 block text-lg font-semibold tabular-nums">{item.count.toLocaleString()}<span className="ml-1 text-xs font-normal text-fg-muted">機</span></span>
                      <span className="block text-[11px] text-fg-muted" title={`全傾斜角: ${inclinations.join(" / ")}°`}>{item.planes.length}軌道面 · 主傾斜 {mainInclination}°</span>
                      <span className="block text-[11px] text-fg-muted">高度 {low.toLocaleString()}{low !== high ? `–${high.toLocaleString()}` : ""} km</span>
                      {item.hasSuppressedRows && <span className="mt-1 block text-[10px] text-amber-400">削除フラグあり・注記を確認</span>}
                    </button>;
                  })}
                </div>
                {dataset.configurations.length > 1 && <p className="text-[11px] text-fg-muted">構成は合計せず、選んだ1案だけを表示します。切り替えると同じ申請の前の配置を置き換えます。</p>}
                {dataset.note && <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-relaxed">{dataset.note}</p>}
                <label className="block text-xs font-medium">仮配置の基準日時（UTC）<input type="datetime-local" value={epoch} onChange={event => setEpoch(event.target.value)} className="mt-1 block w-full rounded border border-line bg-sunken p-2 text-sm text-fg" /></label>
                <details className="text-xs text-fg-muted"><summary className="cursor-pointer py-1">出典の注意点と、配置を描くための仮定</summary><ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">{dataset.warnings.map(w => <li key={w}>{w}</li>)}<li>この日時は表示のための仮の基準です。申請の受領日を軌道の元期として扱いません。</li><li>昇交点の経度をこの日時の地球の向きに合わせ、位相を緯度引数として解釈します。欠損値は等間隔で補い、運用位置を再現するものではありません。</li><li>元ファイルと他の構成はこの画面のメモリ内にのみ保持されます。再読み込み後に構成を切り替えるには、MDBか保存した抽出ファイルを開き直してください。抽出ファイルは端末にだけ保存され、アプリやサーバーには送信されません。選んだ仮配置と出典は設定ファイルに保存できます。</li></ul></details>
              </section>}
              {error && <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-xs leading-relaxed text-red-300">{error}</p>}
            </main>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/50 px-5 py-3">
          <p className="flex items-center gap-2 text-[11px] text-fg-muted"><Diamond className="size-4 text-amber-400" />琥珀色の中抜きダイヤ = 申請上の仮配置</p>
          <Button disabled={!canApply} onClick={apply} className="gap-2">{dataset && appliedHash === selectedHash ? "選んだ構成に切り替えて表示" : "選んだ構成を3D表示"}<ArrowRight className="size-4" /></Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
