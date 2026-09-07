import { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
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

  // Initialize config when dialog opens
  useEffect(() => {
    if (open) {
      const parsed = parseConstellationConfig(constText);
      setConfig(parsed);
      setSelectedShellId(parsed.shells[0]?.id ?? null);
      setErrors([]);
      setMode("shells");
      setMissionPrefill(null);
    }
  }, [open, constText]);

  const openMission = useCallback((prefill: MissionDesignForm | null) => {
    setMissionPrefill(prefill);
    setMode("mission");
  }, []);

  const backToShells = useCallback(() => {
    setMode("shells");
    setMissionPrefill(null);
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
    setMissionPrefill(null);
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
        className={`!w-[90vw] !max-w-6xl max-h-[85vh] overflow-hidden flex flex-col bg-gray-900 text-gray-100 max-md:!w-screen max-md:!max-w-none max-md:h-[100dvh] max-md:!max-h-none max-md:rounded-none${
          // The wizard's results column has to fill the dialog, and `flex-1`
          // cannot grow inside a box whose height is only bounded by `max-h`.
          mode === "mission" ? " md:h-[85vh]" : ""
        }`}
        onEscapeKeyDown={(event) => {
          // In the wizard, Escape steps back to the shell list rather than
          // discarding the whole editing session.
          if (mode === "mission") {
            event.preventDefault();
            backToShells();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-gray-100 flex items-center gap-2">
            {mode === "mission" && (
              <button
                type="button"
                onClick={backToShells}
                aria-label="シェル一覧へ戻る"
                className="p-1 -ml-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <span>{mode === "mission" ? "ミッションから設計" : "コンステレーション編集"}</span>
          </DialogTitle>
        </DialogHeader>

        {mode === "shells" && (
          <div className="flex items-center gap-4 px-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-400 whitespace-nowrap">エポック:</Label>
              <input
                type="datetime-local"
                value={formatDateForInput(config.epoch)}
                onChange={(e) => handleEpochChange(e.target.value + ":00Z")}
                className="w-48 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
              />
            </div>
          </div>
        )}

        {mode === "mission" ? (
          <MissionDesignPane
            epochIso={config.epoch.toISOString()}
            initialForm={missionPrefill}
            onAddCandidate={handleSelectPreset}
          />
        ) : (
          <div className="flex-1 border border-gray-600 rounded-md overflow-hidden flex flex-col md:flex-row min-h-0">
            {/* Shell list: sidebar on desktop, compact select on mobile */}
            <div className="md:w-56 md:flex-shrink-0 bg-gray-900">
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
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-850">
              {selectedShell ? (
                <ConstellationShellForm
                  shell={selectedShell}
                  shellIndex={selectedShellIndex}
                  errors={errors}
                  onChange={handleShellChange}
                  onRedesign={(shell) => openMission(constraintsFromShell(shell))}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm p-6 text-center">
                  {config.shells.length === 0
                    ? "「シェル追加」をクリックして最初のシェルを作成してください"
                    : "シェルを選択してください"}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "shells" && (
          <DialogFooter className="border-t border-gray-700 pt-3">
            <Button variant="outline" onClick={handleCancel} className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500">
              キャンセル
            </Button>
            <Button
              onClick={handleOK}
              disabled={!isValid}
              className="bg-amber-600 hover:bg-amber-700 text-amber-50 disabled:opacity-50"
            >
              OK
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
