import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, ChevronUp, Link2, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type SatelliteScene from "../../lib/visualization";
import { formatTourClock } from "../../lib/tour/parse";
import type { ResolvedChapter } from "../../lib/tour/types";
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
  /** Seek inside the current chapter (the chapter scrubber). */
  onSeek: (ms: number) => void;
  /** Scrub drag started / ended (pauses, then restores the pause state). */
  onScrub: (active: boolean) => void;
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
 * Report the screen areas the overlay covers on <html>, so the scene centres
 * its view in the area between them (see SatelliteScene.updateViewInset):
 * the title row on top, and at the bottom the control bar plus the caption
 * card's one-line header. The caption's expanded text is left out, so
 * opening / closing it does not move the camera; the telemetry HUD sits in a
 * corner and is left out too.
 */
function useViewInsets(
  top: RefObject<HTMLElement | null>,
  controls: RefObject<HTMLElement | null>,
  captionHeader: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const update = () => {
      const h = window.innerHeight;
      const t = top.current?.getBoundingClientRect();
      const c = controls.current?.getBoundingClientRect();
      const header = captionHeader.current?.getBoundingClientRect();
      // Collapsed caption card: header + its padding (16) + the gap above the bar (8).
      const caption = header ? header.height + 24 : 0;
      root.dataset.tourInsetTop = String(Math.round(t ? Math.max(0, t.bottom) : 0));
      root.dataset.tourInsetBottom = String(Math.round(c ? Math.max(0, h - c.top) + caption : 0));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    for (const el of [top.current, controls.current, captionHeader.current]) if (el) observer?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      delete root.dataset.tourInsetTop;
      delete root.dataset.tourInsetBottom;
    };
  }, [top, controls, captionHeader, active]);
}

const CAPTION_STORAGE_KEY = "cv-tour-caption";

/**
 * Caption card open / collapsed to its one-line title. Remembered across
 * tours (localStorage); without a stored choice it starts collapsed on
 * phones (narrower than Tailwind's `sm`) and open elsewhere.
 */
function useCaptionOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(CAPTION_STORAGE_KEY);
      if (stored === "open") return true;
      if (stored === "collapsed") return false;
    } catch {
      /* storage unavailable */
    }
    return typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 639px)").matches;
  });
  const toggle = useCallback(() => {
    setOpen((v) => {
      try {
        localStorage.setItem(CAPTION_STORAGE_KEY, v ? "collapsed" : "open");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  }, []);
  return [open, toggle];
}

const iconButton =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors motion-reduce:transition-none hover:bg-raised-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35";

/**
 * 「リンクをコピー」: copies the page URL, which carries `?demo=<id>` while a
 * tour runs (App sets it on start), so the demo can be shared. Sits left of
 * 終了 (ml-auto pushes both to the right).
 */
function CopyLinkButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(t);
  }, [state]);
  const copy = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // Clipboard API unavailable (insecure context / denied): fall back to a prompt the user can copy from.
      window.prompt("このデモのリンク", url);
      setState("failed");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="glass pointer-events-auto ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-fg hover:bg-raised-hover"
      title="このデモを直接開くリンクをコピーします"
      aria-live="polite"
    >
      {state === "copied" ? <Check className="size-4" /> : <Link2 className="size-4" />}
      <span className="max-sm:sr-only">{state === "copied" ? "コピーしました" : "リンクをコピー"}</span>
    </button>
  );
}

/**
 * Presentation-mode overlay of a guided tour: a start screen, then a layout
 * that keeps the middle of the screen clear — title and disclaimer
 * top-left, 終了 and a compact telemetry HUD top-right, and at the bottom a
 * caption card (collapsible to one line) above a slim control bar with an
 * in-chapter scrubber and the chapter dots. Works from phone width up; the
 * side panel and the normal HUD are hidden by App while it is shown.
 */
export default function TourPlayer({
  state,
  sceneRef,
  paused,
  speed,
  onTogglePause,
  onBegin,
  onGoTo,
  onStop,
  onSeek,
  onScrub,
}: Props) {
  const { tour, status, chapterIndex, finished, tracks, awaitingStart } = state;
  const running = status === "running" && tour !== null;
  const simMs = useSceneSimMs(sceneRef, running && !awaitingStart);
  const earthReady = useEarthReady(sceneRef, running && awaitingStart);
  const [captionOpen, toggleCaption] = useCaptionOpen();
  const topRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const captionHeaderRef = useRef<HTMLDivElement | null>(null);
  useViewInsets(topRef, controlsRef, captionHeaderRef, running && !awaitingStart);

  // Keyboard: Space play/pause (or start), ←/→ chapters, Esc ends the tour.
  // On the chapter scrubber the arrow keys move the slider instead.
  useEffect(() => {
    if (status === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      // The target may be the document or window (no closest()).
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('[role="dialog"]')) return;
      const onRange = t instanceof HTMLInputElement && t.type === "range";
      if (t && !onRange && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
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
      } else if (onRange) {
        return;
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
  const telemetry = chapter.telemetry
    .map((key) => {
      const track = tracks[key];
      const ref = tour.tracks.find((t) => t.key === key);
      const value = track ? tourTelemetryAt(track, nowMs) : null;
      return { key, label: ref?.label ?? key.toUpperCase(), color: track?.color, value };
    })
    .filter((t) => t.value !== null);
  const orbit = counter ? orbitNumberAt(nodeTimes, counter.fromMs, nowMs, counter.total) : null;
  // One notice line: the disclaimer plus the telemetry note (e.g. 「速度・高度は推定」).
  const notice = [tour.disclaimer, telemetry.length > 0 ? tour.telemetryNote : undefined].filter(Boolean).join(" · ");
  const showCaption = captionOpen || finished;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col gap-1.5 p-2 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-[calc(8px+env(safe-area-inset-top,0px))] text-fg sm:gap-2 sm:p-3 sm:pb-[calc(16px+env(safe-area-inset-bottom,0px))] sm:pt-[calc(12px+env(safe-area-inset-top,0px))]">
      {/* Title + notice (top-left), 終了 (top-right) */}
      <div ref={topRef} className="flex items-start gap-2">
        <div className="glass pointer-events-auto min-w-0 rounded-lg px-2.5 py-1.5" title={tour.subtitle}>
          <p className="truncate text-[13px] font-semibold leading-tight sm:text-sm">{tour.title}</p>
          {notice && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-fg-muted sm:truncate" role="note">
              <span className="mr-1 inline-block size-1.5 -translate-y-px rounded-full bg-warning align-middle" aria-hidden="true" />
              {notice}
            </p>
          )}
        </div>
        <CopyLinkButton />
        <button
          type="button"
          onClick={onStop}
          className="glass pointer-events-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-fg hover:bg-raised-hover"
          title="ツアーを終了して元の表示に戻ります (Esc)"
        >
          <X className="size-4" />
          終了
        </button>
      </div>

      {/* Compact telemetry HUD (top-right corner) */}
      <TelemetryHud
        clockLabel={tour.clockLabel ?? "基準時刻から"}
        clock={formatTourClock(nowMs - tour.epochMs)}
        orbit={orbit !== null ? `周回 ${orbit}${counter?.total !== undefined ? `/${counter.total}` : ""}` : null}
        rows={telemetry.map((t) => ({ key: t.key, label: t.label, color: t.color, value: t.value! }))}
        note={tour.telemetryNote}
      />

      <div className="flex-1" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {/* Caption card: one-line title, expandable */}
        <div className="glass pointer-events-auto mx-auto w-full max-w-xl rounded-xl px-3 py-2" aria-live="polite">
          {finished ? (
            <EndCard title={tour.ending?.title ?? "ツアー終了"} caption={tour.ending?.caption ?? ""} sources={tour.sources} />
          ) : (
            <>
              <div ref={captionHeaderRef}>
                <button
                  type="button"
                  onClick={toggleCaption}
                  className="flex w-full items-center gap-2 text-left"
                  aria-expanded={showCaption}
                  aria-controls="tour-caption-text"
                  title={showCaption ? "説明を隠す" : "説明を表示"}
                >
                  <span className="shrink-0 text-[11px] font-medium text-brand-text tabular-nums">
                    {chapterIndex + 1}/{tour.chapters.length}
                  </span>
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold sm:text-sm">{chapter.title}</h2>
                  <span className="shrink-0 text-fg-muted" aria-hidden="true">
                    {showCaption ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                  </span>
                  <span className="sr-only">{showCaption ? "説明を隠す" : "説明を表示"}</span>
                </button>
              </div>
              {showCaption && (
                <p id="tour-caption-text" className="mt-1 text-[13px] leading-relaxed">
                  {chapter.caption}
                </p>
              )}
            </>
          )}
        </div>

        {/* Slim control bar */}
        <div
          ref={controlsRef}
          className="glass pointer-events-auto flex flex-wrap items-center gap-x-1 rounded-2xl px-1.5 py-1 sm:flex-nowrap sm:rounded-full"
          role="group"
          aria-label="ツアーの操作"
        >
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
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors motion-reduce:transition-none hover:bg-brand-hover"
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
          {finished ? (
            <div className="min-w-0 flex-1" />
          ) : (
            <ChapterScrubber
              key={chapter.id}
              chapter={chapter}
              nowMs={nowMs}
              epochMs={tour.epochMs}
              onSeek={onSeek}
              onScrub={onScrub}
            />
          )}
          <span className="w-12 shrink-0 pr-1 text-right text-[11px] font-medium tabular-nums text-fg-muted" title="再生速度（実時間の何倍か）">
            {paused || finished ? "停止中" : speed !== null ? `${speed.toLocaleString("ja-JP")}×` : ""}
          </span>
          {/* Chapter dots: a second row on phones. Auto margins centre them when they fit and keep the first reachable when they scroll. */}
          <ol
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] max-sm:order-last max-sm:w-full sm:max-w-[40%] sm:shrink"
            aria-label="章"
          >
            {tour.chapters.map((c, i) => (
              <li key={c.id} className={cn("shrink-0", i === 0 && "ml-auto", i === tour.chapters.length - 1 && "mr-auto")}>
                <button
                  type="button"
                  onClick={() => onGoTo(i)}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-raised-hover sm:size-5"
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
        </div>
      </div>
    </div>
  );
}

/**
 * Seek bar limited to the current chapter, labelled with the T± time.
 * Dragging pauses playback and auto-advance (onScrub) and seeks at most once
 * per animation frame; releasing restores the pause state. Arrow / Page /
 * Home / End keys move it without pausing.
 */
function ChapterScrubber({
  chapter,
  nowMs,
  epochMs,
  onSeek,
  onScrub,
}: {
  chapter: ResolvedChapter;
  nowMs: number;
  epochMs: number;
  onSeek: (ms: number) => void;
  onScrub: (active: boolean) => void;
}) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  // Keyboard seek shown until the polled sim time moves (it lags by a frame or more).
  const [keyed, setKeyed] = useState<{ ms: number; from: number } | null>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const maxMs = chapter.endMs - 1;
  const span = Math.max(1, maxMs - chapter.startMs);
  const step = Math.max(100, Math.round(span / 500));
  const shownMs = dragMs ?? (keyed && keyed.from === nowMs ? keyed.ms : nowMs);
  const value = Math.min(Math.max(shownMs, chapter.startMs), maxMs);

  const flush = useCallback(() => {
    rafRef.current = 0;
    const ms = pendingRef.current;
    pendingRef.current = null;
    if (ms !== null) onSeek(ms);
  }, [onSeek]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    flush();
    setDragMs(null);
    onScrub(false);
  }, [flush, onScrub]);

  // Release anywhere (the pointer may leave the slider while dragging).
  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
  }, [endDrag]);
  // Leaving the chapter (or the tour) mid-drag ends the scrub.
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (draggingRef.current) {
        draggingRef.current = false;
        onScrub(false);
      }
    },
    [onScrub],
  );

  const clock = formatTourClock(value - epochMs);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
      <input
        type="range"
        min={chapter.startMs}
        max={maxMs}
        step={step}
        value={value}
        aria-label={`「${chapter.title}」の再生位置`}
        aria-valuetext={clock}
        onPointerDown={() => {
          if (draggingRef.current) return;
          draggingRef.current = true;
          onScrub(true);
        }}
        onLostPointerCapture={endDrag}
        onChange={(e) => {
          const ms = Number(e.target.value);
          if (!draggingRef.current) {
            setKeyed({ ms, from: nowMs });
            onSeek(ms);
            return;
          }
          setDragMs(ms);
          pendingRef.current = ms;
          if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
        }}
        className="h-6 min-w-0 flex-1 cursor-pointer touch-none accent-brand"
      />
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">{clock}</span>
    </div>
  );
}

interface HudRow {
  key: string;
  label: string;
  color: string | undefined;
  value: NonNullable<ReturnType<typeof tourTelemetryAt>>;
}

/** Webcast-style readout in the top-right corner: T± clock, then one line per vehicle. */
function TelemetryHud({
  clockLabel,
  clock,
  orbit,
  rows,
  note,
}: {
  clockLabel: string;
  clock: string;
  orbit: string | null;
  rows: HudRow[];
  note?: string;
}) {
  return (
    <div
      className="ml-auto w-max min-w-40 rounded-lg bg-black/55 px-2.5 py-1.5 font-mono tabular-nums text-white"
      aria-label={note && rows.length > 0 ? `テレメトリー（${note}）` : "テレメトリー"}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-[10px] text-white/70">{clockLabel}</span>
        {orbit && <span className="font-sans text-[10px] text-white/70">{orbit}</span>}
      </div>
      <div className="text-sm font-semibold leading-5">{clock}</div>
      {rows.map((r) => (
        <div key={r.key} className="mt-0.5 flex items-baseline gap-1.5 text-[11px] leading-4 sm:text-xs">
          {r.color && <span className="size-1.5 shrink-0 -translate-y-px self-center rounded-full" style={{ background: r.color }} aria-hidden="true" />}
          <span className="shrink-0 font-sans font-semibold text-white/90">{r.label}</span>
          {r.value.phase === "after" ? (
            <span className="ml-auto text-white/70">飛行終了</span>
          ) : (
            <span className="ml-auto whitespace-nowrap">
              {formatSpeedKmh(r.value.speedKmh)}
              <span className="text-white/65"> km/h </span>
              {formatAltitudeKm(r.value.altKm)}
              <span className="text-white/65"> km</span>
            </span>
          )}
        </div>
      ))}
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
