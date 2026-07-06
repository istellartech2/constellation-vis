import { useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * Compact control primitives shared by the 通信 / 表示 tabs.
 * Long explanations live behind a HelpTip (ⓘ) instead of always-visible
 * paragraphs, so sections stay short in the narrow side panel.
 */

const HELP_BUBBLE_W = 256;
/** Rough bubble height used to decide whether to flip above the icon. */
const HELP_BUBBLE_EST_H = 120;

/** ⓘ button that shows an explanation in an overlay bubble on hover/click. */
export function HelpTip({ text }: { text: string }) {
  // position: fixed + ビューポート内へのクランプで、パネルの overflow に
  // クリップされて右側が見切れる問題を避ける。
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  function open() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - HELP_BUBBLE_W - 8));
    if (r.bottom + HELP_BUBBLE_EST_H > window.innerHeight) {
      setPos({ left, bottom: window.innerHeight - r.top + 4 }); // 下に入らなければ上へ
    } else {
      setPos({ left, top: r.bottom + 4 });
    }
  }
  const close = () => setPos(null);

  return (
    <span className="inline-flex shrink-0" onMouseEnter={open} onMouseLeave={close}>
      <button
        ref={btnRef}
        type="button"
        data-slot="icon-button"
        aria-label="説明を表示"
        onClick={() => (pos ? close() : open())}
        className="p-0.5 bg-transparent border-0 text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Info className="h-3 w-3" />
      </button>
      {pos && (
        <span
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: HELP_BUBBLE_W,
            // 祖先の font-size(em 連鎖)・whitespace-nowrap に影響されないよう明示する
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "normal",
            textAlign: "left",
          }}
          className="z-50 rounded-md border border-gray-600 bg-gray-800 p-2 text-gray-200 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** 1 行に収まるコンパクトなラベル + スライダー + 値の表示。 */
export function InlineSlider({
  label,
  labelW = "w-14",
  value,
  min,
  max,
  step,
  format,
  help,
  onChange,
}: {
  label: string;
  /** Tailwind width class for the label column (aligns rows within a section). */
  labelW?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  help?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-xs text-gray-300 ${labelW} shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap`}
      >
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0"
      />
      <span className="text-xs text-gray-300 tabular-nums w-[72px] text-right shrink-0">
        {format(value)}
      </span>
    </div>
  );
}

/** ラベル + カラースウォッチのコンパクトな 1 組(横に並べて使う)。 */
export function ColorChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-300">
      {label}
      <input
        type="color"
        className="option-color-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={`${label}の色`}
      />
    </label>
  );
}
