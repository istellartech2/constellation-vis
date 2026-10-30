import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, ExternalLink, Info, Search } from "lucide-react";
import { FILING_CATALOG, hasPlacement, searchFilingCatalog, type FilingCatalogEntry } from "../../../lib/filings/catalog";
import { MAX_FILING_EXTRACT_BYTES, filingExtractFilename, parseFilingExtract, type FilingExtract } from "../../../lib/filings/extract";
import { filingCatalog } from "../../../lib/filings/geometry";
import type { FilingConfiguration, FilingDataset, FilingWorkerResponse } from "../../../lib/filings/types";
import { downloadFile } from "../../../lib/config";
import { DestinationPicker, FileDropZone, ImportFooter, ImportStatus } from "./ImportParts";
import { SCENARIO_LIMIT, destinationBlock, recommendedDestination, type ImportDestination, type ImportTargets } from "./importTargets";

/** A filing already placed in the scenario, keyed by filingKey. */
export interface PlacedFiling { configuration: string; count: number }
interface Props {
  targets: ImportTargets;
  placed: Record<string, PlacedFiling>;
  /** Replace this filing's satellites in the editor and apply (also moves the start time to `epoch`). */
  onApplyToScenario: (dataset: FilingDataset, configuration: string, epoch: Date) => void;
}
const COUNTRIES = [...new Set(FILING_CATALOG.map(entry => entry.country))].sort((a, b) => a.localeCompare(b, "ja"));
function SourceRow({ item }: { item: FilingCatalogEntry }) {
  const meta = [item.satellites !== undefined && `${item.satellites.toLocaleString()}機`, item.submission, item.date, item.country].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-1.5 pl-8 pr-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.reference}>{item.name}</p>
        <p className="truncate text-[11px] text-fg-muted" title={item.description}>{meta}{item.description && <span className="text-fg-subtle"> · {item.description}</span>}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-text hover:underline">{item.agency}で開く<ExternalLink className="size-3" /></a>
        {!hasPlacement(item) && <span className="text-[10px] text-fg-subtle">配置データなし</span>}
      </div>
    </li>
  );
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

export default function FilingPanel({ targets, placed, onApplyToScenario }: Props) {
  const defaultEpoch = targets.startText;
  const [dataset, setDataset] = useState<FilingDataset | null>(null);
  const [extract, setExtract] = useState<FilingExtract | null>(null);
  const [configuration, setConfiguration] = useState("");
  const [epoch, setEpoch] = useState(defaultEpoch);
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState<ImportDestination>("scenario");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => searchFilingCatalog(FILING_CATALOG, query, country), [query, country]);
  const matched = groups.reduce((sum, g) => sum + g.count, 0);
  // While filtering, show every match instead of making people reopen groups.
  const filtering = Boolean(query.trim() || country);
  const toggleSystem = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const config = dataset?.configurations.find(item => item.id === configuration);
  const existing = dataset ? placed[dataset.key] : undefined;
  const epochDate = new Date(epoch + "Z");
  const block = config ? destinationBlock(destination, config.count, targets) : null;
  const canPlace = Boolean(config && !busy && Number.isFinite(epochDate.valueOf())) && block === null;
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
    const configId = placed[next.key]?.configuration ?? next.preferredConfiguration;
    setConfiguration(configId);
    const count = next.configurations.find(c => c.id === configId)?.count ?? 0;
    setDestination(placed[next.key] ? "scenario" : count > SCENARIO_LIMIT ? "layer" : recommendedDestination(count));
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
      const worker = new Worker(new URL("../../../workers/filingImportWorker.ts", import.meta.url), { type: "module" });
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
  function close() { stop(); targets.close(); }
  function apply() {
    if (!dataset || !config || !canPlace) return;
    try {
      if (destination === "scenario") {
        onApplyToScenario(dataset, configuration, epochDate);
      } else {
        targets.addLayer({
          id: `filing:${dataset.key}:${configuration}:${epochDate.toISOString()}`,
          name: `${dataset.name}（${configurationLabel(configuration)}）`,
          kind: "filing",
          detail: `ITU申請上の仮配置 · 基準 ${epochDate.toISOString().slice(0, 16).replace("T", " ")} UTC`,
          catalog: filingCatalog(dataset, configuration, epochDate),
        });
      }
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "配置を反映できませんでした。"); }
  }

  const applyLabel = !dataset ? "申請ファイルを開いてください"
    : !config ? "構成を選んでください"
    : destination === "layer" ? `${config.count.toLocaleString()} 機を表示レイヤーに追加`
    : !existing ? `${config.count.toLocaleString()} 機をシミュレーション対象に追加`
    : existing.configuration === configuration ? "配置を更新"
    : `${configurationLabel(configuration)}に置き換え`;
  const applyHint = !config ? "" : destination === "layer"
    ? "基準日時の配置で3Dビューに表示します。開始時刻は変えません。"
    : existing
    ? `シミュレーション対象の「${dataset!.name}」${existing.count.toLocaleString()}機（${configurationLabel(existing.configuration)}）を置き換えます。開始時刻を基準日時に合わせます。`
    : "既存の衛星はそのまま残り、3Dビューに反映されます。開始時刻を基準日時に合わせます。";

  return (
    <>
        <div className={`flex-1 min-h-0 px-4 py-3 ${dataset ? "overflow-y-auto overscroll-contain space-y-4" : "flex flex-col gap-4"}`}>
          {!dataset ? <>
            <FileDropZone accept=".mdb,.json" title="申請ファイルを開く" description="SNS MDB（.mdb）または保存した抽出ファイル（.filing.json）" busy={busy} onFile={file => void loadFile(file)} />

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">ファイルの入手先</h3>
                <span className="text-xs text-fg-muted tabular-nums">{filtering ? `${matched} / ${FILING_CATALOG.length} 件` : `${groups.length} システム · ${FILING_CATALOG.length} 件`}</span>
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">ITUの申請ページで、添付の「SNS(MDB) As Received Copy」をダウンロードします（ZIPは展開）。</p>
              <div className="mt-2 flex gap-2">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">申請を検索</span>
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Starlink・GW-2・参照番号など" className="h-8 w-full rounded border-2 border-line-strong bg-sunken pl-7 pr-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-brand" />
                </label>
                <select aria-label="国で絞り込む" value={country} onChange={event => setCountry(event.target.value)} className="h-8 shrink-0 rounded border-2 border-line-strong bg-sunken px-1.5 text-sm text-fg outline-none focus:border-brand">
                  <option value="">すべての国</option>
                  {COUNTRIES.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              {groups.length ? (
                <div className="mt-2 min-h-40 flex-1 divide-y divide-line overflow-y-auto overscroll-contain rounded-md border border-line bg-raised">
                  {groups.map(({ system, series, count }) => {
                    const open = filtering || expanded.has(system.id);
                    return (
                      <section key={system.id} aria-label={system.name}>
                        <button type="button" aria-expanded={open} onClick={() => toggleSystem(system.id)} disabled={filtering}
                          className="sticky top-0 z-10 flex w-full items-center gap-2 bg-raised px-3 py-2 text-left hover:bg-raised-hover disabled:cursor-default disabled:hover:bg-raised">
                          <ChevronRight className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{system.name}{system.operator && <span className="ml-2 text-[11px] font-normal text-fg-subtle">{system.operator}</span>}</span>
                            {!open && <span className="block truncate text-[11px] text-fg-muted">{system.description}</span>}
                          </span>
                          <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">{count}件</span>
                        </button>
                        {open && <div className="pb-1">
                          {series.map(item => (
                            <div key={item.id}>
                              {(system.series.length > 1 || item.description) && (
                                <p className="truncate px-3 pb-0.5 pl-8 pt-1.5 text-[11px] text-fg-subtle">
                                  <span className="font-semibold text-fg-muted">{item.label}</span>{item.description && ` · ${item.description}`}
                                </p>
                              )}
                              <ul>{item.entries.map(entry => <SourceRow key={entry.id} item={entry} />)}</ul>
                            </div>
                          ))}
                        </div>}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 rounded-md border border-line bg-raised px-3 py-4 text-center text-xs text-fg-muted">
                  該当する申請はありません。
                  <button type="button" onClick={() => { setQuery(""); setCountry(""); }} className="ml-1 underline hover:text-fg">条件をクリア</button>
                </p>
              )}
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
                <button type="button" onClick={back} className="text-fg-muted underline hover:text-fg">選び直す</button>
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
                        {existing?.configuration === item.id && <span className="block text-[11px] text-fg-subtle">シミュレーション対象に配置中</span>}
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
              <p className="mt-1 text-[11px]">初期値は現在の開始時刻です。「解析に使う」で追加すると開始時刻もこの日時に合わせます。</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                {dataset.warnings.map(w => <li key={w}>{w}</li>)}
                <li>昇交点の経度を基準日時の地球の向きに合わせ、位相を緯度引数として解釈します。欠損値は等間隔で補います。申請の幾何を示す概念配置で、運用位置の再現ではありません。</li>
                <li>3Dでは中抜きの円で、実在の衛星と区別して表示します。</li>
              </ul>
            </details>
            {config && <DestinationPicker value={destination} onChange={setDestination} count={config.count} targets={targets} />}
          </>}
          <ImportStatus busy={busy ? "端末内で解析中…" : null} onCancel={stop} error={error} />
        </div>
        <ImportFooter hint={dataset ? applyHint : undefined} primaryLabel={applyLabel} onPrimary={apply} disabled={!canPlace} onCancel={close} />
    </>
  );
}
