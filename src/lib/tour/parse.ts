/**
 * Guided tour JSON: validation, time resolution and chapter bookkeeping.
 * Pure functions (no DOM, React or three.js) so they are unit-testable.
 * Error messages are Japanese because they are shown in the UI.
 */
import { parseUtcTimestamp } from "../trajectory/parse";
import type { TrajectoryLandmark, TrajectoryTrailStyle } from "../trajectory/types";
import type {
  DemoEntry,
  ResolvedCameraChange,
  ResolvedChapter,
  ResolvedLandmark,
  ResolvedTour,
  TourCamera,
  TourCameraChange,
  TourChapterDef,
  TourDefinition,
  TourLandmarkDef,
  TourOrbitCounter,
  TourResult,
  TourSpeedChange,
  TourTime,
  TourTrackRef,
  TourTrail,
} from "./types";

/** Highest playback speed a tour may request (× real time). */
export const MAX_TOUR_SPEED = 100_000;

/** Overshoot past a chapter boundary beyond which the next chapter is re-seeked to its start. */
export const ADVANCE_SEEK_TOLERANCE_MS = 1000;

/** Highest chapter speed when the viewer prefers reduced motion (× real time). */
export const REDUCED_MOTION_MAX_SPEED = 1000;

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
    if (type === "overview") return { ok: true, value: { type, track: track as string } };
    const { distanceM, targetUpM, include, transitionS } = raw;
    if (distanceM !== undefined && (typeof distanceM !== "number" || !(distanceM > 0 && distanceM <= 2_500_000))) {
      return { ok: false, error: `${where}: camera.distanceM は 0 より大きく 2500000 以下（メートル）です` };
    }
    if (targetUpM !== undefined && (typeof targetUpM !== "number" || !(Math.abs(targetUpM) <= 10_000))) {
      return { ok: false, error: `${where}: camera.targetUpM は ±10000 以内（メートル）です` };
    }
    if (include !== undefined && (!isNonEmptyString(include) || !trackKeys.has(include) || include === track)) {
      return { ok: false, error: `${where}: camera.include「${String(include)}」は track 以外の tracks のキーです` };
    }
    if (transitionS !== undefined && (typeof transitionS !== "number" || !(transitionS >= 0 && transitionS <= 60))) {
      return { ok: false, error: `${where}: camera.transitionS は 0〜60（秒）です` };
    }
    return {
      ok: true,
      value: {
        type,
        track: track as string,
        ...(distanceM !== undefined ? { distanceM } : {}),
        ...(targetUpM !== undefined ? { targetUpM } : {}),
        ...(include !== undefined ? { include } : {}),
        ...(transitionS !== undefined ? { transitionS } : {}),
      },
    };
  }
  if (type === "globe") {
    const distance = raw.distance;
    if (distance !== undefined && (typeof distance !== "number" || !(distance >= 1.05 && distance <= 30))) {
      return { ok: false, error: `${where}: camera.distance は 1.05〜30（地球半径）で指定してください` };
    }
    const chase = raw.chase;
    if (chase !== undefined && typeof chase !== "boolean") return { ok: false, error: `${where}: camera.chase は true / false です` };
    const tiltDeg = raw.tiltDeg;
    if (tiltDeg !== undefined && (typeof tiltDeg !== "number" || !(tiltDeg >= -85 && tiltDeg <= 85))) {
      return { ok: false, error: `${where}: camera.tiltDeg は −85〜85（度）です` };
    }
    return {
      ok: true,
      value: {
        type,
        ...(track !== undefined ? { track: track as string } : {}),
        ...(distance !== undefined ? { distance } : {}),
        ...(chase !== undefined ? { chase } : {}),
        ...(tiltDeg !== undefined ? { tiltDeg } : {}),
      },
    };
  }
  return { ok: false, error: `${where}: camera.type は follow / overview / globe のいずれかです` };
}

function validateTrail(raw: unknown, where: string): TourResult<TourTrail | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isRecord(raw)) return { ok: false, error: `${where}: trail は { future, windowS, frame } です` };
  const { future, windowS, frame } = raw;
  if (future !== undefined && typeof future !== "boolean") return { ok: false, error: `${where}: trail.future は true / false です` };
  if (windowS !== undefined && (typeof windowS !== "number" || !(windowS > 0))) {
    return { ok: false, error: `${where}: trail.windowS は 0 より大きい秒数です` };
  }
  if (frame !== undefined && frame !== "earth" && frame !== "inertial") {
    return { ok: false, error: `${where}: trail.frame は earth / inertial です` };
  }
  return {
    ok: true,
    value: {
      ...(future !== undefined ? { future } : {}),
      ...(windowS !== undefined ? { windowS } : {}),
      ...(frame !== undefined ? { frame } : {}),
    },
  };
}

const finiteIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && v >= min && v <= max;

function validateLandmark(raw: unknown, where: string, keys: Set<string>): TourResult<TourLandmarkDef> {
  if (!isRecord(raw) || !isNonEmptyString(raw.key) || !ID_RE.test(raw.key)) return { ok: false, error: `${where}: key（英数字・-・_）が必要です` };
  if (keys.has(raw.key)) return { ok: false, error: `${where}: key「${raw.key}」が重複しています` };
  if (!finiteIn(raw.lat, -90, 90) || !finiteIn(raw.lon, -180, 180)) return { ok: false, error: `${where}: lat / lon（度）が必要です` };
  if (raw.altKm !== undefined && !finiteIn(raw.altKm, -1, 1000)) return { ok: false, error: `${where}: altKm は -1〜1000 です` };
  if (raw.headingDeg !== undefined && !finiteIn(raw.headingDeg, -360, 360)) return { ok: false, error: `${where}: headingDeg は ±360 以内です` };
  if (raw.maxDistanceKm !== undefined && !finiteIn(raw.maxDistanceKm, 0, 1e6)) return { ok: false, error: `${where}: maxDistanceKm は 0 以上です` };
  for (const opt of ["label", "model", "color"] as const) {
    if (raw[opt] !== undefined && !isNonEmptyString(raw[opt])) return { ok: false, error: `${where}: ${opt} は文字列です` };
  }
  for (const opt of ["from", "until"] as const) {
    if (raw[opt] !== undefined && !validTime(raw[opt])) return { ok: false, error: `${where}: ${opt} は時刻です` };
  }
  const value: TourLandmarkDef = { key: raw.key, lat: raw.lat, lon: raw.lon };
  if (raw.label !== undefined) value.label = raw.label as string;
  if (raw.altKm !== undefined) value.altKm = raw.altKm;
  if (raw.model !== undefined) value.model = raw.model as string;
  if (raw.headingDeg !== undefined) value.headingDeg = raw.headingDeg;
  if (raw.color !== undefined) value.color = raw.color as string;
  if (raw.from !== undefined) value.from = raw.from as TourTime;
  if (raw.until !== undefined) value.until = raw.until as TourTime;
  if (raw.maxDistanceKm !== undefined) value.maxDistanceKm = raw.maxDistanceKm;
  return { ok: true, value };
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
  for (const key of ["subtitle", "disclaimer", "epoch", "clockLabel", "telemetryNote"] as const) {
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
    if (t.holdS !== undefined && !finiteIn(t.holdS, 0, 86_400)) return { ok: false, error: `${where}: holdS は 0〜86400（秒）です` };
    trackKeys.add(t.key);
    tracks.push({
      key: t.key,
      url: t.url,
      ...(t.label !== undefined ? { label: t.label as string } : {}),
      ...(t.model !== undefined ? { model: t.model as string } : {}),
      ...(t.color !== undefined ? { color: t.color as string } : {}),
      ...(t.holdS !== undefined ? { holdS: t.holdS } : {}),
    });
  }

  let landmarks: TourLandmarkDef[] | undefined;
  if (raw.landmarks !== undefined) {
    if (!Array.isArray(raw.landmarks)) return { ok: false, error: "landmarks は配列です" };
    landmarks = [];
    const keys = new Set<string>();
    for (const [i, l] of raw.landmarks.entries()) {
      const lm = validateLandmark(l, `landmarks[${i}]`, keys);
      if (!lm.ok) return lm;
      keys.add(lm.value.key);
      landmarks.push(lm.value);
    }
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
    const cameraChanges: TourCameraChange[] = [];
    if (c.cameraChanges !== undefined) {
      if (!Array.isArray(c.cameraChanges)) return { ok: false, error: `${where}: cameraChanges は配列です` };
      for (const cc of c.cameraChanges) {
        if (!isRecord(cc) || !validTime(cc.at)) return { ok: false, error: `${where}: cameraChanges の要素は { at, camera } です` };
        const cam = validateCamera(cc.camera, `${where}.cameraChanges`, trackKeys);
        if (!cam.ok) return cam;
        cameraChanges.push({ at: cc.at, camera: cam.value });
      }
    }
    const trail = validateTrail(c.trail, where);
    if (!trail.ok) return trail;
    let orbitCounter: TourOrbitCounter | undefined;
    if (c.orbitCounter !== undefined) {
      const oc = c.orbitCounter;
      if (!isRecord(oc) || !isNonEmptyString(oc.track) || !trackKeys.has(oc.track)) {
        return { ok: false, error: `${where}: orbitCounter.track は tracks のキーです` };
      }
      if (oc.from !== undefined && !validTime(oc.from)) return { ok: false, error: `${where}: orbitCounter.from は時刻です` };
      if (oc.total !== undefined && !(Number.isInteger(oc.total) && (oc.total as number) > 0)) {
        return { ok: false, error: `${where}: orbitCounter.total は正の整数です` };
      }
      orbitCounter = {
        track: oc.track,
        ...(oc.from !== undefined ? { from: oc.from as TourTime } : {}),
        ...(oc.total !== undefined ? { total: oc.total as number } : {}),
      };
    }
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
      ...(cameraChanges.length > 0 ? { cameraChanges } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(trail.value ? { trail: trail.value } : {}),
      ...(orbitCounter ? { orbitCounter } : {}),
    });
  }

  let ending: TourDefinition["ending"];
  if (raw.ending !== undefined) {
    if (!isRecord(raw.ending) || !isNonEmptyString(raw.ending.title) || typeof raw.ending.caption !== "string") {
      return { ok: false, error: "ending は { title, caption } です" };
    }
    ending = { title: raw.ending.title, caption: raw.ending.caption };
    if (raw.ending.camera !== undefined) {
      const cam = validateCamera(raw.ending.camera, "ending", trackKeys);
      if (!cam.ok) return cam;
      ending.camera = cam.value;
    }
    const endTrail = validateTrail(raw.ending.trail, "ending");
    if (!endTrail.ok) return endTrail;
    if (endTrail.value) ending.trail = endTrail.value;
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
      ...(raw.clockLabel !== undefined ? { clockLabel: raw.clockLabel as string } : {}),
      ...(raw.telemetryNote !== undefined ? { telemetryNote: raw.telemetryNote as string } : {}),
      tracks,
      ...(landmarks ? { landmarks } : {}),
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
    const cameraChanges: ResolvedCameraChange[] = [];
    for (const cc of c.cameraChanges ?? []) {
      const atMs = resolveTourTime(cc.at, epochMs);
      if (!Number.isFinite(atMs) || atMs <= startMs || atMs >= endMs) {
        return { ok: false, error: `${where}: cameraChanges の時刻は章の範囲内にしてください` };
      }
      cameraChanges.push({ atMs, camera: cc.camera });
    }
    cameraChanges.sort((a, b) => a.atMs - b.atMs);
    let orbitCounter: ResolvedChapter["orbitCounter"] = null;
    if (c.orbitCounter) {
      const fromMs = c.orbitCounter.from !== undefined ? resolveTourTime(c.orbitCounter.from, epochMs) : startMs;
      if (!Number.isFinite(fromMs)) return { ok: false, error: `${where}: orbitCounter.from が読めません` };
      orbitCounter = {
        track: c.orbitCounter.track,
        fromMs,
        ...(c.orbitCounter.total !== undefined ? { total: c.orbitCounter.total } : {}),
      };
    }
    chapters.push({
      id: c.id,
      title: c.title,
      caption: c.caption,
      speed: c.speed,
      camera: c.camera,
      startMs,
      endMs,
      speedChanges,
      cameraChanges,
      telemetry: c.telemetry ?? [],
      ...(c.trail ? { trail: c.trail } : {}),
      orbitCounter,
    });
  }
  const landmarks: ResolvedLandmark[] = [];
  for (const [i, l] of (def.landmarks ?? []).entries()) {
    const { from, until, ...rest } = l;
    const fromMs = from !== undefined ? resolveTourTime(from, epochMs) : undefined;
    const untilMs = until !== undefined ? resolveTourTime(until, epochMs) : undefined;
    if ((fromMs !== undefined && !Number.isFinite(fromMs)) || (untilMs !== undefined && !Number.isFinite(untilMs))) {
      return { ok: false, error: `landmarks[${i}]: from / until が読めません` };
    }
    landmarks.push({ ...rest, ...(fromMs !== undefined ? { fromMs } : {}), ...(untilMs !== undefined ? { untilMs } : {}) });
  }
  return { ok: true, value: { ...def, epochMs, chapters, landmarks } };
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

/**
 * Camera of `chapter` at `ms`: the latest camera change at or before it, else
 * the chapter camera (`index` −1). The index lets the player apply each
 * change once.
 */
export function chapterCameraAt(chapter: ResolvedChapter, ms: number): { index: number; camera: TourCamera } {
  let index = -1;
  for (let i = 0; i < chapter.cameraChanges.length; i++) {
    if (chapter.cameraChanges[i].atMs <= ms) index = i;
    else break;
  }
  return { index, camera: index < 0 ? chapter.camera : chapter.cameraChanges[index].camera };
}

/** Chapter speed for playback: capped when the viewer prefers reduced motion. */
export function tourPlaybackSpeed(speed: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(speed, REDUCED_MOTION_MAX_SPEED) : speed;
}

/**
 * Trail style of one tour track. `focus` is true for the camera's track (or
 * every track when the camera has none, and on the end card): it shows its
 * future path unless the trail says otherwise; any other track only shows
 * what it has flown, so its long path does not sweep across a close view.
 */
export function tourTrailStyle(trail: TourTrail | undefined, focus: boolean): TrajectoryTrailStyle {
  return {
    future: focus ? trail?.future !== false : false,
    ...(trail?.windowS !== undefined ? { windowMs: trail.windowS * 1000 } : {}),
    ...(trail?.frame !== undefined ? { frame: trail.frame } : {}),
  };
}

/** Scene landmarks of a tour (ids unique per tour). */
export function tourLandmarks(tour: ResolvedTour): TrajectoryLandmark[] {
  return tour.landmarks.map((l) => ({
    id: `tour-${tour.id}-landmark-${l.key}`,
    latDeg: l.lat,
    lonDeg: l.lon,
    ...(l.label !== undefined ? { label: l.label } : {}),
    ...(l.altKm !== undefined ? { altKm: l.altKm } : {}),
    ...(l.model !== undefined ? { model: l.model } : {}),
    ...(l.headingDeg !== undefined ? { headingDeg: l.headingDeg } : {}),
    ...(l.color !== undefined ? { color: l.color } : {}),
    ...(l.fromMs !== undefined ? { fromMs: l.fromMs } : {}),
    ...(l.untilMs !== undefined ? { untilMs: l.untilMs } : {}),
    ...(l.maxDistanceKm !== undefined ? { maxDistanceKm: l.maxDistanceKm } : {}),
  }));
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
      ...(isNonEmptyString(d.category) ? { category: d.category } : {}),
      ...(isNonEmptyString(d.date) && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? { date: d.date } : {}),
      ...(typeof d.durationMin === "number" && Number.isFinite(d.durationMin) && d.durationMin > 0
        ? { durationMin: d.durationMin }
        : {}),
    });
  }
  return out;
}

/** A demo id from the URL (`?demo=<id>`), or null when absent / malformed. */
export function demoIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("demo");
  return id !== null && ID_RE.test(id) ? id : null;
}
