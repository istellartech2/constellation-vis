import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type * as THREE from "three";
import { Box, FileInput, Wand2 } from "lucide-react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { HelpTip, SegmentedControl } from "./compactControls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import ModelPreview from "./ModelPreview";
import NoticeDialog from "./NoticeDialog";
import { checkModelFileName, checkModelFileSize, formatBytes, inspectModelData } from "../../lib/modelLibrary/format";
import {
  autoOrientation,
  axisIndex,
  bodyBoxSize,
  bodyYAxis,
  guessUnit,
  isValidOrientation,
  longestSide,
  metresPerModelUnit,
  sourceUpOf,
  type ModelKind,
  type SourceUp,
  type Vec3,
} from "../../lib/modelLibrary/orientation";
import { modelLibrary } from "../../lib/modelLibrary/store";
import {
  disposeObjectTree,
  listModelNodes,
  measureScene,
  parseModelScene,
  type ModelNodeInfo,
} from "../../lib/modelLibrary/template";
import {
  MODEL_AXES,
  type LibraryModelMeta,
  type ModelAxis,
  type ModelFormat,
  type ModelNodeRef,
  type ModelOrientation,
  type ModelOrigin,
  type ModelScale,
  type ModelUnit,
} from "../../lib/modelLibrary/types";
import { useModelLibrary } from "../../lib/modelLibrary/useModelLibrary";

/** What the dialog opens for: a new import (with satellite or rocket defaults) or editing a library model. */
export type ModelDialogTarget = { kind: "new"; modelKind: ModelKind } | { kind: "edit"; id: string };

interface Props {
  target: ModelDialogTarget | null;
  onClose: () => void;
  /** Called after a successful save (new or edit). */
  onSaved?: (meta: LibraryModelMeta) => void;
}

interface Loaded {
  fileName: string;
  format: ModelFormat;
  sizeBytes: number;
  data: ArrayBuffer;
  scene: THREE.Object3D;
  bbox: Vec3;
  nodes: ModelNodeInfo[];
}

type ScaleChoice = ModelUnit | "length";

const UNIT_OPTIONS: { value: ScaleChoice; label: string }[] = [
  { value: "m", label: "m" },
  { value: "cm", label: "cm" },
  { value: "mm", label: "mm" },
  { value: "in", label: "インチ" },
  { value: "length", label: "実寸" },
];

const UP_OPTIONS: { value: SourceUp; label: string }[] = [
  { value: "y", label: "Y-up（glTF標準）" },
  { value: "z", label: "Z-up（CAD）" },
];

const HELP_TEXT =
  "モデルの向きを機体座標に合わせます。+X = 進行方向（ロケットは機首）、+Z = 地球方向（センサ・アンテナ面。ロケットは腹側）、+Y = Z×X。" +
  "まず元データの上方向（glTF は Y-up、CAD 書き出しは Z-up が多い）を選ぶと自動推定します。" +
  "プレビュー左下の「モデル X/Y/Z」を見ながら、モデル自身のどの軸がそれぞれになるかを選んでください。" +
  "大きさはモデルの単位か実寸（最大長）で指定します。" +
  "太陽電池パドルを選ぶと、1軸追尾のとき機体 Y 軸まわりに回ります（セル面が −Z（天頂側）を向いた状態が 0°）。" +
  "モデルはこのブラウザにだけ保存され、保存したビューや共有には含まれません。";

const fmtM = (m: number) => (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m >= 1 ? m.toFixed(2) : m.toPrecision(2));
const fmtModel = (v: number) => (v >= 100 ? v.toFixed(0) : v.toPrecision(3));

const baseName = (fileName: string) => fileName.replace(/\.(glb|gltf)$/i, "") || "モデル";

const pathKey = (path: readonly number[]) => path.join("/");

/** モデルライブラリへの読み込み・編集ダイアログ（ファイル選択／ドロップ、向き・大きさ・原点・パドル、プレビュー）。 */
export default function ModelImportDialog({ target, onClose, onSaved }: Props) {
  // The body is keyed by its target, so every open starts from a fresh state.
  const key = target ? (target.kind === "edit" ? `edit:${target.id}` : `new:${target.modelKind}`) : "closed";
  // Unsaved changes: Escape / outside click / × ask before discarding them.
  const dirtyRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (dirtyRef.current) setConfirmDiscard(true);
    else onClose();
  };
  return (
    <>
      <Dialog open={target !== null} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent
          className="grid-cols-[minmax(0,1fr)] sm:max-w-3xl max-h-[90vh] overflow-y-auto max-md:h-[100dvh] max-md:rounded-none max-md:pt-3 max-md:pb-0"
          // Focus the dialog itself, not the first control (the ⓘ would pop its bubble open).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          {target && (
            <ModelImportBody
              key={key}
              target={target}
              onClose={onClose}
              onSaved={onSaved}
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <NoticeDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="変更を破棄しますか？"
        description="保存していない変更は失われます。"
        confirmLabel="破棄する"
        destructive
        initialFocus="cancel"
        onConfirm={() => {
          dirtyRef.current = false;
          onClose();
        }}
      />
    </>
  );
}

function ModelImportBody({
  target,
  onClose,
  onSaved,
  onDirtyChange,
}: Props & { target: ModelDialogTarget; onDirtyChange: (dirty: boolean) => void }) {
  const library = useModelLibrary();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(target.kind === "edit");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Edit: the file was replaced (saved together with the settings). */
  const [fileReplaced, setFileReplaced] = useState(false);

  const [name, setName] = useState("");
  const [sourceUp, setSourceUp] = useState<SourceUp>("y");
  const [orientation, setOrientation] = useState<ModelOrientation>({ forward: "+X", nadir: "+Z" });
  const [scaleChoice, setScaleChoice] = useState<ScaleChoice>("m");
  const [lengthInput, setLengthInput] = useState("1");
  const [origin, setOrigin] = useState<ModelOrigin>("center");
  const [solarWings, setSolarWings] = useState<ModelNodeRef[]>([]);
  const [wingAngleDeg, setWingAngleDeg] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = target.kind === "edit" ? library.models.find((m) => m.id === target.id) ?? null : null;
  const modelKind: ModelKind = target.kind === "new" ? target.modelKind : editing?.origin === "base" ? "rocket" : "satellite";
  // Wording follows the chosen origin: 底面 = rocket (機首 / 腹側).
  const rocketWording = origin === "base";

  // Dispose the parsed scene when it is replaced or the dialog closes.
  const loadedRef = useRef<Loaded | null>(null);
  const replaceLoaded = (next: Loaded | null) => {
    if (loadedRef.current && loadedRef.current !== next) disposeObjectTree(loadedRef.current.scene);
    loadedRef.current = next;
    setLoaded(next);
  };
  useEffect(
    () => () => {
      if (loadedRef.current) disposeObjectTree(loadedRef.current.scene);
      loadedRef.current = null;
    },
    [],
  );

  // Edit: load the stored file and settings once.
  const editId = target.kind === "edit" ? target.id : null;
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const entry = await modelLibrary.load(editId);
        if (!entry) throw new Error("モデルがライブラリに見つかりません。");
        const scene = await parseModelScene(entry.data);
        if (cancelled) {
          disposeObjectTree(scene);
          return;
        }
        const { meta } = entry;
        replaceLoaded({
          fileName: meta.fileName,
          format: meta.format,
          sizeBytes: meta.sizeBytes,
          data: entry.data,
          scene,
          bbox: meta.bboxSize,
          nodes: listModelNodes(scene),
        });
        const up = meta.sourceUp ?? sourceUpOf(meta.orientation);
        const choice: ScaleChoice = meta.scale.mode === "unit" ? meta.scale.unit : "length";
        const length = meta.scale.mode === "length" ? String(meta.scale.lengthM) : "1";
        setName(meta.name);
        setSourceUp(up);
        setOrientation(meta.orientation);
        setOrigin(meta.origin);
        setSolarWings(meta.solarWings);
        setScaleChoice(choice);
        setLengthInput(length);
        setSavedSnapshot(
          JSON.stringify([meta.name, up, meta.orientation, choice, choice === "length" ? length : "", meta.origin, meta.solarWings.map((w) => pathKey(w.path))]),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "モデルを読み込めませんでした。");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  /** Read, check and parse a file; null (with the error shown) when it cannot be used. */
  const readModelFile = async (file: File): Promise<Loaded | null> => {
    setError(null);
    setWarning(null);
    const nameError = checkModelFileName(file.name);
    if (nameError) {
      setError(nameError);
      return null;
    }
    const sizeCheck = checkModelFileSize(file.size);
    if (sizeCheck.error) {
      setError(sizeCheck.error);
      return null;
    }
    const data = await file.arrayBuffer();
    const inspected = inspectModelData(data);
    if ("error" in inspected) {
      setError(inspected.error);
      return null;
    }
    let scene: THREE.Object3D;
    try {
      scene = await parseModelScene(data);
    } catch (err) {
      setError(`モデルを読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const bbox = measureScene(scene);
    if (!(longestSide(bbox) > 0)) {
      disposeObjectTree(scene);
      setError("形状（メッシュ）のないモデルです。");
      return null;
    }
    setWarning(sizeCheck.warning ?? null);
    return { fileName: file.name, format: inspected.format, sizeBytes: file.size, data, scene, bbox, nodes: listModelNodes(scene) };
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const next = await readModelFile(file);
      if (!next) return;
      if (target.kind === "edit") {
        // 「ファイルを差し替え…」: keep the settings; re-guess the unit for the new size and keep
        // only paddle nodes that still exist with the same name.
        const kept = solarWings.filter((w) => next.nodes.some((n) => pathKey(n.path) === pathKey(w.path) && n.name === w.name));
        if (kept.length !== solarWings.length) {
          setWarning((w) => [w, "新しいファイルに見つからない太陽電池パドルの選択を外しました。"].filter(Boolean).join(" "));
        }
        setSolarWings(kept);
        if (scaleChoice !== "length") setScaleChoice(guessUnit(longestSide(next.bbox)));
        replaceLoaded(next);
        setFileReplaced(true);
        return;
      }
      replaceLoaded(next);
      setName(baseName(file.name));
      setOrientation(autoOrientation(next.bbox, modelKind, sourceUp));
      setScaleChoice(guessUnit(longestSide(next.bbox)));
      setLengthInput("1");
      setOrigin(modelKind === "rocket" ? "base" : "center");
      setSolarWings([]);
      setWingAngleDeg(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ファイルを読み取れませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const orientationValid = isValidOrientation(orientation);
  const lengthM = Number(lengthInput);
  const lengthValid = scaleChoice !== "length" || (Number.isFinite(lengthM) && lengthM > 0);
  const scale: ModelScale = useMemo(
    () => (scaleChoice === "length" ? { mode: "length", lengthM: lengthM > 0 ? lengthM : 1 } : { mode: "unit", unit: scaleChoice }),
    [scaleChoice, lengthM],
  );
  const previewSettings = useMemo(() => ({ orientation, scale, origin, solarWings }), [orientation, scale, origin, solarWings]);

  // Unsaved changes (reported to the dialog for the discard confirmation).
  const snapshot = JSON.stringify([
    name,
    sourceUp,
    orientation,
    scaleChoice,
    scaleChoice === "length" ? lengthInput : "",
    origin,
    solarWings.map((w) => pathKey(w.path)),
  ]);
  const dirty = target.kind === "new" ? loaded !== null : fileReplaced || (savedSnapshot !== null && snapshot !== savedSnapshot);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const bodySizeM: Vec3 | null =
    loaded && orientationValid
      ? (bodyBoxSize(orientation, loaded.bbox).map((v) => v * metresPerModelUnit(scale, longestSide(loaded.bbox))) as Vec3)
      : null;

  const canSave = !!loaded && orientationValid && lengthValid && name.trim().length > 0 && !busy;

  const handleSave = async () => {
    if (!loaded || !canSave) return;
    setBusy(true);
    setError(null);
    const settings = { name: name.trim(), orientation, scale, origin, solarWings, sourceUp };
    try {
      const meta =
        target.kind === "edit"
          ? await modelLibrary.update(
              target.id,
              settings,
              fileReplaced
                ? { fileName: loaded.fileName, format: loaded.format, sizeBytes: loaded.sizeBytes, bboxSize: loaded.bbox, data: loaded.data }
                : undefined,
            )
          : await modelLibrary.add(
              { fileName: loaded.fileName, format: loaded.format, sizeBytes: loaded.sizeBytes, bboxSize: loaded.bbox },
              settings,
              loaded.data,
            );
      if (!meta) throw new Error("モデルがライブラリに見つかりません。");
      onDirtyChange(false);
      onSaved?.(meta);
      onClose();
    } catch (err) {
      setError(`保存できませんでした: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeSourceUp = (up: SourceUp) => {
    setSourceUp(up);
    if (loaded) setOrientation(autoOrientation(loaded.bbox, modelKind, up));
  };

  const setAxis = (key: keyof ModelOrientation, axis: ModelAxis) => setOrientation((o) => ({ ...o, [key]: axis }));

  const toggleWing = (node: ModelNodeInfo, on: boolean) =>
    setSolarWings((prev) => {
      const same = (w: ModelNodeRef) => pathKey(w.path) === pathKey(node.path);
      return on ? [...prev.filter((w) => !same(w)), { path: node.path, name: node.name }] : prev.filter((w) => !same(w));
    });

  const forwardLabel = rocketWording ? "機首（+X）になる軸" : "進行方向（+X）になる軸";
  const nadirLabel = rocketWording ? "腹側（+Z）になる軸" : "地球側・センサ方向（+Z）になる軸";

  const axisSelect = (key: keyof ModelOrientation, label: string) => (
    <label className="flex items-center justify-between gap-2 text-xs text-fg">
      <span className="min-w-0">{label}</span>
      <select
        value={orientation[key]}
        onChange={(e) => setAxis(key, e.target.value as ModelAxis)}
        className="h-7 w-24 shrink-0 rounded border border-line bg-raised px-1 text-xs text-fg"
        aria-label={label}
      >
        {MODEL_AXES.map((a) => (
          // The second axis cannot share the first one's letter (they must be perpendicular).
          <option key={a} value={a} disabled={key === "nadir" && axisIndex(a) === axisIndex(orientation.forward)}>
            モデル {a}
          </option>
        ))}
      </select>
    </label>
  );

  // Wings actually turned (nodes inside another selected node turn with it).
  const effectiveWings = solarWings.filter(
    (w) => !solarWings.some((o) => o.path.length < w.path.length && o.path.every((v, i) => w.path[i] === v)),
  ).length;

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="flex items-center gap-2 pr-8">
          <Box className="size-4 text-fg-subtle" aria-hidden="true" />
          {target.kind === "edit" ? "3Dモデルを編集" : "3Dモデルを読み込む"}
          <HelpTip text={HELP_TEXT} />
        </DialogTitle>
        <DialogDescription className="text-xs text-fg-muted">
          glTF 2.0（.glb、またはデータ埋め込みの .gltf）、{formatBytes(50 * 1024 * 1024)} まで。
          {library.mode === "session"
            ? "このブラウザでは保存領域が使えないため、ページを閉じるまでの一時保存になります。"
            : "このブラウザに保存され、再読み込み後も使えます（他の端末・ブラウザとは共有されません）。"}
        </DialogDescription>
      </DialogHeader>

      {!loaded && target.kind !== "edit" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm ${
            dragOver ? "border-brand bg-raised-hover" : "border-line-strong bg-sunken"
          }`}
        >
          <p className="text-fg-muted">ここに .glb / .gltf ファイルをドロップ</p>
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy} className="gap-1.5">
            <FileInput className="size-3.5" />
            {busy ? "読み込み中..." : "ファイルを選ぶ"}
          </Button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        className="hidden"
        data-testid="model-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      {error && <div className="rounded bg-danger-soft p-2 text-xs text-danger" role="alert">{error}</div>}
      {warning && <div className="rounded bg-warning-soft p-2 text-xs text-warning">{warning}</div>}
      {busy && target.kind === "edit" && !loaded && <p className="text-xs text-fg-muted">読み込み中...</p>}

      {loaded && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          {/* Phones: the preview stays at the top while the settings scroll under it. */}
          <div className="flex min-h-0 flex-col gap-1 self-start md:sticky md:top-0 max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-6 max-md:bg-surface-solid max-md:px-6 max-md:pb-2">
            <ModelPreview
              scene={loaded.scene}
              settings={previewSettings}
              valid={orientationValid && lengthValid}
              wingAngleDeg={wingAngleDeg}
              legend={rocketWording ? { x: "機首", z: "腹側" } : { x: "進行方向", z: "地球方向（センサ）" }}
            />
            <p className="text-[11px] text-fg-subtle">
              ドラッグで回転・ピンチ／ホイールで拡大。上が天頂側（−Z）、下が地球側（+Z）です。
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <label className="block space-y-1">
              <span className="text-fg-muted">名前</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="h-8 w-full rounded border border-line bg-raised px-2 text-sm text-fg"
              />
            </label>
            <p className="truncate text-[11px] text-fg-subtle" title={loaded.fileName}>
              {loaded.fileName}（{formatBytes(loaded.sizeBytes)}）{fileReplaced && " · 差し替え後"}
            </p>

            <fieldset className="space-y-1.5">
              <legend className="mb-1 flex w-full items-center justify-between font-semibold text-fg">
                向き
                <button
                  type="button"
                  data-slot="button"
                  onClick={() => setOrientation(autoOrientation(loaded.bbox, modelKind, sourceUp))}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-fg-muted hover:bg-raised-hover hover:text-fg"
                >
                  <Wand2 className="size-3" />
                  自動推定
                </button>
              </legend>
              <div className="space-y-1">
                <span className="text-fg-muted">元データの上方向</span>
                <SegmentedControl ariaLabel="元データの上方向" value={sourceUp} options={UP_OPTIONS} onChange={changeSourceUp} />
              </div>
              {axisSelect("forward", forwardLabel)}
              {axisSelect("nadir", nadirLabel)}
              {orientationValid ? (
                <p className="text-[11px] text-fg-subtle">+Y になる軸: モデル {bodyYAxis(orientation)}</p>
              ) : (
                <p className="text-[11px] text-danger" role="alert">
                  2つの軸は直交するもの（X・Y・Z の別々の軸）を選んでください。
                </p>
              )}
              {!rocketWording && <p className="text-[11px] text-fg-subtle">CAD（Z-up）由来なら地球側は多くの場合 モデル −Z</p>}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-1 font-semibold text-fg">大きさ</legend>
              <p className="text-[11px] text-fg-subtle tabular-nums">
                検出サイズ（モデル単位）: {loaded.bbox.map(fmtModel).join(" × ")}
              </p>
              <SegmentedControl ariaLabel="モデルの単位" value={scaleChoice} options={UNIT_OPTIONS} onChange={setScaleChoice} />
              {scaleChoice === "length" && (
                <label className="flex items-center gap-2">
                  <span className="text-fg-muted">実寸（最大長 m）</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={lengthInput}
                    onChange={(e) => setLengthInput(e.target.value)}
                    className="option-number-input"
                    aria-invalid={!lengthValid}
                  />
                </label>
              )}
              {bodySizeM && lengthValid && (
                <p className="text-[11px] text-fg tabular-nums">
                  → X {fmtM(bodySizeM[0])} × Y {fmtM(bodySizeM[1])} × Z {fmtM(bodySizeM[2])} m（最大 {fmtM(Math.max(...bodySizeM))} m）
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-1 font-semibold text-fg">原点</legend>
              <SegmentedControl
                ariaLabel="原点"
                value={origin}
                options={[
                  { value: "center", label: "中心" },
                  { value: "base", label: "底面（ロケット）" },
                ]}
                onChange={setOrigin}
              />
            </fieldset>

            {loaded.nodes.length > 0 && (
              <details className="rounded border border-line" open={solarWings.length > 0}>
                <summary className="cursor-pointer select-none px-2 py-1.5 font-semibold text-fg">
                  太陽電池パドル（任意）{effectiveWings > 0 && `: ${effectiveWings} 個`}
                </summary>
                <div className="space-y-1 border-t border-line px-2 py-1.5">
                  <p className="text-[11px] text-fg-subtle leading-snug">
                    1軸追尾のとき機体 Y 軸まわりに回す部品を選びます（プレビューで黄色の枠）。セル面が −Z（天頂側）を向いた状態が 0° です。
                  </p>
                  <ul className="max-h-40 overflow-y-auto">
                    {loaded.nodes.map((node) => {
                      const key = pathKey(node.path);
                      const id = `model-node-${key}`;
                      const checked = solarWings.some((w) => pathKey(w.path) === key);
                      return (
                        <li key={key} className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: node.depth * 12 }}>
                          <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggleWing(node, v === true)} />
                          <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-fg" title={node.name}>
                            {node.name || `（名前なし ${key}）`}
                          </label>
                          {node.meshes > 0 && <span className="shrink-0 text-[10px] text-fg-subtle">メッシュ {node.meshes}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {solarWings.length > 0 && (
                    <label className="flex items-center gap-2 pt-1">
                      <span className="shrink-0 text-fg-muted">回転を確認</span>
                      <input
                        type="range"
                        min={0}
                        max={180}
                        step={1}
                        value={wingAngleDeg}
                        onChange={(e) => setWingAngleDeg(Number(e.target.value))}
                        className="option-slider"
                        aria-label="太陽電池パドルの回転を確認"
                      />
                      <span className="w-9 shrink-0 text-right tabular-nums text-fg">{wingAngleDeg}°</span>
                    </label>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Phones: 保存 stays reachable at the bottom. */}
      <DialogFooter className="max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-6 max-md:border-t max-md:border-line max-md:bg-surface-solid max-md:px-6 max-md:py-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {loaded && (
          <Button variant="ghost" className="sm:mr-auto" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {target.kind === "edit" ? "ファイルを差し替え…" : "別のファイル…"}
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {busy && loaded ? "保存中..." : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}
