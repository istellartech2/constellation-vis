import { useEffect, useRef, useState, type RefObject } from "react";
import { FileInput, Route, Trash2, X, SkipBack } from "lucide-react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import PanelSection from "./PanelSection";
import { HelpTip } from "./compactControls";
import type SatelliteScene from "../../lib/visualization";
import type { TrajectoryTrack } from "../../lib/trajectory/types";
import { parseTrajectoryFile, toTrajectoryTrack } from "../../lib/trajectory/parse";
import { trajectoryStateAt } from "../../lib/trajectory/interpolate";

interface Props {
  trajectories: TrajectoryTrack[];
  onTrajectoriesChange: (tracks: TrajectoryTrack[]) => void;
  /** Restart the simulation at `date`; rebuilds the scene. */
  onJumpToTime: (date: Date) => void;
  currentSimMs: number;
  sceneRef?: RefObject<SatelliteScene | null>;
}

interface FileMessage {
  file: string;
  kind: "error" | "warning";
  text: string;
}

const HELP_TEXT =
  "時刻付きの位置データ（ロケットの打ち上げ軌跡など）を読み込み、シミュレーション時刻に合わせて再生します。" +
  "対応形式: ヘッダー付き CSV（緯度・経度・高度 / ECEF / ECI）と CCSDS OEM。" +
  "表示される位置はファイルの内容そのままです（再構成データなら推定値です）。";

/** Lead before the first sample when jumping to a track's start. */
const JUMP_LEAD_MS = 5000;

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

/** 表示タブ: 時系列の軌道データ（打ち上げ軌跡など）の読み込みと再生状況。 */
export default function TrajectorySection({
  trajectories,
  onTrajectoriesChange,
  onJumpToTime,
  currentSimMs,
  sceneRef,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<FileMessage[]>([]);
  // Monotonic index for colours/ids so a remove-then-add never reuses one.
  const nextIndexRef = useRef(trajectories.length);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
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

  const updateTrack = (id: string, patch: Partial<Pick<TrajectoryTrack, "visible">>) =>
    onTrajectoriesChange(trajectories.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const removeTrack = (id: string) => onTrajectoriesChange(trajectories.filter((t) => t.id !== id));

  const clearAll = () => {
    onTrajectoriesChange([]);
    setMessages([]);
  };

  const jumpToStart = (track: TrajectoryTrack) => {
    const before = sceneRef?.current ?? null;
    onJumpToTime(new Date(track.samples[0].timeMs - JUMP_LEAD_MS));
    if (!track.visible) updateTrack(track.id, { visible: true });
    // The jump changes startTime, which rebuilds the scene asynchronously
    // (useSatelliteScene constructs it ~10 ms after React commits). Poll
    // until a *new* scene instance exists, then focus it; focusing the old
    // instance would be lost when it is disposed. Bounded to ~2 s.
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    let tries = 0;
    const attempt = () => {
      focusTimerRef.current = null;
      const scene = sceneRef?.current ?? null;
      if (scene && scene !== before) {
        scene.focusTrajectory(track.id);
        return;
      }
      if (++tries < 40) focusTimerRef.current = window.setTimeout(attempt, 50);
    };
    focusTimerRef.current = window.setTimeout(attempt, 30);
  };

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

      {trajectories.length > 0 && (
        <ul className="space-y-2">
          {trajectories.map((track) => {
            const first = track.samples[0].timeMs;
            const last = track.samples[track.samples.length - 1].timeMs;
            const state = track.visible ? trajectoryStateAt(track, currentSimMs) : null;
            const checkboxId = `trajectory-visible-${track.id}`;
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
                  <Button
                    onClick={() => jumpToStart(track)}
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-fg-muted hover:text-fg"
                    title="シミュレーション時刻を軌道の開始直前へ移動し、カメラを向けます"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                    開始へ
                  </Button>
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
