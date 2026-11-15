import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type SatelliteScene from "../../lib/visualization";
import { chapterProgress, formatTourClock } from "../../lib/tour/parse";
import {
  ascendingNodeTimes,
  formatAltitudeKm,
  formatSpeedKmh,
  orbitNumberAt,
  tourTelemetryAt,
} from "../../lib/tour/telemetry";
import type { GuidedTourState } from "./useGuidedTour";

interface Props {
  state: GuidedTourState;
  sceneRef: RefObject<SatelliteScene | null>;
  paused: boolean;
  /** Current tour playback speed (× real time). */
  speed: number | null;
  onTogglePause: () => void;
  /** Leave the start screen and start the clock. */
  onBegin: () => void;
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

/** Whether the globe has finished its first textures (polled while `active`). */
function useEarthReady(sceneRef: RefObject<SatelliteScene | null>, active: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (sceneRef.current?.isEarthReady()) {
        setReady(true);
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [sceneRef, active]);
  return ready;
}

/**
 * Report the screen areas the overlay covers (title on top, HUD + caption +
 * controls at the bottom) on <html>, so the scene centres its view in the
 * area between them (see SatelliteScene.updateViewInset).
 */
function useViewInsets(top: RefObject<HTMLElement | null>, bottom: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const update = () => {
      const h = window.innerHeight;
      const t = top.current?.getBoundingClientRect();
      const b = bottom.current?.getBoundingClientRect();
      root.dataset.tourInsetTop = String(Math.round(t ? Math.max(0, t.bottom) : 0));
      root.dataset.tourInsetBottom = String(Math.round(b ? Math.max(0, h - b.top) : 0));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (top.current) observer?.observe(top.current);
    if (bottom.current) observer?.observe(bottom.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      delete root.dataset.tourInsetTop;
      delete root.dataset.tourInsetBottom;
    };
  }, [top, bottom, active]);
}

const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors motion-reduce:transition-none hover:bg-raised-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35";

/**
 * Presentation-mode overlay of a guided tour: a start screen, then the title
 * and disclaimer, a webcast-style telemetry HUD, the chapter caption, and
 * chapter navigation. Works from phone width up; the side panel and the
 * normal HUD are hidden by App while it is shown.
 */
export default function TourPlayer({ state, sceneRef, paused, speed, onTogglePause, onBegin, onGoTo, onStop }: Props) {
  const { tour, status, chapterIndex, finished, tracks, awaitingStart } = state;
  const running = status === "running" && tour !== null;
  const simMs = useSceneSimMs(sceneRef, running && !awaitingStart);
  const earthReady = useEarthReady(sceneRef, running && awaitingStart);
  const [captionOpen, setCaptionOpen] = useState(true);
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useViewInsets(topRef, bottomRef, running && !awaitingStart);

  // Keyboard: Space play/pause (or start), ←/→ chapters, Esc ends the tour.
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
      if (awaitingStart) {
        if ((e.code === "Space" || e.key === "Enter") && t?.tagName !== "BUTTON" && earthReady) {
          e.preventDefault();
          onBegin();
        }
        return;
      }
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
  }, [status, running, awaitingStart, earthReady, chapterIndex, onStop, onTogglePause, onBegin, onGoTo]);

  // Ascending nodes of the orbit-counter track (computed once per chapter).
  const chapter = tour?.chapters[chapterIndex];
  const counter = chapter?.orbitCounter ?? null;
  const counterTrack = counter ? tracks[counter.track] : undefined;
  const nodeTimes = useMemo(
    () => (counter && counterTrack ? ascendingNodeTimes(counterTrack, counter.fromMs) : []),
    [counter, counterTrack],
  );

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

  if (!tour || !chapter) return null;

  if (awaitingStart) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4 text-fg">
        <section className="glass w-full max-w-md rounded-2xl p-5 text-center sm:p-6" aria-labelledby="tour-start-title">
          <h1 id="tour-start-title" className="text-lg font-semibold leading-snug sm:text-xl">
            {tour.title}
          </h1>
          {tour.subtitle && <p className="mt-1 text-[13px] leading-snug text-fg-muted">{tour.subtitle}</p>}
          {tour.disclaimer && (
            <p className="mt-3 inline-flex items-center rounded bg-warning-soft px-2 py-1 text-xs font-medium text-fg" role="note">
              {tour.disclaimer}
            </p>
          )}
          <button
            type="button"
            onClick={onBegin}
            disabled={!earthReady}
            className="mx-auto mt-5 flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-base font-semibold text-brand-fg transition-colors motion-reduce:transition-none hover:bg-brand-hover disabled:opacity-50"
            autoFocus
          >
            <Play className="size-5 translate-x-px fill-current" />
            再生
          </button>
          <p className="mt-2 text-xs text-fg-muted" aria-live="polite">
            {earthReady ? "タップして開始" : "地球を読み込んでいます…"}
          </p>
          <button type="button" onClick={onStop} className="mt-3 text-xs text-fg-muted underline hover:text-fg">
            デモを閉じる
          </button>
        </section>
      </div>
    );
  }

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
  const orbit = counter ? orbitNumberAt(nodeTimes, counter.fromMs, nowMs, counter.total) : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col justify-between gap-2 p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-[calc(12px+env(safe-area-inset-top,0px))] text-fg">
      {/* Title, disclaimer, 終了 */}
      <div ref={topRef} className="flex items-start gap-2">
        <div className="glass pointer-events-auto min-w-0 flex-1 rounded-xl px-3 py-2 sm:flex-none sm:max-w-md">
          <p className="text-sm font-semibold leading-tight sm:truncate">{tour.title}</p>
          {tour.subtitle && <p className="text-[11px] leading-snug text-fg-muted sm:truncate">{tour.subtitle}</p>}
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

      <div ref={bottomRef} className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {/* Webcast-style telemetry */}
        <div className="flex flex-col items-center gap-1">
          <div
            className="flex items-stretch justify-center gap-1.5 font-mono tabular-nums text-white sm:gap-2"
            aria-label={tour.telemetryNote ? `テレメトリー（${tour.telemetryNote}）` : "テレメトリー"}
          >
            {telemetry.map((t, i) => (
              <TelemetryBlock key={t.key} label={t.label} color={t.color} value={t.value!} order={i === 0 ? "first" : "rest"} />
            ))}
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-md bg-black/60 px-2.5 py-1 sm:px-3",
                telemetry.length > 0 ? "order-1" : "",
              )}
            >
              <span className="text-[11px] text-white/75">{tour.clockLabel ?? "基準時刻から"}</span>
              <span className="text-sm font-semibold sm:text-base">{formatTourClock(nowMs - tour.epochMs)}</span>
              {orbit !== null && (
                <span className="text-[11px] text-white/75">
                  周回 {orbit}
                  {counter?.total !== undefined ? `/${counter.total}` : ""}
                </span>
              )}
            </div>
          </div>
          {tour.telemetryNote && telemetry.length > 0 && (
            <p className="rounded bg-black/50 px-1.5 text-[11px] leading-4 text-white/75">{tour.telemetryNote}</p>
          )}
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
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors motion-reduce:transition-none hover:bg-brand-hover"
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
          {/* Auto margins centre the dots when they fit and keep the first one reachable when they scroll. */}
          <ol className="mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none]" aria-label="章">
            {tour.chapters.map((c, i) => (
              <li key={c.id} className={cn("shrink-0", i === 0 && "ml-auto", i === tour.chapters.length - 1 && "mr-auto")}>
                <button
                  type="button"
                  onClick={() => onGoTo(i)}
                  className="flex size-7 items-center justify-center rounded-full hover:bg-raised-hover sm:size-6"
                  aria-label={`${i + 1}. ${c.title}`}
                  aria-current={i === chapterIndex && !finished ? "step" : undefined}
                  title={`${i + 1}. ${c.title}`}
                >
                  <span
                    className={cn(
                      "block rounded-full transition-all motion-reduce:transition-none",
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
      <div className="flex items-center gap-1.5 font-sans text-[11px] font-semibold text-white/90">
        {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
        {label}
      </div>
      {value.phase === "after" ? (
        <div className="text-xs text-white/75 sm:text-sm">飛行終了</div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs sm:text-sm">
          <span>
            <span className="font-sans text-[11px] text-white/75">速度 </span>
            {formatSpeedKmh(value.speedKmh)}
            <span className="text-[11px] text-white/75"> km/h</span>
          </span>
          <span>
            <span className="font-sans text-[11px] text-white/75">高度 </span>
            {formatAltitudeKm(value.altKm)}
            <span className="text-[11px] text-white/75"> km</span>
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
