import { useState } from "react";
import { Box, FileInput, Pencil, Trash2 } from "lucide-react";
import { Button } from "./button";
import PanelSection from "./PanelSection";
import NoticeDialog from "./NoticeDialog";
import { HelpTip } from "./compactControls";
import type { ModelDialogTarget } from "./ModelImportDialog";
import { formatBytes } from "../../lib/modelLibrary/format";
import { libraryModelLengthM } from "../../lib/modelLibrary/orientation";
import { modelLibrary } from "../../lib/modelLibrary/store";
import { DEFAULT_SATELLITE_MODEL, MODEL_SECTION_ANCHOR, libraryModelId, libraryModelKey, type LibraryModelMeta } from "../../lib/modelLibrary/types";
import { useModelLibrary } from "../../lib/modelLibrary/useModelLibrary";

interface Props {
  /** Stored DisplayOptions.satelliteModel ("satellite-bus" | "library:<id>"). */
  satelliteModel: string;
  onSatelliteModelChange: (model: string) => void;
  /** Open the shared import / edit dialog; `onSaved` receives the saved model. */
  openDialog: (target: ModelDialogTarget, onSaved?: (meta: LibraryModelMeta) => void) => void;
  /** A library model was deleted (clear it from tracks etc.). */
  onModelDeleted: (model: string) => void;
  /** Changes when the satellite card asks to show this section (expands it). */
  revealNonce?: number;
}

const HELP_TEXT =
  "近接カメラで衛星に使う3Dモデルを選びます。glTF（.glb / .gltf）を読み込み、向き・大きさ・原点を機体座標に合わせて保存できます。" +
  "読み込んだモデルは軌道データ（時系列）の機体にも使えます。見た目だけの設定で、解析結果は変わりません。";

const fmtLength = (m: number) => (m >= 10 ? `${m.toFixed(0)} m` : m >= 1 ? `${m.toFixed(1)} m` : `${(m * 100).toFixed(0)} cm`);

const isRocket = (m: LibraryModelMeta) => m.origin === "base";

/** 表示タブ「3Dモデル」: 近接の衛星モデルの選択とモデルライブラリの一覧。 */
export default function ModelLibrarySection({ satelliteModel, onSatelliteModelChange, openDialog, onModelDeleted, revealNonce = 0 }: Props) {
  const library = useModelLibrary();
  const [deleting, setDeleting] = useState<LibraryModelMeta | null>(null);

  // Open state: follows the library (open when it has models or a model is chosen)
  // until the user toggles it; a reveal request from the satellite card opens it.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [handledReveal, setHandledReveal] = useState(0);
  if (revealNonce !== handledReveal) {
    setHandledReveal(revealNonce);
    if (revealNonce) setUserOpen(true);
  }
  const open = userOpen ?? (library.models.length > 0 || satelliteModel !== DEFAULT_SATELLITE_MODEL);

  const selectedId = libraryModelId(satelliteModel);
  const missing = library.ready && selectedId !== null && !library.models.some((m) => m.id === selectedId);
  const satellites = library.models.filter((m) => !isRocket(m));
  const rockets = library.models.filter(isRocket);

  const importModel = () =>
    openDialog({ kind: "new", modelKind: "satellite" }, (meta) => onSatelliteModelChange(libraryModelKey(meta.id)));

  const confirmDelete = async (meta: LibraryModelMeta) => {
    const key = libraryModelKey(meta.id);
    await modelLibrary.remove(meta.id);
    if (satelliteModel === key) onSatelliteModelChange(DEFAULT_SATELLITE_MODEL);
    onModelDeleted(key);
  };

  return (
    <PanelSection
      id={MODEL_SECTION_ANCHOR}
      title="3Dモデル"
      icon={<Box />}
      action={<HelpTip text={HELP_TEXT} />}
      collapsible
      open={open}
      onOpenChange={setUserOpen}
    >
      <label className="block space-y-1 text-sm text-fg">
        <span>近接カメラで使う衛星モデル</span>
        <select
          value={satelliteModel}
          onChange={(e) => onSatelliteModelChange(e.target.value)}
          className="h-8 w-full min-w-0 rounded border border-line bg-raised px-1.5 text-sm text-fg"
          aria-label="近接カメラで使う衛星モデル"
        >
          <option value={DEFAULT_SATELLITE_MODEL}>標準バス</option>
          {satellites.length > 0 && (
            <optgroup label="衛星モデル">
              {satellites.map((m) => (
                <option key={m.id} value={libraryModelKey(m.id)}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
          {rockets.length > 0 && (
            <optgroup label="ロケット（底面原点）">
              {rockets.map((m) => (
                <option key={m.id} value={libraryModelKey(m.id)}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
          {/* Kept selectable so picking 標準バス actually clears the stale id. */}
          {selectedId !== null && !library.models.some((m) => m.id === selectedId) && (
            <option value={satelliteModel}>{library.ready ? "見つからないモデル" : "読み込み中…"}</option>
          )}
        </select>
      </label>
      {missing && (
        <p className="text-[11px] text-warning leading-snug">
          選択していたモデルがこのブラウザのライブラリにないため、標準バスで表示しています。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={importModel}
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-raised text-fg border border-line-strong hover:bg-raised-hover hover:text-fg"
        >
          <FileInput className="w-3.5 h-3.5" />
          モデルを読み込む…
        </Button>
      </div>

      {library.models.length > 0 && (
        <ul className="space-y-1" aria-label="モデルライブラリ">
          {library.models.map((m) => {
            const inUse = satelliteModel === libraryModelKey(m.id);
            return (
              <li key={m.id} className="flex min-w-0 items-center gap-1.5 rounded border border-line bg-raised px-2 py-1">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm text-fg" title={m.name}>
                      {m.name}
                    </span>
                    {isRocket(m) && (
                      <span className="shrink-0 rounded bg-sunken px-1 text-[10px] text-fg-muted">ロケット</span>
                    )}
                    {inUse && <span className="shrink-0 rounded bg-brand-soft px-1 text-[10px] text-fg">近接で使用中</span>}
                  </div>
                  <div className="text-[11px] text-fg-subtle tabular-nums">
                    最大 {fmtLength(libraryModelLengthM(m))} · {formatBytes(m.sizeBytes)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openDialog({ kind: "edit", id: m.id })}
                  className="shrink-0 rounded p-1 text-fg-muted hover:bg-raised-hover hover:text-fg"
                  aria-label={`「${m.name}」を編集`}
                  title="編集"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(m)}
                  className="shrink-0 rounded p-1 text-fg-muted hover:bg-raised-hover hover:text-danger"
                  aria-label={`「${m.name}」を削除`}
                  title="削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-fg-subtle leading-snug">
        {library.mode === "session"
          ? "保存領域が使えないため、読み込んだモデルはページを閉じると消えます。"
          : "モデルはこのブラウザに保存されます（他の端末・ブラウザとは共有されません）。"}
      </p>

      <NoticeDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="3Dモデルを削除しますか？"
        description={
          deleting
            ? `「${deleting.name}」をこのブラウザのライブラリから削除します。元に戻せません。\nこのモデルを使っている衛星・軌道データは標準の表示に戻ります。`
            : ""
        }
        confirmLabel="削除"
        destructive
        initialFocus="cancel"
        onConfirm={() => {
          if (deleting) void confirmDelete(deleting);
        }}
      />
    </PanelSection>
  );
}
