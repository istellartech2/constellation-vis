import { useRef, useState, type ReactNode } from "react";
import { Cpu, FileUp, Layers, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../button";
import { DialogFooter } from "../dialog";
import { cn } from "../../../lib/utils";
import { destinationBlock, recommendedDestination, type ImportDestination, type ImportTargets } from "./importTargets";

const DESTINATIONS: { id: ImportDestination; icon: ReactNode; title: string; points: string[] }[] = [
  {
    id: "scenario",
    icon: <Cpu className="size-4" />,
    title: "シナリオに追加",
    points: ["SGP4で精密に計算", "解析・ISLの対象", "エディタで編集・保存"],
  },
  {
    id: "layer",
    icon: <Layers className="size-4" />,
    title: "表示レイヤーに追加",
    points: ["GPUで高速表示（J2近似）", "100万機規模まで", "表示のみ・解析の対象外"],
  },
];

/** The same "where should these satellites go" choice in every source. */
export function DestinationPicker({ value, onChange, count, targets, fixed }: {
  value: ImportDestination;
  onChange: (next: ImportDestination) => void;
  /** Satellites to add; null while unknown. */
  count: number | null;
  targets: ImportTargets;
  /** Restrict to one destination (e.g. synthetic sets are layer-only). */
  fixed?: ImportDestination;
}) {
  const recommended = count === null ? null : recommendedDestination(count);
  return (
    <section>
      <h3 className="text-sm font-semibold">追加先</h3>
      <div role="radiogroup" aria-label="追加先" className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {DESTINATIONS.map((d) => {
          const block = fixed && fixed !== d.id ? "このデータはレイヤーとして追加します" : destinationBlock(d.id, count ?? 0, targets);
          const selected = value === d.id;
          return (
            <button key={d.id} type="button" role="radio" aria-checked={selected} disabled={block !== null} onClick={() => onChange(d.id)}
              className={cn(
                "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selected ? "border-brand bg-brand-soft" : "border-line bg-raised hover:bg-raised-hover hover:border-line-strong",
              )}>
              <span className={cn("mt-0.5 shrink-0", selected ? "text-brand-text" : "text-fg-muted")}>{d.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {d.title}
                  {recommended === d.id && block === null && <span className="rounded bg-brand px-1 py-px text-[10px] font-semibold text-brand-fg">推奨</span>}
                </span>
                <span className="block text-[11px] leading-snug text-fg-muted">{block ?? d.points.join(" · ")}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Footer shared by every source: context hint, cancel, one primary action. */
export function ImportFooter({ hint, primaryLabel, onPrimary, disabled, busy, onCancel, secondary }: {
  hint?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
  busy?: boolean;
  onCancel: () => void;
  secondary?: ReactNode;
}) {
  return (
    <DialogFooter className="px-4 py-3 border-t border-line gap-2 sm:gap-3 flex-col sm:flex-row sm:items-center shrink-0">
      <p className="text-[11px] leading-snug text-fg-muted sm:flex-1 empty:hidden">{hint}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="h-10 max-md:h-11 bg-sunken border-line-strong text-fg hover:bg-raised-hover hover:text-fg">閉じる</Button>
        {secondary}
        <Button onClick={onPrimary} disabled={disabled || busy} className="h-10 max-md:h-11 max-md:flex-1 gap-2 bg-brand hover:bg-brand-hover text-white font-semibold disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />}{primaryLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

/** Busy line with cancel, and the error box; identical across sources. */
export function ImportStatus({ busy, onCancel, error }: { busy: string | null; onCancel?: () => void; error: string | null }) {
  return (
    <>
      {busy && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" />{busy}
          {onCancel && <button type="button" onClick={onCancel} className="text-[11px] text-fg-muted underline hover:text-fg">中止</button>}
        </p>
      )}
      {error && <p role="alert" className="whitespace-pre-line rounded-md border border-danger/40 bg-danger-soft p-2.5 text-xs leading-relaxed text-danger">{error}</p>}
    </>
  );
}

/** Drop zone + file button used by every file-based source. */
export function FileDropZone({ accept, title, description, busy, onFile }: {
  accept: string;
  title: string;
  description: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !busy) onFile(f); }}
      className={cn("flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-2 border-dashed px-4 py-3 transition-colors", dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-sunken")}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" aria-label={title} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-fg-muted">{description}</p>
        <p className="flex items-center gap-1 text-[11px] text-fg-subtle"><ShieldCheck className="size-3" />ドロップも可 · 端末内で解析し、送信しません</p>
      </div>
      <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="h-9 shrink-0 gap-2 bg-raised hover:bg-raised-hover border-2 border-line-strong hover:border-brand text-fg max-sm:w-full">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{busy ? "解析中…" : "ファイルを選択"}
      </Button>
    </div>
  );
}

/** "What will be added" card, shown before the destination choice. */
export function ImportSummary({ title, count, detail, onReset }: { title: string; count: number; detail?: ReactNode; onReset?: () => void }) {
  return (
    <section className="flex items-start gap-3 rounded-md border border-line bg-raised px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={title}>{title}</p>
        {detail && <p className="text-[11px] text-fg-muted">{detail}</p>}
      </div>
      <p className="shrink-0 tabular-nums"><span className="text-lg font-semibold">{count.toLocaleString()}</span><span className="ml-0.5 text-xs text-fg-muted">機</span></p>
      {onReset && <button type="button" onClick={onReset} className="shrink-0 self-center text-[11px] text-fg-muted underline hover:text-fg">選び直す</button>}
    </section>
  );
}
