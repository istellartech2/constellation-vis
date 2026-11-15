import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Play } from "lucide-react";
import PanelSection from "../ui/PanelSection";
import { HelpTip } from "../ui/compactControls";
import { loadDemoIndex } from "../../lib/tour/load";
import type { DemoEntry } from "../../lib/tour/types";

interface Props {
  /** Start the guided tour of a demo. */
  onStart: (demo: DemoEntry) => void;
}

/** Show a filter box once the list is longer than this. */
const FILTER_THRESHOLD = 6;
const UNCATEGORISED = "その他";

/** Newest first (undated last), then by title. */
function compareDemos(a: DemoEntry, b: DemoEntry): number {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  }
  return a.title.localeCompare(b.title, "ja");
}

function metaLine(demo: DemoEntry): string {
  return [demo.date?.replaceAll("-", "/"), demo.durationMin ? `約${Math.round(demo.durationMin)}分` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 表示タブ末尾の「デモ」: guided tours listed in public/demos/index.json.
 * An extra, not a core feature — collapsed by default and placed last.
 * Built to grow: rows are compact, grouped by `category` when there is more
 * than one, and a filter box appears for longer lists. Hidden when empty.
 */
export default function DemoSection({ onStart }: Props) {
  const [demos, setDemos] = useState<DemoEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex(import.meta.env.BASE_URL).then((list) => {
      if (!cancelled) setDemos(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (demos ?? [])
      .filter((d) => !q || `${d.title} ${d.description ?? ""} ${d.category ?? ""}`.toLowerCase().includes(q))
      .sort(compareDemos);
    const byCategory = new Map<string, DemoEntry[]>();
    for (const d of filtered) {
      const key = d.category ?? UNCATEGORISED;
      byCategory.set(key, [...(byCategory.get(key) ?? []), d]);
    }
    return [...byCategory.entries()];
  }, [demos, query]);

  if (!demos || demos.length === 0) return null;
  const showHeadings = new Set(demos.map((d) => d.category ?? UNCATEGORISED)).size > 1;

  return (
    <PanelSection
      title="デモ（解説付き再生）"
      icon={<Clapperboard />}
      action={<HelpTip text="公開情報などから再現した場面を、字幕とカメラ付きで自動再生します。再生中は操作パネルが隠れ、「終了」で元の表示と設定に戻ります。" />}
      collapsible
      defaultOpen={false}
    >
      {demos.length > FILTER_THRESHOLD && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="デモを絞り込む"
          aria-label="デモを絞り込む"
          className="mb-2 h-7 w-full rounded-md border border-line-strong bg-raised px-2 text-xs text-fg placeholder:text-fg-subtle"
        />
      )}
      {groups.length === 0 && <p className="text-xs text-fg-muted">該当するデモはありません。</p>}
      {groups.map(([category, list]) => (
        <div key={category} className="mb-2 last:mb-0">
          {showHeadings && <p className="mb-1 text-[11px] font-medium text-fg-subtle">{category}</p>}
          <ul className="divide-y divide-line rounded border border-line">
            {list.map((demo) => (
              <li key={demo.id} className="flex items-center gap-2 px-2 py-1.5" title={demo.description}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-fg">{demo.title}</p>
                  {metaLine(demo) && <p className="text-[11px] text-fg-subtle">{metaLine(demo)}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onStart(demo)}
                  aria-label={`${demo.title} を再生`}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-raised px-2 text-[11px] text-fg hover:bg-raised-hover"
                >
                  <Play className="size-3 fill-current" />
                  再生
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </PanelSection>
  );
}
