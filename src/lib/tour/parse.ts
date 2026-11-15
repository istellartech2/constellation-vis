/**
 * Guided tour JSON: validation, time resolution and chapter bookkeeping.
 * Pure functions (no DOM, React or three.js) so they are unit-testable.
 * Error messages are Japanese because they are shown in the UI.
 */
import { parseUtcTimestamp } from "../trajectory/parse";
import type {
  DemoEntry,
  ResolvedChapter,
  ResolvedTour,
  TourCamera,
  TourChapterDef,
  TourDefinition,
  TourResult,
  TourSpeedChange,
  TourTime,
  TourTrackRef,
} from "./types";

/** Highest playback speed a tour may request (× real time). */
export const MAX_TOUR_SPEED = 100_000;

/** Overshoot past a chapter boundary beyond which the next chapter is re-seeked to its start. */
export const ADVANCE_SEEK_TOLERANCE_MS = 1000;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const REL_TIME_RE = /^T\s*([+\-−])\s*(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Resolve a tour time to absolute UTC ms. `T+hh:mm:ss`, `T-mm:ss` and plain
 * numbers are relative to `epochMs`; anything else is parsed as an ISO UTC
 * timestamp. Returns NaN when unreadable.
 */
export function resolveTourTime(value: TourTime, epochMs: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? epochMs + value * 1000 : Number.NaN;
  if (typeof value !== "string") return Number.NaN;
  const s = value.trim();
  const m = REL_TIME_RE.exec(s);
  if (m) {
    const [, sign, hh, mm, ss] = m;
    const minutes = Number(mm);
    const seconds = Number(ss);
    if (hh !== undefined && minutes >= 60) return Number.NaN;
    if (seconds >= 60) return Number.NaN;
    const total = Number(hh ?? 0) * 3600 + minutes * 60 + seconds;
    return epochMs + (sign === "+" ? 1 : -1) * total * 1000;
  }
  return parseUtcTimestamp(s);
}

function validateCamera(raw: unknown, where: string, trackKeys: Set<string>): TourResult<TourCamera> {
  if (!isRecord(raw)) return { ok: false, error: `${where}: camera がありません` };
  const type = raw.type;
  const track = raw.track;
  if (track !== undefined && (!isNonEmptyString(track) || !trackKeys.has(track))) {
    return { ok: false, error: `${where}: camera.track「${String(track)}」は tracks にありません` };
  }
  if (type === "follow" || type === "overview") {
    if (track === undefined) return { ok: false, error: `${where}: camera.type「${type}」には track が必要です` };
    return { ok: true, value: { type, track: track as string } };
  }
  if (type === "globe") {
    const distance = raw.distance;
    if (distance !== undefined && (typeof distance !== "number" || !(distance >= 1.05 && distance <= 30))) {
      return { ok: false, error: `${where}: camera.distance は 1.05〜30（地球半径）で指定してください` };
    }
    const chase = raw.chase;
    if (chase !== undefined && typeof chase !== "boolean") return { ok: false, error: `${where}: camera.chase は true / false です` };
    return {
      ok: true,
      value: {
        type,
        ...(track !== undefined ? { track: track as string } : {}),
        ...(distance !== undefined ? { distance } : {}),
        ...(chase !== undefined ? { chase } : {}),
      },
    };
  }
  return { ok: false, error: `${where}: camera.type は follow / overview / globe のいずれかです` };
}

const validSpeed = (v: unknown): v is number => typeof v === "number" && v > 0 && v <= MAX_TOUR_SPEED;
const validTime = (v: unknown): v is TourTime => (typeof v === "number" && Number.isFinite(v)) || isNonEmptyString(v);

/**
 * Validate a parsed tour JSON value (structure and references only; times
 * are resolved by {@link resolveTour}).
 */
export function parseTourDefinition(raw: unknown): TourResult<TourDefinition> {
  if (!isRecord(raw)) return { ok: false, error: "ツアー定義が JSON オブジェクトではありません" };
  if (!isNonEmptyString(raw.id) || !ID_RE.test(raw.id)) return { ok: false, error: "id（英数字・-・_）が必要です" };
  if (!isNonEmptyString(raw.title)) return { ok: false, error: "title が必要です" };
  for (const key of ["subtitle", "disclaimer", "epoch"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") return { ok: false, error: `${key} は文字列です` };
  }

  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) return { ok: false, error: "tracks が空です" };
  const tracks: TourTrackRef[] = [];
  const trackKeys = new Set<string>();
  for (const [i, t] of raw.tracks.entries()) {
    const where = `tracks[${i}]`;
    if (!isRecord(t) || !isNonEmptyString(t.key) || !ID_RE.test(t.key)) return { ok: false, error: `${where}: key（英数字・-・_）が必要です` };
    if (trackKeys.has(t.key)) return { ok: false, error: `${where}: key「${t.key}」が重複しています` };
    if (!isNonEmptyString(t.url)) return { ok: false, error: `${where}: url が必要です` };
    for (const opt of ["label", "model", "color"] as const) {
      if (t[opt] !== undefined && !isNonEmptyString(t[opt])) return { ok: false, error: `${where}: ${opt} は文字列です` };
    }
    trackKeys.add(t.key);
    tracks.push({
      key: t.key,
      url: t.url,
      ...(t.label !== undefined ? { label: t.label as string } : {}),
      ...(t.model !== undefined ? { model: t.model as string } : {}),
      ...(t.color !== undefined ? { color: t.color as string } : {}),
    });
  }

  if (!Array.isArray(raw.chapters) || raw.chapters.length === 0) return { ok: false, error: "chapters が空です" };
  const chapters: TourChapterDef[] = [];
  const chapterIds = new Set<string>();
  for (const [i, c] of raw.chapters.entries()) {
    const where = `chapters[${i}]`;
    if (!isRecord(c)) return { ok: false, error: `${where}: オブジェクトではありません` };
    if (!isNonEmptyString(c.id) || !ID_RE.test(c.id)) return { ok: false, error: `${where}: id（英数字・-・_）が必要です` };
    if (chapterIds.has(c.id)) return { ok: false, error: `${where}: id「${c.id}」が重複しています` };
    chapterIds.add(c.id);
    if (!isNonEmptyString(c.title)) return { ok: false, error: `${where}: title が必要です` };
    if (typeof c.caption !== "string") return { ok: false, error: `${where}: caption が必要です` };
    if (!validTime(c.start) || !validTime(c.end)) return { ok: false, error: `${where}: start / end が必要です` };
    if (!validSpeed(c.speed)) return { ok: false, error: `${where}: speed は 0 より大きく ${MAX_TOUR_SPEED} 以下です` };
    const speedChanges: TourSpeedChange[] = [];
    if (c.speedChanges !== undefined) {
      if (!Array.isArray(c.speedChanges)) return { ok: false, error: `${where}: speedChanges は配列です` };
      for (const sc of c.speedChanges) {
        if (!isRecord(sc) || !validTime(sc.at) || !validSpeed(sc.speed)) {
          return { ok: false, error: `${where}: speedChanges の要素は { at, speed } です` };
        }
        speedChanges.push({ at: sc.at, speed: sc.speed });
      }
    }
    const camera = validateCamera(c.camera, where, trackKeys);
    if (!camera.ok) return camera;
    let telemetry: string[] | undefined;
    if (c.telemetry !== undefined) {
      if (!Array.isArray(c.telemetry)) return { ok: false, error: `${where}: telemetry は配列です` };
      for (const k of c.telemetry) {
        if (typeof k !== "string" || !trackKeys.has(k)) return { ok: false, error: `${where}: telemetry「${String(k)}」は tracks にありません` };
      }
      telemetry = c.telemetry as string[];
    }
    chapters.push({
      id: c.id,
      title: c.title,
      caption: c.caption,
      start: c.start,
      end: c.end,
      speed: c.speed,
      ...(speedChanges.length > 0 ? { speedChanges } : {}),
      camera: camera.value,
      ...(telemetry ? { telemetry } : {}),
    });
  }

  let ending: TourDefinition["ending"];
  if (raw.ending !== undefined) {
    if (!isRecord(raw.ending) || !isNonEmptyString(raw.ending.title) || typeof raw.ending.caption !== "string") {
      return { ok: false, error: "ending は { title, caption } です" };
    }
    ending = { title: raw.ending.title, caption: raw.ending.caption };
  }
  let sources: TourDefinition["sources"];
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources) || !raw.sources.every((s) => isRecord(s) && isNonEmptyString(s.label) && isNonEmptyString(s.url))) {
      return { ok: false, error: "sources は { label, url } の配列です" };
    }
    sources = (raw.sources as { label: string; url: string }[]).map((s) => ({ label: s.label, url: s.url }));
  }

  return {
    ok: true,
    value: {
      id: raw.id,
      title: raw.title,
      ...(raw.subtitle !== undefined ? { subtitle: raw.subtitle as string } : {}),
      ...(raw.disclaimer !== undefined ? { disclaimer: raw.disclaimer as string } : {}),
      ...(raw.epoch !== undefined ? { epoch: raw.epoch as string } : {}),
      tracks,
      chapters,
      ...(ending ? { ending } : {}),
      ...(sources ? { sources } : {}),
    },
  };
}

/**
 * Resolve every chapter time against the tour epoch: `def.epoch` when set,
 * else `fallbackEpochMs` (the first track's `# epoch:`). Chapters must have
 * start < end and must not overlap or go back in time (gaps are allowed).
 */
export function resolveTour(def: TourDefinition, fallbackEpochMs: number | undefined): TourResult<ResolvedTour> {
  const epochMs = def.epoch !== undefined ? parseUtcTimestamp(def.epoch) : fallbackEpochMs;
  if (epochMs === undefined || !Number.isFinite(epochMs)) {
    return { ok: false, error: "ツアーの基準時刻（epoch）が決まりません（最初のトラックに # epoch: が必要です）" };
  }
  const chapters: ResolvedChapter[] = [];
  let previousEnd = -Infinity;
  for (const [i, c] of def.chapters.entries()) {
    const where = `chapters[${i}]「${c.title}」`;
    const startMs = resolveTourTime(c.start, epochMs);
    const endMs = resolveTourTime(c.end, epochMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { ok: false, error: `${where}: start / end が読めません` };
    if (!(endMs > startMs)) return { ok: false, error: `${where}: end は start より後にしてください` };
    if (startMs < previousEnd) return { ok: false, error: `${where}: 前の章と時間が重なっています` };
    previousEnd = endMs;
    const speedChanges = [];
    for (const sc of c.speedChanges ?? []) {
      const atMs = resolveTourTime(sc.at, epochMs);
      if (!Number.isFinite(atMs) || atMs <= startMs || atMs >= endMs) {
        return { ok: false, error: `${where}: speedChanges の時刻は章の範囲内にしてください` };
      }
      speedChanges.push({ atMs, speed: sc.speed });
    }
    speedChanges.sort((a, b) => a.atMs - b.atMs);
    chapters.push({
      id: c.id,
      title: c.title,
      caption: c.caption,
      speed: c.speed,
      camera: c.camera,
      startMs,
      endMs,
      speedChanges,
      telemetry: c.telemetry ?? [],
    });
  }
  return { ok: true, value: { ...def, epochMs, chapters } };
}

/** Parse and resolve in one step. */
export function loadTourDefinition(raw: unknown, fallbackEpochMs: number | undefined): TourResult<ResolvedTour> {
  const def = parseTourDefinition(raw);
  if (!def.ok) return def;
  return resolveTour(def.value, fallbackEpochMs);
}

/**
 * Index of the chapter shown at `ms`: the last chapter starting at or before
 * it (0 before the first one). Inside a gap this is the previous chapter.
 */
export function chapterIndexAt(chapters: readonly ResolvedChapter[], ms: number): number {
  let index = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startMs <= ms) index = i;
    else break;
  }
  return index;
}

/** Playback speed of `chapter` at `ms` (its speed changes applied). */
export function chapterSpeedAt(chapter: ResolvedChapter, ms: number): number {
  let speed = chapter.speed;
  for (const sc of chapter.speedChanges) {
    if (sc.atMs <= ms) speed = sc.speed;
    else break;
  }
  return speed;
}

/** What the player should do at sim time `ms` while showing chapter `index`. */
export type TourStep =
  | { kind: "stay" }
  | { kind: "advance"; index: number; seekMs: number | null }
  | { kind: "finish" };

/**
 * Auto-advance: once the sim time reaches the current chapter's end, move to
 * the next chapter (one at a time, so a large frame step never skips a
 * chapter). The next chapter is seeked to its start when there is a gap
 * before it or the clock overshot its start by more than
 * {@link ADVANCE_SEEK_TOLERANCE_MS} (fast chapters step tens of seconds per frame).
 */
export function nextTourStep(tour: ResolvedTour, index: number, ms: number): TourStep {
  const chapter = tour.chapters[index];
  if (!chapter || ms < chapter.endMs) return { kind: "stay" };
  if (index >= tour.chapters.length - 1) return { kind: "finish" };
  const next = tour.chapters[index + 1];
  const offset = ms - next.startMs;
  const seekMs = offset < 0 || offset > ADVANCE_SEEK_TOLERANCE_MS ? next.startMs : null;
  return { kind: "advance", index: index + 1, seekMs };
}

/** Fraction (0–1) of the chapter elapsed at `ms`. */
export function chapterProgress(chapter: ResolvedChapter, ms: number): number {
  const f = (ms - chapter.startMs) / (chapter.endMs - chapter.startMs);
  return Math.min(1, Math.max(0, f));
}

/** "T+hh:mm:ss" / "T−hh:mm:ss" (true minus sign before the epoch). */
export function formatTourClock(deltaMs: number): string {
  const sign = deltaMs < 0 ? "T−" : "T+";
  const total = Math.floor(Math.abs(deltaMs) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Validate `public/demos/index.json` (`{ "demos": [...] }`); bad entries are dropped. */
export function parseDemoIndex(raw: unknown): DemoEntry[] {
  const list = isRecord(raw) && Array.isArray(raw.demos) ? raw.demos : [];
  const out: DemoEntry[] = [];
  for (const d of list) {
    if (!isRecord(d) || !isNonEmptyString(d.id) || !ID_RE.test(d.id)) continue;
    if (!isNonEmptyString(d.title) || !isNonEmptyString(d.tour)) continue;
    out.push({
      id: d.id,
      title: d.title,
      tour: d.tour,
      ...(isNonEmptyString(d.description) ? { description: d.description } : {}),
    });
  }
  return out;
}

/** A demo id from the URL (`?demo=<id>`), or null when absent / malformed. */
export function demoIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("demo");
  return id !== null && ID_RE.test(id) ? id : null;
}
