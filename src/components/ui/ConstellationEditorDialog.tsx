import { useState, useEffect, useCallback } from "react";
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
import {
  parseConstellationConfig,
  serializeConstellationConfig,
  validateConfig,
  type ValidationError,
} from "../../lib/constellationSerializer";
import ConstellationShellList from "./ConstellationShellList";
import ConstellationShellForm from "./ConstellationShellForm";

interface Props {
  open: boolean;
  constText: string;
  onConstTextChange: (text: string) => void;
  onClose: () => void;
}

export default function ConstellationEditorDialog({
  open,
  constText,
  onConstTextChange,
  onClose,
}: Props) {
  const [config, setConfig] = useState<ConstellationConfig>(createDefaultConfig());
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);

  // Initialize config when dialog opens
  useEffect(() => {
    if (open) {
      const parsed = parseConstellationConfig(constText);
      setConfig(parsed);
      setSelectedShellId(parsed.shells[0]?.id ?? null);
      setErrors([]);
    }
  }, [open, constText]);

  // Validate on config changes
  useEffect(() => {
    const result = validateConfig(config);
    setErrors(result.errors);
  }, [config]);

  const handleNameChange = useCallback((name: string) => {
    setConfig((prev) => ({ ...prev, name }));
  }, []);

  const handleEpochChange = useCallback((epochStr: string) => {
    const date = new Date(epochStr);
    if (!isNaN(date.getTime())) {
      setConfig((prev) => ({ ...prev, epoch: date }));
    }
  }, []);

  const handleAddShell = useCallback(() => {
    const newShell = createNewShell();
    setConfig((prev) => ({
      ...prev,
      shells: [...prev.shells, newShell],
    }));
    setSelectedShellId(newShell.id);
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
      shells: prev.shells.map((s) =>
        s.id === selectedShellId ? { ...s, ...updates } : s
      ),
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
  const isValid = errors.length === 0;

  // Format date for datetime-local input
  const formatDateForInput = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="!w-[90vw] !max-w-6xl max-h-[85vh] overflow-hidden flex flex-col bg-gray-900 text-gray-100">
        <DialogHeader>
          <DialogTitle className="text-gray-100">コンステレーション編集</DialogTitle>
        </DialogHeader>

        {/* Constellation Meta Section - Compact */}
        <div className="flex items-center gap-4 px-1">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400 whitespace-nowrap">名前:</Label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="コンステレーション名"
              className={`w-48 px-2 py-1 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
                errors.some((e) => e.field === "name")
                  ? "border-red-500"
                  : "border-gray-600 focus:border-amber-500"
              }`}
            />
          </div>
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

        {/* Shells Section */}
        <div className="flex-1 border border-gray-600 rounded-md overflow-hidden flex min-h-0">
          {/* Left panel: Shell list */}
          <div className="w-56 flex-shrink-0 bg-gray-900">
            <ConstellationShellList
              shells={config.shells}
              selectedId={selectedShellId}
              errors={errors}
              onSelect={setSelectedShellId}
              onAdd={handleAddShell}
              onDelete={handleDeleteShell}
              onMoveUp={(id) => handleMoveShell(id, "up")}
              onMoveDown={(id) => handleMoveShell(id, "down")}
            />
          </div>

          {/* Right panel: Shell form */}
          <div className="flex-1 overflow-y-auto bg-gray-850">
            {selectedShell ? (
              <ConstellationShellForm
                shell={selectedShell}
                errors={errors}
                onChange={handleShellChange}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {config.shells.length === 0
                  ? "「シェル追加」をクリックして最初のシェルを作成してください"
                  : "シェルを選択してください"}
              </div>
            )}
          </div>
        </div>

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
      </DialogContent>
    </Dialog>
  );
}
