import { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";
import { Label } from "./label";
import type { ConstellationConfig, ConstellationShell } from "../../lib/constellationTypes";
import { createNewShell, createDefaultConfig } from "../../lib/constellationTypes";
import { syncDerivedFields } from "../../lib/constellationPatterns/migrate";
import {
  isBlockingError,
  parseConstellationConfig,
  serializeConstellationConfig,
  validateConfig,
  type ValidationError,
} from "../../lib/constellationSerializer";
import ConstellationShellList from "./ConstellationShellList";
import ConstellationShellForm from "./ConstellationShellForm";
import MissionDesignPane from "./MissionDesignPane";
import { constraintsFromShell, type MissionDesignForm } from "../../lib/missionDesignForm";

interface Props {
  open: boolean;
  constText: string;
  onConstTextChange: (text: string) => void;
  onClose: () => void;
}

/** Which pane fills the dialog body. */
type Mode = "shells" | "mission";

export default function ConstellationEditorDialog({
  open,
  constText,
  onConstTextChange,
  onClose,
}: Props) {
  const [config, setConfig] = useState<ConstellationConfig>(createDefaultConfig());
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [mode, setMode] = useState<Mode>("shells");
  /** Constraints handed to the wizard by 「設計をやり直す」; null = wizard defaults. */
  const [missionPrefill, setMissionPrefill] = useState<MissionDesignForm | null>(null);
  const [missionOpened, setMissionOpened] = useState(false);
  const [missionSession, setMissionSession] = useState(0);

  // Initialize config when dialog opens
  useEffect(() => {
    if (open) {
      const parsed = parseConstellationConfig(constText);
      setConfig(parsed);
      setSelectedShellId(parsed.shells[0]?.id ?? null);
      setErrors([]);
      setMode("shells");
      setMissionPrefill(null);
      setMissionOpened(false);
    }
  }, [open, constText]);

  const openMission = useCallback((prefill: MissionDesignForm | null) => {
    if (prefill) {
      setMissionPrefill(prefill);
      setMissionSession((previous) => previous + 1);
    }
    setMissionOpened(true);
    setMode("mission");
  }, []);

  const backToShells = useCallback(() => {
    setMode("shells");
  }, []);

  // Validate on config changes
  useEffect(() => {
    const result = validateConfig(config);
    setErrors(result.errors);
  }, [config]);

  const handleEpochChange = useCallback((epochStr: string) => {
    const date = new Date(epochStr);
    if (!isNaN(date.getTime())) {
      setConfig((prev) => ({ ...prev, epoch: date }));
    }
  }, []);

  const handleAddShell = useCallback(() => {
    const newShell = createNewShell("walker_delta");
    setConfig((prev) => ({
      ...prev,
      shells: [...prev.shells, newShell],
    }));
    setSelectedShellId(newShell.id);
  }, []);

  /**
   * Appends a template/preset/design-candidate shell and selects it. The id is
   * always minted here: adding the same preset twice must not produce two
   * shells sharing a React key (and an ambiguous `handleShellChange` target).
   */
  const handleSelectPreset = useCallback((shell: ConstellationShell) => {
    const added: ConstellationShell = { ...shell, id: crypto.randomUUID() };
    setConfig((prev) => ({ ...prev, shells: [...prev.shells, added] }));
    setSelectedShellId(added.id);
    setMode("shells");
  }, []);

  const handleDeleteShell = useCallback((id: string) => {
    setConfig((prev) => {
      const newShells = prev.shells.filter((s) => s.id !== id);
      return { ...prev, shells: newShells };
    });
    setSelectedShellId((prevId) => {
      if (prevId === id) {
        const idx = config.shells.findIndex((s) => s.id === id);
        const newShells = config.shells.filter((s) => s.id !== id);
        if (newShells.length === 0) return null;
        return newShells[Math.min(idx, newShells.length - 1)]?.id ?? null;
      }
      return prevId;
    });
  }, [config.shells]);

  const handleMoveShell = useCallback((id: string, direction: "up" | "down") => {
    setConfig((prev) => {
      const idx = prev.shells.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.shells.length) return prev;

      const newShells = [...prev.shells];
      [newShells[idx], newShells[newIdx]] = [newShells[newIdx], newShells[idx]];
      return { ...prev, shells: newShells };
    });
  }, []);

  const handleShellChange = useCallback((updates: Partial<ConstellationShell>) => {
    setConfig((prev) => ({
      ...prev,
      shells: prev.shells.map((s) => {
        if (s.id !== selectedShellId) return s;
        const next = { ...s, ...updates };
        // Patterns whose count/planes/altitude are *computed* still have to
        // store them (EditorTab counts `count =`, IslShellRange needs
        // `planes`, validateConfig checks the stored values), so the write-back
        // happens in the same state update as the edit — no effect loop.
        return { ...next, ...syncDerivedFields(next) };
      }),
    }));
  }, [selectedShellId]);

  const handleApply = useCallback(() => {
    const toml = serializeConstellationConfig(config);
    onConstTextChange(toml);
  }, [config, onConstTextChange]);

  const handleOK = useCallback(() => {
    handleApply();
    onClose();
  }, [handleApply, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const selectedShell = config.shells.find((s) => s.id === selectedShellId);
  const selectedShellIndex = config.shells.findIndex((s) => s.id === selectedShellId);
  // Warnings are advisory; only blocking errors disable OK.
  const isValid = errors.filter(isBlockingError).length === 0;

  // Format date for datetime-local input
  const formatDateForInput = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="dark !w-[94vw] !max-w-7xl h-[90dvh] max-h-[90dvh] overflow-hidden max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col max-md:gap-3 bg-surface-solid text-fg"
        onEscapeKeyDown={(event) => {
          // In the wizard, Escape steps back to the shell list rather than
          // discarding the whole editing session.
          if (mode === "mission") {
            event.preventDefault();
            backToShells();
          }
        }}
      >
        <DialogHeader className="max-md:pr-10">
          <DialogTitle className="text-fg flex items-center gap-2">
            {mode === "mission" && (
              <button
                type="button"
                onClick={backToShells}
                aria-label="シェル一覧へ戻る"
                className="p-1 -ml-1 rounded text-fg-muted hover:text-fg hover:bg-sunken max-md:p-2 max-md:-ml-2"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <span>{mode === "mission" ? "ミッションから設計" : "コンステレーション編集"}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted text-left">
            {mode === "mission" ? "目的に合う配置を探し、候補からシェルを作成します。" : "シェルを選んで設定を調整し、自動計算の結果を確認します。"}
          </DialogDescription>
        </DialogHeader>

        {mode === "shells" && (
          <div className="flex items-center gap-4 px-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="constellation-epoch" className="text-xs text-fg-muted whitespace-nowrap">基準時刻 (UTC)</Label>
              <input
                id="constellation-epoch"
                type="datetime-local"
                value={formatDateForInput(config.epoch)}
                onChange={(e) => handleEpochChange(e.target.value + ":00Z")}
                className="w-48 px-2 py-1 text-sm bg-sunken border border-line-strong rounded focus:border-brand focus:outline-none text-fg"
              />
            </div>
          </div>
        )}

        {missionOpened && (
          <div className={mode === "mission" ? "flex flex-1 min-h-0" : "hidden"}>
            <MissionDesignPane
              key={missionSession}
              active={mode === "mission"}
              epochIso={config.epoch.toISOString()}
              initialForm={missionPrefill}
              onAddCandidate={handleSelectPreset}
            />
          </div>
        )}
        {mode === "shells" && (
          <div className="flex-1 border border-line-strong rounded-md overflow-hidden max-md:overflow-y-auto max-md:overscroll-contain flex flex-col md:flex-row min-h-0">
            {/* Shell list: sidebar on desktop, compact select on mobile */}
            <div className="md:w-52 md:flex-shrink-0 bg-surface-solid max-md:shrink-0">
              <ConstellationShellList
                shells={config.shells}
                selectedId={selectedShellId}
                errors={errors}
                onSelect={setSelectedShellId}
                onAdd={handleAddShell}
                onDelete={handleDeleteShell}
                onMoveUp={(id) => handleMoveShell(id, "up")}
                onMoveDown={(id) => handleMoveShell(id, "down")}
                onSelectPreset={handleSelectPreset}
                onOpenMission={() => openMission(null)}
              />
            </div>

            {/* Shell form */}
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden bg-raised max-md:flex-auto max-md:overflow-visible">
              {selectedShell ? (
                <ConstellationShellForm
                  shell={selectedShell}
                  shellIndex={selectedShellIndex}
                  errors={errors}
                  onChange={handleShellChange}
                  onRedesign={(shell) => openMission(constraintsFromShell(shell))}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-fg-muted text-sm p-6 text-center">
                  {config.shells.length === 0
                    ? "「シェル追加」をクリックして最初のシェルを作成してください"
                    : "シェルを選択してください"}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "shells" && (
          <DialogFooter className="border-t border-line pt-3 shrink-0 sm:items-center max-md:flex-row max-md:flex-wrap max-md:gap-2">
            <p className="text-xs text-fg-muted sm:mr-auto max-md:basis-full">
              {isValid ? "保存後、シナリオの「この内容で 3D ビューを更新」で反映します。" : "入力エラーを修正すると保存できます。"}
            </p>
            <Button variant="outline" onClick={handleCancel} className="bg-raised hover:bg-raised-hover text-fg border-line-strong max-md:h-11 max-md:flex-1">
              キャンセル
            </Button>
            <Button
              onClick={handleOK}
              disabled={!isValid}
              className="bg-brand hover:bg-brand-hover text-brand-fg disabled:opacity-50 max-md:h-11 max-md:flex-1"
            >
              編集内容を保存
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
