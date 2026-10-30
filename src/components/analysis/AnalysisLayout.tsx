// Shared result-side building blocks for the analysis modals. Each screen reads
// top-down: verdict → a few headline numbers → the main chart → supporting
// charts → the remaining metrics as a compact list.
import type { ReactNode } from "react";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";

export type VerdictTone = "ok" | "warn" | "ng";

const VERDICT_ICON = { ok: CircleCheck, warn: CircleAlert, ng: CircleX } as const;

/** One-line pass/fail statement. Colour always comes with an icon and words. */
export function Verdict({ tone, label, detail }: { tone: VerdictTone; label: string; detail?: ReactNode }) {
  const Icon = VERDICT_ICON[tone];
  return (
    <div className={`analysis-verdict analysis-verdict-${tone}`} role="status">
      <Icon className="analysis-verdict-icon" aria-hidden="true" />
      <span className="analysis-verdict-label">{label}</span>
      {detail && <span className="analysis-verdict-detail">{detail}</span>}
    </div>
  );
}

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  /** Short context line under the number, e.g. "下限 30 %". */
  hint?: string;
  tone?: VerdictTone;
}

/** Up to ~4 headline numbers. Everything else belongs in MetricList. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="analysis-kpi-strip">
      {items.map((item) => (
        <div key={item.label} className={`analysis-kpi${item.tone ? ` analysis-kpi-${item.tone}` : ""}`}>
          <div className="analysis-kpi-label">{item.label}</div>
          <div className="analysis-kpi-value">
            {item.value}
            {item.unit && <span className="analysis-kpi-unit">{item.unit}</span>}
          </div>
          {item.hint && <div className="analysis-kpi-hint">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Secondary metrics as a dense label/value list. */
export function MetricList({ items }: { items: Array<[label: string, value: ReactNode]> }) {
  return (
    <dl className="analysis-metric-list">
      {items.map(([label, value]) => (
        <div key={label} className="analysis-metric">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled card around one chart (or a small group). The card names the chart; the canvas does not. */
export function ChartCard({
  title,
  caption,
  actions,
  children,
}: {
  title: string;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="analysis-card">
      <header className="analysis-card-header">
        <div className="min-w-0">
          <h4 className="analysis-card-title">{title}</h4>
          {caption && <div className="analysis-card-caption">{caption}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Shown in place of results before the first run. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="analysis-empty">
      <div className="analysis-empty-title">{title}</div>
      {children && <div className="analysis-empty-body">{children}</div>}
    </div>
  );
}

/** Covers the result area while a worker job runs; shows progress and a cancel button. */
export function BusyOverlay({ progress, detail, onCancel }: { progress: number | null; detail?: ReactNode; onCancel?: () => void }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="analysis-loading-overlay" role="status" aria-live="polite">
      <div className="analysis-loading-spinner" />
      <div className="analysis-loading-text">解析中{pct !== null ? ` ${pct}%` : "..."}</div>
      {pct !== null && (
        <div className="mt-2 h-1.5 w-56 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
      {detail && <div className="analysis-loading-subtext">{detail}</div>}
      {onCancel && (
        <button type="button" onClick={onCancel} className="analysis-secondary-button mt-3">
          中止
        </button>
      )}
    </div>
  );
}
