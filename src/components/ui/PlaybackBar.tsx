import { useEffect, type RefObject } from "react";
import { ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";

// Predefined playback speeds (multiples of real time)
const SPEED_OPTIONS = [1, 5, 10, 30, 60, 120, 240, 360, 600];

interface Props {
  /** Speed as log10 of the real-time multiplier (persisted in view settings). */
  speedExp: number;
  onSpeedExpChange: (value: number) => void;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  /** The scene writes the formatted simulation clock into this element. */
  timeRef: RefObject<HTMLDivElement | null>;
}

function closestSpeedIndex(speedExp: number): number {
  const speed = Math.pow(10, speedExp);
  let best = 0;
  SPEED_OPTIONS.forEach((s, i) => {
    if (Math.abs(s - speed) < Math.abs(SPEED_OPTIONS[best] - speed)) best = i;
  });
  return best;
}

/**
 * Floating playback HUD at the bottom of the 3D view: play/pause, speed
 * stepper and the simulation clock (UTC / JST).
 */
export default function PlaybackBar({
  speedExp,
  onSpeedExpChange,
  paused,
  onPausedChange,
  timeRef,
}: Props) {
  const idx = closestSpeedIndex(speedExp);
  const setIdx = (i: number) =>
    onSpeedExpChange(Math.log10(SPEED_OPTIONS[Math.max(0, Math.min(SPEED_OPTIONS.length - 1, i))]));

  // Space toggles pause unless the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      e.preventDefault();
      onPausedChange(!paused);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, onPausedChange]);

  const iconBtn =
    "inline-flex size-8 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg disabled:opacity-35 disabled:pointer-events-none";

  return (
    <div className="playback-bar glass" role="group" aria-label="再生コントロール">
      <button
        type="button"
        data-slot="icon-button"
        onClick={() => onPausedChange(!paused)}
        aria-label={paused ? "再生" : "一時停止"}
        title={paused ? "再生 (Space)" : "一時停止 (Space)"}
        className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-hover"
      >
        {paused ? <Play className="size-4 translate-x-px fill-current" /> : <Pause className="size-4 fill-current" />}
      </button>
      <div className="flex items-center">
        <button
          type="button"
          data-slot="icon-button"
          className={iconBtn}
          onClick={() => setIdx(idx - 1)}
          disabled={idx === 0}
          aria-label="遅くする"
          title="遅くする"
        >
          <ChevronsLeft className="size-4" />
        </button>
        <select
          data-slot="select"
          value={SPEED_OPTIONS[idx]}
          onChange={(e) => onSpeedExpChange(Math.log10(Number(e.target.value)))}
          aria-label="再生速度"
          className="playback-speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button
          type="button"
          data-slot="icon-button"
          className={iconBtn}
          onClick={() => setIdx(idx + 1)}
          disabled={idx === SPEED_OPTIONS.length - 1}
          aria-label="速くする"
          title="速くする"
        >
          <ChevronsRight className="size-4" />
        </button>
      </div>
      <div className="playback-divider" aria-hidden="true" />
      <div ref={timeRef} className="playback-time" aria-label="シミュレーション時刻" />
    </div>
  );
}
