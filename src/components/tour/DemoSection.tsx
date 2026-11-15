import { useEffect, useState } from "react";
import { Clapperboard, Play } from "lucide-react";
import PanelSection from "../ui/PanelSection";
import { loadDemoIndex } from "../../lib/tour/load";
import type { DemoEntry } from "../../lib/tour/types";

interface Props {
  /** Start the guided tour of a demo. */
  onStart: (demo: DemoEntry) => void;
}

/** 表示タブ「デモ」: guided tours listed in public/demos/index.json. Hidden when there are none. */
export default function DemoSection({ onStart }: Props) {
  const [demos, setDemos] = useState<DemoEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex(import.meta.env.BASE_URL).then((list) => {
      if (!cancelled) setDemos(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!demos || demos.length === 0) return null;

  return (
    <PanelSection title="デモ" icon={<Clapperboard />}>
      <ul className="space-y-2">
        {demos.map((demo) => (
          <li key={demo.id} className="flex items-start gap-2 rounded border border-line bg-raised px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{demo.title}</p>
              {demo.description && <p className="text-[11px] leading-snug text-fg-muted">{demo.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => onStart(demo)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-brand px-2.5 text-xs font-medium text-brand-fg hover:bg-brand-hover"
              title="解説付きで自動再生します（終了で元の表示に戻ります）"
            >
              <Play className="size-3.5 fill-current" />
              再生
            </button>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
