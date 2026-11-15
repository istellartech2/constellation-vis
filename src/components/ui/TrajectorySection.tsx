import { useEffect, useRef, useState, type RefObject } from "react";
import { FileInput, Route, Trash2, X, Play, Crosshair, Globe } from "lucide-react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import PanelSection from "./PanelSection";
import { HelpTip } from "./compactControls";
import type SatelliteScene from "../../lib/visualization";
import type { TrajectoryTrack } from "../../lib/trajectory/types";
import { parseTrajectoryFile, toTrajectoryTrack } from "../../lib/trajectory/parse";
import { trajectoryStateAt } from "../../lib/trajectory/interpolate";
import { TRAJECTORY_MODELS } from "../../lib/trajectory/models";
import type { ModelDialogTarget } from "./ModelImportDialog";
import { libraryModelId, libraryModelKey, type LibraryModelMeta } from "../../lib/modelLibrary/types";
import { useModelLibrary } from "../../lib/modelLibrary/useModelLibrary";

/** Playback controls owned by App (scene seek, follow state, speed). */
export interface TrajectoryPlayback {
  /** Track the camera currently follows, or null. */
  followId: string | null;
  /** Start (id) or stop (null) following a track. */
  onFollowChange: (id: string | null) => void;
  /** Seek to `date`, follow `id`, play at 1×. */
  onPlayFrom: (id: string, date: Date) => void;
  /** Seek the simulation clock (no scene rebuild). */
  onSeek: (date: Date) => void;
}

interface Props {
  trajectories: TrajectoryTrack[];
  onTrajectoriesChange: (tracks: TrajectoryTrack[]) => void;
  playback: TrajectoryPlayback;
  currentSimMs: number;
  sceneRef?: RefObject<SatelliteScene | null>;
  /** Open the shared model import dialog (「モデルを読み込む…」). */
  openModelDialog?: (target: ModelDialogTarget, onSaved?: (meta: LibraryModelMeta) => void) => void;
}

interface FileMessage {
  file: string;
  kind: "error" | "warning";
  text: string;
}

const HELP_TEXT =
  "時刻付きの位置データ（ロケットの打ち上げ軌跡など）を読み込み、シミュレーション時刻に合わせて再生します。" +
  "対応形式: ヘッダー付き CSV（緯度・経度・高度 / ECEF / ECI）と CCSDS OEM。" +
  "「開始から」で軌道の開始直前へ移動し、等倍で機体に追従して再生します。" +
  "表示される位置はファイルの内容そのままです（再構成データなら推定値です）。";

/** Lead before the first sample when starting playback of a track. */
const JUMP_LEAD_MS = 5000;

/** <select> values that are not model keys. */
const MODEL_NONE = "";
const MODEL_CUSTOM = "__custom__";
const MODEL_PICK = "__pick__";

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** "T+mm:ss" (or T−mm:ss before the reference epoch). */
function formatTPlus(deltaMs: number): string {
  const sign = deltaMs < 0 ? "T−" : "T+";
  const total = Math.floor(Math.abs(deltaMs) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み取りに失敗しました"));
    reader.readAsText(file);
  });
}

const spanOf = (track: TrajectoryTrack) => ({
  first: track.samples[0].timeMs,
  last: track.samples[track.samples.length - 1].timeMs,
});

/** 表示タブ: 時系列の軌道データ（打ち上げ軌跡など）の読み込み・再生・追従。 */
export default function TrajectorySection({
  trajectories,
  onTrajectoriesChange,
  playback,
  currentSimMs,
  sceneRef,
  openModelDialog,
}: Props) {
  const library = useModelLibrary();
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<FileMessage[]>([]);
  // Monotonic index for colours/ids so a remove-then-add never reuses one.
  const nextIndexRef = useRef(trajectories.length);

  // Scrubbing: the thumb follows the pointer locally, and the scene is
  // seeked at most once per animation frame.
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekFrameRef = useRef<number | null>(null);
  const onSeekRef = useRef(playback.onSeek);
  useEffect(() => {
    onSeekRef.current = playback.onSeek;
  });
  useEffect(
    () => () => {
      if (seekFrameRef.current !== null) cancelAnimationFrame(seekFrameRef.current);
    },
    [],
  );

  const handleLoad = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,.oem";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length === 0) return;
      setLoading(true);
      const nextMessages: FileMessage[] = [];
      const added: TrajectoryTrack[] = [];
      const usedIds = new Set(trajectories.map((t) => t.id));
      nextIndexRef.current = Math.max(nextIndexRef.current, trajectories.length);
      try {
        for (const file of files) {
          try {
            const text = await readAsText(file);
            const result = parseTrajectoryFile(text, file.name, { defaultEpochMs: currentSimMs });
            if (!result.ok) {
              nextMessages.push({ file: file.name, kind: "error", text: result.error });
              continue;
            }
            result.warnings.forEach((w) => nextMessages.push({ file: file.name, kind: "warning", text: w }));
            const index = nextIndexRef.current++;
            let track = toTrajectoryTrack(result.track, index);
            if (usedIds.has(track.id)) track = { ...track, id: `${track.id}-${index}` };
            usedIds.add(track.id);
            added.push(track);
          } catch (err) {
            nextMessages.push({
              file: file.name,
              kind: "error",
              text: err instanceof Error ? err.message : "読み込みに失敗しました",
            });
          }
        }
        if (added.length > 0) onTrajectoriesChange([...trajectories, ...added]);
        setMessages(nextMessages);
      } finally {
        setLoading(false);
      }
    };
    input.click();
  };

  const updateTrack = (id: string, patch: Partial<Pick<TrajectoryTrack, "visible" | "model">>) =>
    onTrajectoriesChange(trajectories.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const removeTrack = (id: string) => {
    if (playback.followId === id) playback.onFollowChange(null);
    onTrajectoriesChange(trajectories.filter((t) => t.id !== id));
  };

  const clearAll = () => {
    if (playback.followId !== null) playback.onFollowChange(null);
    onTrajectoriesChange([]);
    setMessages([]);
  };

  const setModel = (track: TrajectoryTrack, model: string | undefined) => {
    if (model === track.model) return;
    updateTrack(track.id, { model });
  };

  // Import into the library with rocket defaults (origin 底面, nose = longest axis), then assign.
  const importModel = (track: TrajectoryTrack) =>
    openModelDialog?.({ kind: "new", modelKind: "rocket" }, (meta) => setModel(track, libraryModelKey(meta.id)));

  const handleModelChange = (track: TrajectoryTrack, value: string) => {
    if (value === MODEL_PICK) importModel(track);
    else if (value === MODEL_CUSTOM) return;
    else setModel(track, value === MODEL_NONE ? undefined : value);
  };

  /** Label of a model the select has no regular option for (URL from a CSV header, missing library model). */
  const customModelLabel = (model: string) => {
    if (libraryModelId(model) !== null) return library.ready ? "見つからないモデル" : "読み込み中…";
    const file = model.split(/[?#]/)[0].split("/").pop();
    return file ? `外部: ${file}` : "外部モデル";
  };

  const playFromStart = (track: TrajectoryTrack) => {
    if (!track.visible) updateTrack(track.id, { visible: true });
    playback.onPlayFrom(track.id, new Date(spanOf(track).first - JUMP_LEAD_MS));
  };

  const toggleFollow = (track: TrajectoryTrack) => {
    if (playback.followId === track.id) {
      playback.onFollowChange(null);
      return;
    }
    if (!track.visible) updateTrack(track.id, { visible: true });
    playback.onFollowChange(track.id);
  };

  const showOverview = (track: TrajectoryTrack) => {
    if (!track.visible) updateTrack(track.id, { visible: true });
    // Stop the follow on the scene right away (restoring the free camera),
    // so the overview framing below is not undone when App's state catches up.
    const scene = sceneRef?.current ?? null;
    scene?.setTrajectoryFollow(null);
    scene?.focusTrajectory(track.id);
    if (playback.followId !== null) playback.onFollowChange(null);
  };

  // Scrub target: the followed track, else the first visible one in span.
  const scrubTrack =
    trajectories.find((t) => t.id === playback.followId) ??
    trajectories.find((t) => {
      if (!t.visible) return false;
      const { first, last } = spanOf(t);
      return currentSimMs >= first && currentSimMs <= last;
    }) ??
    null;

  const scrubTo = (ms: number) => {
    setScrubMs(ms);
    pendingSeekRef.current = ms;
    if (seekFrameRef.current !== null) return;
    seekFrameRef.current = requestAnimationFrame(() => {
      seekFrameRef.current = null;
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (target !== null) onSeekRef.current(new Date(target));
    });
  };
  const endScrub = () => {
    // Flush a seek still waiting for its frame, so the released thumb does
    // not jump back to the previous time for a frame.
    const target = pendingSeekRef.current;
    if (target !== null) {
      if (seekFrameRef.current !== null) cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
      pendingSeekRef.current = null;
      onSeekRef.current(new Date(target));
    }
    setScrubMs(null);
  };

  const renderScrubber = (track: TrajectoryTrack) => {
    const { first, last } = spanOf(track);
    const epoch = track.epochMs ?? first;
    const shownMs = Math.min(Math.max(scrubMs ?? currentSimMs, first), last);
    const spanS = Math.max(1, Math.round((last - first) / 1000));
    const valueS = Math.round((shownMs - first) / 1000);
    return (
      <div className="space-y-1 rounded border border-line bg-raised px-2 py-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-fg" title={track.name}>
            {track.name}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-fg">{formatTPlus(shownMs - epoch)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={spanS}
          step={1}
          value={valueS}
          aria-label={`「${track.name}」の再生位置`}
          onChange={(e) => scrubTo(first + Number(e.target.value) * 1000)}
          onPointerUp={endScrub}
          onKeyUp={endScrub}
          onBlur={endScrub}
          className="w-full"
        />
        <div className="flex justify-between text-[11px] text-fg-subtle tabular-nums">
          <span>{formatTPlus(first - epoch)}</span>
          <span>{formatTPlus(last - epoch)}</span>
        </div>
      </div>
    );
  };

  const buttonClass = "h-7 gap-1 px-2 text-xs text-fg-muted hover:text-fg";

  return (
    <PanelSection
      title="軌道データ（時系列）"
      icon={<Route />}
      action={<HelpTip text={HELP_TEXT} />}
      collapsible
      defaultOpen={trajectories.length > 0}
    >
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          onClick={handleLoad}
          disabled={loading}
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-raised text-fg border border-line-strong hover:bg-raised-hover hover:text-fg"
        >
          <FileInput className="w-3.5 h-3.5" />
          {loading ? "読み込み中..." : "ファイルを読み込む"}
        </Button>
        {trajectories.length > 0 && (
          <Button onClick={clearAll} variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-fg-muted hover:text-fg">
            <Trash2 className="w-3.5 h-3.5" />
            全てクリア
          </Button>
        )}
      </div>

      {messages.length > 0 && (
        <ul className="space-y-1">
          {messages.map((m, i) => (
            <li
              key={i}
              className={
                m.kind === "error"
                  ? "text-danger text-xs bg-danger-soft p-2 rounded"
                  : "text-fg-muted text-[11px] leading-snug"
              }
            >
              <span className="font-medium">{m.file}</span>: {m.text}
            </li>
          ))}
        </ul>
      )}

      {scrubTrack && renderScrubber(scrubTrack)}

      {trajectories.length > 0 && (
        <ul className="space-y-2">
          {trajectories.map((track) => {
            const { first, last } = spanOf(track);
            const state = track.visible ? trajectoryStateAt(track, currentSimMs) : null;
            const checkboxId = `trajectory-visible-${track.id}`;
            const following = playback.followId === track.id;
            const modelValue = !track.model
              ? MODEL_NONE
              : TRAJECTORY_MODELS.some((m) => m.key === track.model) ||
                  library.models.some((m) => libraryModelKey(m.id) === track.model)
                ? track.model
                : MODEL_CUSTOM;
            return (
              <li key={track.id} className="rounded border border-line bg-raised px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={track.visible}
                    onCheckedChange={(v) => updateTrack(track.id, { visible: v === true })}
                    aria-label={`「${track.name}」を表示`}
                  />
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: track.color }}
                    aria-hidden="true"
                  />
                  <label htmlFor={checkboxId} className="min-w-0 flex-1 truncate text-sm text-fg cursor-pointer" title={track.name}>
                    {track.name}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeTrack(track.id)}
                    className="shrink-0 text-fg-muted hover:text-danger px-0.5"
                    aria-label={`「${track.name}」を削除`}
                    title="削除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Button
                    onClick={() => playFromStart(track)}
                    variant="ghost"
                    size="sm"
                    className={buttonClass}
                    title="軌道の開始直前へ移動し、機体に追従して等倍で再生します"
                  >
                    <Play className="w-3.5 h-3.5" />
                    開始から
                  </Button>
                  <Button
                    onClick={() => toggleFollow(track)}
                    variant="ghost"
                    size="sm"
                    aria-pressed={following}
                    className={following ? "h-7 gap-1 px-2 text-xs bg-raised-hover text-fg" : buttonClass}
                    title={following ? "追従をやめて元の視点に戻します" : "カメラを機体に追従させます（ドラッグで回転、ホイールで拡大縮小）"}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {following ? "追従中" : "追従"}
                  </Button>
                  <Button
                    onClick={() => showOverview(track)}
                    variant="ghost"
                    size="sm"
                    className={buttonClass}
                    title="追従をやめ、軌道の現在位置を真上から見下ろします"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    全体
                  </Button>
                  <select
                    value={modelValue}
                    onChange={(e) => handleModelChange(track, e.target.value)}
                    aria-label={`「${track.name}」の3Dモデル`}
                    title="3Dモデル"
                    className="ml-auto h-7 max-w-[11rem] min-w-0 truncate rounded border border-line bg-raised px-1 text-xs text-fg"
                  >
                    <option value={MODEL_NONE}>なし（点のみ）</option>
                    {TRAJECTORY_MODELS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                    {library.models.length > 0 && (
                      <optgroup label="モデルライブラリ">
                        {library.models.map((m) => (
                          <option key={m.id} value={libraryModelKey(m.id)}>
                            {m.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {modelValue === MODEL_CUSTOM && track.model && (
                      <option value={MODEL_CUSTOM}>{customModelLabel(track.model)}</option>
                    )}
                    {openModelDialog && <option value={MODEL_PICK}>モデルを読み込む…</option>}
                  </select>
                </div>
                <div className="mt-0.5 text-[11px] text-fg-subtle tabular-nums">
                  {formatUtc(first)} – {formatUtc(last)} UTC
                </div>
                {state && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-fg tabular-nums">
                    <span>{formatTPlus(currentSimMs - (track.epochMs ?? first))}</span>
                    <span>高度 {state.altKm.toFixed(1)} km</span>
                    <span>速度 {Math.round(state.speedKmS * 3600).toLocaleString()} km/h</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
