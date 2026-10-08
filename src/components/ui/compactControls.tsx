import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const tipId = useId();
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
        aria-describedby={pos ? tipId : undefined}
        onFocus={open}
        onBlur={close}
        onClick={() => (pos ? close() : open())}
        className="p-0.5 bg-transparent border-0 text-fg-subtle hover:text-fg-muted transition-colors"
      >
        <Info className="h-3 w-3" />
      </button>
      {pos && createPortal(
        <span
          id={tipId}
          role="tooltip"
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
          className="pointer-events-none z-[400] rounded-md border border-line-strong bg-sunken p-2 text-fg shadow-lg"
        >
          {text}
        </span>, document.body
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
        className={`text-xs text-fg-muted ${labelW} shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap`}
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
      <span className="text-xs text-fg-muted tabular-nums w-[72px] text-right shrink-0">
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
    <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
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
