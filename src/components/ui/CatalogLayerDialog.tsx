import { useEffect, useRef, useState } from "react";
import { Cpu, FileUp, FlaskConical, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import type { CatalogLayer } from "../../lib/catalogLayers";
import { MASS_FOCUS_LIMIT, MASS_MAX_STATIONS, MASS_MODE_THRESHOLD, isMassMode } from "../../lib/massSatelliteLayer";
import type { CatalogImportRequest, CatalogImportResponse } from "../../workers/catalogImportWorker";

/** Largest file read (V8 strings top out around 512 MB). */
const MAX_CATALOG_FILE_BYTES = 480 * 1024 * 1024;
const SYNTHETIC_COUNTS = [10_000, 100_000, 1_000_000];
const FORMAT_LABEL = { tle: "TLE/3LE", "omm-json": "OMM JSON", "omm-csv": "OMM CSV", synthetic: "合成" } as const;

interface Props {
  open: boolean;
  layers: CatalogLayer[];
  /** Satellites defined in the editor, drawn before the layers. */
  editorCount: number;
  /** Scenario start time; the synthetic set's epoch. */
  startTime: Date;
  onAdd: (layer: CatalogLayer) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function CatalogLayerDialog({ open, layers, editorCount, startTime, onAdd, onRemove, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syntheticCount, setSyntheticCount] = useState(SYNTHETIC_COUNTS[1]);
  const workerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const layerTotal = layers.reduce((sum, l) => sum + l.catalog.count, 0);
  const total = editorCount + layerTotal;

  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(null);
  };
  useEffect(() => () => workerRef.current?.terminate(), []);

  function run(request: CatalogImportRequest, label: string, describe: (r: Extract<CatalogImportResponse, { ok: true }>) => Omit<CatalogLayer, "id" | "catalog">) {
    stop();
    setError(null);
    setBusy(label);
    const worker = new Worker(new URL("../../workers/catalogImportWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<CatalogImportResponse>) => {
      if (workerRef.current !== worker) return;
      stop();
      const result = event.data;
      if (!result.ok) { setError(result.message); return; }
      onAdd({ id: newId(), catalog: result.catalog, ...describe(result) });
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      stop();
      setError("読み込みに失敗しました。メモリ不足の可能性があります。TLEかCSVを使うか、ファイルを分割してください。");
    };
    worker.postMessage(request);
  }

  function loadFile(file: File) {
    if (file.size > MAX_CATALOG_FILE_BYTES) {
      setError("ファイルが大きすぎます（上限 480 MB）。分割して読み込んでください。");
      return;
    }
    run({ kind: "file", file }, `${file.name} を解析中…`, (r) => ({
      name: file.name,
      kind: "file",
      detail: `${FORMAT_LABEL[r.format]}${r.skipped ? ` · ${r.skipped.toLocaleString()}行を除外` : ""}`,
    }));
  }

  function addSynthetic() {
    run({ kind: "synthetic", count: syntheticCount, epochMs: startTime.getTime() }, "合成カタログを生成中…", () => ({
      name: `合成テスト ${syntheticCount.toLocaleString()}機`,
      kind: "synthetic",
      detail: "負荷試験用のWalker風シェル（実在しない衛星）",
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) { stop(); onClose(); } }}>
      <DialogContent className="dialog-flush !w-[95vw] !max-w-xl !max-h-[90vh] max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col gap-0 p-0 bg-surface-solid text-fg border-line">
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-line max-md:pr-12 max-md:py-3 shrink-0">
          <DialogTitle className="text-fg text-base max-md:text-left">大規模カタログ</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            1万〜100万機規模のTLE/OMMをエディタを通さずに読み込みます。ブラウザ内（IndexedDB）に保存され、再読み込み後も残ります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
          <section className="rounded border border-line bg-raised px-3 py-2 text-xs text-fg-muted space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Cpu className="size-4" />
              合計 {total.toLocaleString()}機 · {isMassMode(total) ? "GPU近似表示" : "SGP4表示"}
            </p>
            <p>
              合計{MASS_MODE_THRESHOLD.toLocaleString()}機を超えると、全衛星をGPUでJ2永年摂動の解析解により計算します（SGP4との差は低軌道で1日あたり数〜10 km程度）。
              可視判定の色分けは地上局{MASS_MAX_STATIONS}局まで全機に適用し、リンク線・FOVコーンは最大{MASS_FOCUS_LIMIT}機に制限します。
            </p>
            <p>解析タブとISL経路はエディタの衛星のみが対象です。</p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">読み込み済み</h3>
            {layers.length === 0 ? (
              <p className="text-xs text-fg-muted">まだありません。</p>
            ) : (
              <ul className="divide-y divide-line rounded border border-line">
                {layers.map((layer) => (
                  <li key={layer.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={layer.name}>{layer.name}</p>
                      <p className="truncate text-[11px] text-fg-muted">{layer.catalog.count.toLocaleString()}機 · {layer.detail}</p>
                    </div>
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => onRemove(layer.id)} aria-label={`${layer.name} を削除`} className="h-8 shrink-0 gap-1 bg-sunken border-line-strong text-fg hover:bg-raised-hover">
                      <Trash2 className="size-3.5" />削除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">ファイルから追加</h3>
            <p className="text-xs text-fg-muted">TLE/3LE（.txt/.tle）、OMM JSON、OMM CSV。100万機規模ではTLEかCSVが軽量です。ITU申請は「ITU申請からインポート」の「大規模カタログとして配置」から追加できます。</p>
            <input ref={inputRef} type="file" accept=".txt,.tle,.3le,.json,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadFile(f); }} />
            <Button variant="outline" disabled={busy !== null} onClick={() => inputRef.current?.click()} className="w-full h-9 gap-2 bg-raised hover:bg-raised-hover border-2 border-line-strong hover:border-brand text-fg">
              <FileUp className="size-4" />ファイルを選択
            </Button>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">負荷試験用の合成カタログ</h3>
            <div className="flex gap-2">
              <select value={syntheticCount} disabled={busy !== null} onChange={(e) => setSyntheticCount(Number(e.target.value))} className="flex-1 text-sm bg-sunken border-2 border-line-strong text-fg rounded px-2 py-1 focus:border-brand outline-none">
                {SYNTHETIC_COUNTS.map((n) => <option key={n} value={n}>{n.toLocaleString()}機</option>)}
              </select>
              <Button variant="outline" disabled={busy !== null} onClick={addSynthetic} className="h-9 gap-2 bg-raised hover:bg-raised-hover border-2 border-line-strong hover:border-brand text-fg">
                <FlaskConical className="size-4" />生成
              </Button>
            </div>
          </section>

          {busy && (
            <p className="flex items-center gap-2 text-sm" role="status"><Loader2 className="size-4 animate-spin" />{busy}</p>
          )}
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-line shrink-0">
          <Button variant="outline" onClick={() => { stop(); onClose(); }} className="h-10 w-full sm:w-auto bg-sunken border-line-strong text-fg hover:bg-raised-hover hover:text-fg">
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
