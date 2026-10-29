import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FileUp, Info, Loader2, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { AI_FILING, FILING_CATALOG } from "../../lib/filings/catalog";
import { MAX_FILING_EXTRACT_BYTES, filingExtractFilename, parseFilingExtract, type FilingExtract } from "../../lib/filings/extract";
import type { FilingConfiguration, FilingDataset, FilingWorkerResponse } from "../../lib/filings/types";
import { downloadFile } from "../../lib/config";

/** A filing already placed in the scenario, keyed by filingKey. */
export interface PlacedFiling { configuration: string; count: number }
interface Props {
  open: boolean;
  /** Scenario start time ("YYYY-MM-DDTHH:mm", UTC); the default placement epoch. */
  defaultEpoch: string;
  placed: Record<string, PlacedFiling>;
  onClose: () => void;
  onApply: (dataset: FilingDataset, configuration: string, epoch: Date) => void;
}
function configurationLabel(id: string) { return id === "default" ? "単一構成" : `構成 ${id}`; }
function summarize(config: FilingConfiguration) {
  const counts = new Map<number, number>();
  config.planes.forEach(p => counts.set(p.inclination, (counts.get(p.inclination) ?? 0) + p.satellites));
  const inclination = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const low = Math.min(...config.planes.map(p => p.perigee));
  const high = Math.max(...config.planes.map(p => p.apogee));
  return { inclination, altitude: `${low.toLocaleString()}${low !== high ? `–${high.toLocaleString()}` : ""} km` };
}

export default function FilingImportDialog({ open, defaultEpoch, placed, onClose, onApply }: Props) {
  const [dataset, setDataset] = useState<FilingDataset | null>(null);
  const [extract, setExtract] = useState<FilingExtract | null>(null);
  const [configuration, setConfiguration] = useState("");
  const [epoch, setEpoch] = useState(defaultEpoch);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const config = dataset?.configurations.find(item => item.id === configuration);
  const existing = dataset ? placed[dataset.key] : undefined;
  const epochDate = new Date(epoch + "Z");
  const canApply = Boolean(config && !busy && Number.isFinite(epochDate.valueOf()));

  useEffect(() => { if (open) setEpoch(defaultEpoch); }, [open, defaultEpoch]);
  useEffect(() => () => {
    generation.current++;
    workerRef.current?.terminate();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function stop() {
    generation.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setBusy(false);
  }
  function show(next: FilingDataset, nextExtract: FilingExtract) {
    setDataset(next);
    setExtract(nextExtract);
    setConfiguration(placed[next.key]?.configuration ?? next.preferredConfiguration);
    setError(null);
  }
  async function loadExtract(file: File) {
    if (file.size > MAX_FILING_EXTRACT_BYTES) { setError("抽出ファイルが大きすぎます（上限16 MB）。"); return; }
    const token = generation.current;
    try {
      const result = parseFilingExtract(await file.text());
      if (token === generation.current) show(result.dataset, result.extract);
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : "抽出ファイルを読み込めませんでした。");
    }
  }
  async function loadFile(file: File) {
    stop();
    setError(null);
    if (/\.json$/i.test(file.name)) { await loadExtract(file); return; }
    if (!/\.mdb$/i.test(file.name)) { setError("SNS形式の .mdb か、保存した抽出ファイル（.filing.json）を選んでください。ZIPは先に展開してください。PDF・GIMS・マスク用MDBは読み込めません。"); return; }
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
        show(result.dataset, result.extract);
      };
      worker.onerror = () => fail("MDBの解析に失敗しました。ファイルが破損していないか、SNS形式かを確認してください。");
      timerRef.current = setTimeout(() => fail("解析を中止しました。個別申請のSNS MDBを選び直してください。"), 60000);
      worker.postMessage({ buffer, filename: file.name }, [buffer]);
    } catch (cause) {
      if (token !== generation.current) return;
      stop(); setError(cause instanceof Error ? cause.message : "ファイルを読み込めませんでした。");
    }
  }
  function back() { stop(); setDataset(null); setExtract(null); setError(null); }
  function close() { stop(); onClose(); }
  function apply() {
    if (!dataset || !canApply) return;
    try {
      onApply(dataset, configuration, epochDate);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "配置を反映できませんでした。"); }
  }

  const applyLabel = !config ? "構成を選んでください"
    : !existing ? `${config.count.toLocaleString()} 機をシナリオに追加`
    : existing.configuration === configuration ? "配置を更新"
    : `${configurationLabel(configuration)}に置き換え`;
  const applyHint = !config ? "" : existing
    ? `シナリオ内の「${dataset!.name}」${existing.count.toLocaleString()}機（${configurationLabel(existing.configuration)}）を置き換えます。他の衛星はそのままです。`
    : "既存の衛星はそのまま残り、3Dビューに反映されます。";

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="dialog-flush !w-[95vw] !max-w-2xl !max-h-[90vh] max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col gap-0 p-0 bg-surface-solid text-fg border-line">
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-line max-md:pr-12 max-md:py-3 shrink-0">
          <div className="flex items-center gap-2 pr-8">
            {dataset && <button type="button" onClick={back} aria-label="ファイルを選び直す" title="ファイルを選び直す" className="-ml-1 inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-raised-hover hover:text-fg"><ArrowLeft className="size-4" /></button>}
            <DialogTitle className="text-fg text-base max-md:text-left">ITU申請からインポート</DialogTitle>
          </div>
          <DialogDescription className="sr-only">ITUの申請ファイルを端末内で読み込み、申請上の配置をシナリオに追加します。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
          {!dataset ? <>
            <div
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !busy) void loadFile(file); }}
              className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-sunken"}`}
            >
              <input ref={inputRef} type="file" accept=".mdb,.json" className="hidden" aria-label="申請ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void loadFile(file); }} />
              <p className="text-sm font-semibold">申請ファイルを開く</p>
              <p className="mt-1 text-xs text-fg-muted">SNS MDB（.mdb）または保存した抽出ファイル（.filing.json）</p>
              <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-3 h-9 gap-2 bg-brand hover:bg-brand-hover text-white font-semibold">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{busy ? "端末内で解析中…" : "ファイルを選択"}
              </Button>
              {busy ? <button type="button" onClick={stop} className="mt-2 block w-full text-xs text-fg-muted underline">解析を中止</button>
                : <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-fg-subtle"><ShieldCheck className="size-3" />ドロップも可 · 端末内で解析し、送信しません</p>}
            </div>

            <section>
              <h3 className="text-sm font-semibold">ファイルの入手先</h3>
              <p className="mt-0.5 mb-2 text-xs text-fg-muted">ITUの申請ページで、添付の「SNS(MDB) As Received Copy」をダウンロードします（ZIPは展開）。</p>
              <ul className="space-y-1.5">
                {FILING_CATALOG.map(item => (
                  <li key={item.id} className="flex items-center gap-3 rounded-md border border-line bg-raised px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.name}<span className="ml-2 text-[11px] font-normal text-fg-subtle">{item.country} · {item.date}</span></p>
                      <p className="truncate text-[11px] text-fg-muted" title={item.description}>{item.description}</p>
                    </div>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-text hover:underline">ITUで開く<ExternalLink className="size-3" /></a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-fg-subtle">
                参考（配置データなし）：<a href={AI_FILING.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-fg-muted hover:text-fg hover:underline">{AI_FILING.name}<ExternalLink className="size-3" /></a>
              </p>
            </section>
          </> : <>
            <section className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold break-all">{dataset.name}
                  {dataset.fromExtract ? <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[10px] font-normal text-fg-muted">抽出ファイル</span>
                    : !dataset.reference && <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-normal text-warning">未レビュー</span>}
                </p>
                <p className="text-[11px] text-fg-muted break-all">{[dataset.reference, dataset.sourceDate && `${dataset.sourceDate} 受領`, dataset.filename].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {dataset.sourceUrl && <a href={dataset.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">申請ページ<ExternalLink className="size-3" /></a>}
                {extract && !dataset.fromExtract && <button type="button" onClick={() => downloadFile(filingExtractFilename(dataset), JSON.stringify(extract))} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg" title="軌道に必要な値だけを端末に保存し、次回はMDBなしで開けます。再配布はITUの利用条件に従ってください。"><Download className="size-3" />抽出ファイルを保存</button>}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold">構成を選ぶ</h3>
              {dataset.configurations.length > 1 && <p className="mt-0.5 text-xs text-fg-muted">代替案は合計せず、1つだけを配置します。</p>}
              <div role="radiogroup" aria-label="配置の構成" className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {dataset.configurations.map(item => {
                  const { inclination, altitude } = summarize(item);
                  const selected = configuration === item.id;
                  return (
                    <button key={item.id} type="button" role="radio" aria-checked={selected} onClick={() => setConfiguration(item.id)}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${selected ? "border-brand bg-brand-soft" : "border-line bg-raised hover:bg-raised-hover hover:border-line-strong"}`}>
                      <span className={`mt-1 size-3.5 shrink-0 rounded-full border-2 ${selected ? "border-brand bg-brand shadow-[inset_0_0_0_2px_var(--surface-solid)]" : "border-line-strong"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium">{configurationLabel(item.id)}</span>
                          <span className="tabular-nums"><span className="font-semibold">{item.count.toLocaleString()}</span><span className="ml-0.5 text-xs text-fg-muted">機</span></span>
                        </span>
                        <span className="block text-[11px] text-fg-muted">{item.planes.length}軌道面 · 傾斜角 {inclination}° · 高度 {altitude}</span>
                        {existing?.configuration === item.id && <span className="block text-[11px] text-fg-subtle">シナリオに配置中</span>}
                        {item.hasSuppressedRows && <span className="block text-[11px] text-warning">削除フラグ（S）あり · 注記を確認</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {dataset.note && <p className="flex gap-2 rounded-md border border-line bg-sunken p-2.5 text-xs leading-relaxed text-fg-muted"><Info className="mt-0.5 size-3.5 shrink-0 text-info" />{dataset.note}</p>}

            <details className="rounded-md border border-line px-3 py-2 text-xs text-fg-muted">
              <summary className="cursor-pointer text-fg">配置の基準日時と仮定</summary>
              <label className="mt-2 block">基準日時（UTC）<input type="datetime-local" value={epoch} onChange={event => setEpoch(event.target.value)} className="mt-1 block w-full rounded border-2 border-line-strong bg-sunken px-2 py-1 text-sm text-fg outline-none focus:border-brand" /></label>
              <p className="mt-1 text-[11px]">初期値はシナリオの開始時刻です。反映すると開始時刻もこの日時に合わせます。</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                {dataset.warnings.map(w => <li key={w}>{w}</li>)}
                <li>昇交点の経度を基準日時の地球の向きに合わせ、位相を緯度引数として解釈します。欠損値は等間隔で補います。申請の幾何を示す概念配置で、運用位置の再現ではありません。</li>
                <li>3Dでは中抜きの円で、実在の衛星と区別して表示します。</li>
              </ul>
            </details>
          </>}
          {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-2.5 text-xs leading-relaxed text-danger">{error}</p>}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-line gap-2 sm:gap-3 flex-col sm:flex-row sm:items-center shrink-0">
          {dataset && <p className="text-[11px] leading-snug text-fg-muted sm:flex-1">{applyHint}</p>}
          <div className={`flex gap-2 ${dataset ? "" : "sm:ml-auto"}`}>
            <Button variant="outline" onClick={close} className="h-10 max-md:h-11 bg-sunken border-line-strong text-fg hover:bg-raised-hover hover:text-fg">{dataset ? "キャンセル" : "閉じる"}</Button>
            {dataset && <Button onClick={apply} disabled={!canApply} className="h-10 max-md:h-11 max-md:flex-1 bg-brand hover:bg-brand-hover text-white font-semibold disabled:opacity-50">{applyLabel}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
