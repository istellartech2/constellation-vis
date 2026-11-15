import { useEffect, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type SatelliteScene from "../../lib/visualization";
import { chapterProgress, formatTourClock } from "../../lib/tour/parse";
import { formatAltitudeKm, formatSpeedKmh, tourTelemetryAt } from "../../lib/tour/telemetry";
import type { GuidedTourState } from "./useGuidedTour";

interface Props {
  state: GuidedTourState;
  sceneRef: RefObject<SatelliteScene | null>;
  paused: boolean;
  /** Current tour playback speed (× real time). */
  speed: number | null;
  onTogglePause: () => void;
  onGoTo: (index: number) => void;
  onStop: () => void;
}

/** Sim time for the HUD, polled from the scene (~8 Hz; App's simTime is 1 Hz). */
function useSceneSimMs(sceneRef: RefObject<SatelliteScene | null>, active: boolean): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 120) return;
      last = now;
      const scene = sceneRef.current;
      if (scene) setMs(scene.getSimulationTime().getTime());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sceneRef, active]);
  return ms;
}

const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35";

/**
 * Presentation-mode overlay of a guided tour: title and disclaimer, a
 * webcast-style telemetry HUD, the chapter caption, and chapter navigation.
 * Works from phone width up; the side panel and the normal HUD are hidden
 * by App while it is shown.
 */
export default function TourPlayer({ state, sceneRef, paused, speed, onTogglePause, onGoTo, onStop }: Props) {
  const { tour, status, chapterIndex, finished, tracks } = state;
  const running = status === "running" && tour !== null;
  const simMs = useSceneSimMs(sceneRef, running);
  const [captionOpen, setCaptionOpen] = useState(true);

  // Keyboard: Space play/pause, ←/→ chapters, Esc ends the tour.
  useEffect(() => {
    if (status === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="dialog"]')) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
        return;
      }
      if (!running) return;
      if (e.code === "Space") {
        if (t?.tagName === "BUTTON") return;
        e.preventDefault();
        onTogglePause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onGoTo(chapterIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onGoTo(chapterIndex - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, running, chapterIndex, onStop, onTogglePause, onGoTo]);

  if (status === "idle") return null;

  if (status === "loading" || status === "error") {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4 pointer-events-none">
        <div className="glass pointer-events-auto w-full max-w-sm rounded-xl p-4 text-fg" role={status === "error" ? "alert" : "status"}>
          {status === "loading" ? (
            <p className="text-sm">ツアーを読み込んでいます…</p>
          ) : (
            <>
              <p className="text-sm font-semibold">ツアーを開始できませんでした</p>
              <p className="mt-1 text-xs text-fg-muted break-words">{state.error}</p>
            </>
          )}
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={onStop} className="rounded-md bg-raised px-3 py-1.5 text-xs text-fg hover:bg-raised-hover">
              {status === "error" ? "閉じる" : "キャンセル"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!tour) return null;
  const chapter = tour.chapters[chapterIndex];
  const nowMs = simMs ?? chapter.startMs;
  const progress = chapterProgress(chapter, nowMs);
  const telemetry = chapter.telemetry
    .map((key) => {
      const track = tracks[key];
      const ref = tour.tracks.find((t) => t.key === key);
      const value = track ? tourTelemetryAt(track, nowMs) : null;
      return { key, label: ref?.label ?? key.toUpperCase(), color: track?.color, value };
    })
    .filter((t) => t.value !== null);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col justify-between gap-2 p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-[calc(12px+env(safe-area-inset-top,0px))] text-fg">
      {/* Title, disclaimer, 終了 */}
      <div className="flex items-start gap-2">
        <div className="glass pointer-events-auto min-w-0 flex-1 rounded-xl px-3 py-2 sm:flex-none sm:max-w-md">
          <p className="truncate text-sm font-semibold leading-tight">{tour.title}</p>
          {tour.subtitle && <p className="truncate text-[11px] text-fg-muted">{tour.subtitle}</p>}
          {tour.disclaimer && (
            <p className="mt-1 inline-flex items-center rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-fg" role="note">
              {tour.disclaimer}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onStop}
          className="glass pointer-events-auto ml-auto inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-fg hover:bg-raised-hover"
          title="ツアーを終了して元の表示に戻ります (Esc)"
        >
          <X className="size-4" />
          終了
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {/* Webcast-style telemetry */}
        <div className="flex items-stretch justify-center gap-1.5 font-mono tabular-nums text-white sm:gap-2" aria-label="テレメトリー（推定値）">
          {telemetry.map((t, i) => (
            <TelemetryBlock key={t.key} label={t.label} color={t.color} value={t.value!} order={i === 0 ? "first" : "rest"} />
          ))}
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-md bg-black/60 px-2.5 py-1 sm:px-3",
              telemetry.length > 0 ? "order-1" : "",
            )}
          >
            <span className="text-[10px] tracking-widest text-white/70">推定値</span>
            <span className="text-sm font-semibold sm:text-base">{formatTourClock(nowMs - tour.epochMs)}</span>
          </div>
        </div>

        {/* Caption card */}
        <div className="glass pointer-events-auto rounded-xl px-3 py-2.5 sm:px-4 sm:py-3" aria-live="polite">
          {finished ? (
            <EndCard title={tour.ending?.title ?? "ツアー終了"} caption={tour.ending?.caption ?? ""} sources={tour.sources} />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-medium text-brand-text tabular-nums">
                  {chapterIndex + 1} / {tour.chapters.length}
                </span>
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{chapter.title}</h2>
                <button
                  type="button"
                  onClick={() => setCaptionOpen((v) => !v)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-raised-hover hover:text-fg"
                  aria-label={captionOpen ? "説明を隠す" : "説明を表示"}
                  aria-expanded={captionOpen}
                >
                  {captionOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                </button>
              </div>
              {captionOpen && <p className="mt-1 text-[13px] leading-relaxed sm:text-sm">{chapter.caption}</p>}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                <div className="h-full bg-brand" style={{ width: `${progress * 100}%` }} />
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-full px-1.5 py-1" role="group" aria-label="ツアーの操作">
          <button
            type="button"
            className={iconButton}
            onClick={() => onGoTo(chapterIndex - 1)}
            disabled={chapterIndex === 0 && !finished}
            aria-label="前の章"
            title="前の章 (←)"
          >
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-hover"
            aria-label={finished ? "最初から" : paused ? "再生" : "一時停止"}
            title={finished ? "最初から" : paused ? "再生 (Space)" : "一時停止 (Space)"}
          >
            {finished ? (
              <RotateCcw className="size-4" />
            ) : paused ? (
              <Play className="size-4 translate-x-px fill-current" />
            ) : (
              <Pause className="size-4 fill-current" />
            )}
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={() => onGoTo(chapterIndex + 1)}
            disabled={chapterIndex >= tour.chapters.length - 1}
            aria-label="次の章"
            title="次の章 (→)"
          >
            <SkipForward className="size-4" />
          </button>
          <ol className="mx-1 flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto" aria-label="章">
            {tour.chapters.map((c, i) => (
              <li key={c.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onGoTo(i)}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-raised-hover"
                  aria-label={`${i + 1}. ${c.title}`}
                  aria-current={i === chapterIndex && !finished ? "step" : undefined}
                  title={`${i + 1}. ${c.title}`}
                >
                  <span
                    className={cn(
                      "block rounded-full transition-all",
                      i === chapterIndex && !finished
                        ? "size-2.5 bg-brand"
                        : i < chapterIndex || finished
                          ? "size-1.5 bg-fg-muted"
                          : "size-1.5 bg-line-strong",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
          <span className="shrink-0 pr-2 text-xs font-medium tabular-nums text-fg-muted" title="再生速度（実時間の何倍か）">
            {paused || finished ? "停止中" : speed !== null ? `${speed.toLocaleString("ja-JP")}×` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function TelemetryBlock({
  label,
  color,
  value,
  order,
}: {
  label: string;
  color: string | undefined;
  value: NonNullable<ReturnType<typeof tourTelemetryAt>>;
  order: "first" | "rest";
}) {
  return (
    <div className={cn("min-w-0 rounded-md bg-black/60 px-2 py-1 sm:px-3", order === "first" ? "order-0" : "order-2")}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-white/80">
        {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
        {label}
      </div>
      {value.phase === "after" ? (
        <div className="text-xs text-white/70 sm:text-sm">飛行終了</div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs sm:text-sm">
          <span>
            <span className="text-[10px] text-white/60">速度 </span>
            {formatSpeedKmh(value.speedKmh)}
            <span className="text-[10px] text-white/60"> km/h</span>
          </span>
          <span>
            <span className="text-[10px] text-white/60">高度 </span>
            {formatAltitudeKm(value.altKm)}
            <span className="text-[10px] text-white/60"> km</span>
          </span>
        </div>
      )}
    </div>
  );
}

function EndCard({ title, caption, sources }: { title: string; caption: string; sources?: { label: string; url: string }[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
      {caption && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed sm:text-sm">{caption}</p>}
      {sources && sources.length > 0 && (
        <p className="mt-2 text-[11px] text-fg-muted">
          出典:{" "}
          {sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">
                {s.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
