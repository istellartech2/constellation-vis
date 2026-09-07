import { HelpTip } from "./compactControls";

export interface DerivedInfoItem {
  label: string;
  value: string;
  help?: string;
  tone?: "normal" | "warn" | "ok";
}

interface Props {
  items: DerivedInfoItem[];
  columns?: 2 | 3;
  className?: string;
  title?: string;
}

const TONE_CLS: Record<NonNullable<DerivedInfoItem["tone"]>, string> = {
  normal: "text-gray-200",
  warn: "text-amber-300",
  ok: "text-emerald-300",
};

/** Compact read-only grid of derived/computed values (e.g. orbital period, RGT ratio). */
export default function DerivedInfoStrip({ items, columns = 2, className, title }: Props) {
  const gridCls = columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2";

  return (
    <div className={`rounded border border-gray-800 bg-gray-900/40 p-2 ${className ?? ""}`}>
      {title && <div className="text-xs font-medium text-gray-400 mb-1.5">{title}</div>}
      <div className={`grid ${gridCls} gap-x-3 gap-y-1 text-[11px]`}>
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-gray-500 inline-flex items-center gap-0.5">
              {item.label}
              {item.help && <HelpTip text={item.help} />}
            </span>
            <span className={`tabular-nums ${TONE_CLS[item.tone ?? "normal"]}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
