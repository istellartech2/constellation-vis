import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, Layers, Plus, Wand2 } from "lucide-react";
import { Button } from "./button";
import { Label } from "./label";
import EditorDialogShell, { EditorDetailPane, EditorDialogFooter, EditorSplitBody } from "./EditorDialogShell";
import EditorItemList, { listAddButtonClass } from "./EditorItemList";
import PatternBadge from "./PatternBadge";
import ConstellationTemplateMenu from "./ConstellationTemplateMenu";
import type { ConstellationConfig, ConstellationShell } from "../../lib/constellationTypes";
import { createNewShell, createDefaultConfig } from "../../lib/constellationTypes";
import { syncDerivedFields } from "../../lib/constellationPatterns/migrate";
import {
  getShellDisplayName,
  isBlockingError,
  parseConstellationConfig,
  serializeConstellationConfig,
  validateConfig,
} from "../../lib/constellationSerializer";
import ConstellationShellForm from "./ConstellationShellForm";
import MissionDesignPane from "./MissionDesignPane";
import { constraintsFromShell, type MissionDesignForm } from "../../lib/missionDesignForm";
import { computeShellDerived, type ShellDerived } from "../../lib/constellationPatterns";

interface Props {
  open: boolean;
  constText: string;
  /** Saves the edited TOML and applies it to the 3D view. */
  onApply: (text: string) => void;
  onClose: () => void;
}

/** `F=`/`S=`/`Nc=` readout per pattern family, exhaustive over `ShellDerived`. */
function sizeLabel(derived: ShellDerived): string {
  switch (derived.pattern) {
    case "walker_delta":
    case "walker_star":
      return `F=${derived.phasing}`;
    case "streets_of_coverage":
      return `S=${derived.design.satsPerPlane}`;
    case "flower":
      return `Nc=${derived.harmonicNc ?? "-"}`;
    case "lattice_flower":
    case "necklace_flower":
      return `Nc=${derived.nc}`;
  }
}

function shellSummary(shell: ConstellationShell): string {
  try {
    const derived = computeShellDerived(shell);
    const alt = Math.round(derived.apogeeAltitudeKm);
    const inc = Number(derived.inclinationDeg.toFixed(1));
    return `${derived.totalSats}機 / ${derived.planes}面 / ${sizeLabel(derived)} · ${alt}km · ${inc}°`;
  } catch {
    return `${shell.count}機 / ${shell.planes}面`;
  }
}

/** Which pane fills the dialog body. */
type Mode = "shells" | "mission";

export default function ConstellationEditorDialog({
  open,
  constText,
  onApply,
  onClose,
}: Props) {
  const [config, setConfig] = useState<ConstellationConfig>(createDefaultConfig());
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null);
  const errors = useMemo(() => validateConfig(config).errors, [config]);
  const [mode, setMode] = useState<Mode>("shells");
  /** Constraints handed to the wizard by 「設計をやり直す」; null = wizard defaults. */
  const [missionPrefill, setMissionPrefill] = useState<MissionDesignForm | null>(null);
  const [missionOpened, setMissionOpened] = useState(false);
  const [missionSession, setMissionSession] = useState(0);

  // Initialize config when dialog opens
  const [source, setSource] = useState({ open: false, constText });
  if (source.open !== open || source.constText !== constText) {
    setSource({ open, constText });
    if (open) {
      const parsed = parseConstellationConfig(constText);
      setConfig(parsed);
      setSelectedShellId(parsed.shells[0]?.id ?? null);
      setMode("shells");
      setMissionPrefill(null);
      setMissionOpened(false);
    }
  }

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
    onApply(serializeConstellationConfig(config));
    onClose();
  }, [config, onApply, onClose]);

  const selectedShell = config.shells.find((s) => s.id === selectedShellId);
  const selectedShellIndex = config.shells.findIndex((s) => s.id === selectedShellId);
  // Warnings are advisory; only blocking errors disable saving.
  const blockingErrors = errors.filter(isBlockingError);
  const shellIssue = (index: number): "error" | "warning" | undefined => {
    const own = errors.filter((err) => err.field === `shell.${index}` || err.field.startsWith(`shell.${index}.`));
    if (own.length === 0) return undefined;
    return own.some(isBlockingError) ? "error" : "warning";
  };

  // Format date for datetime-local input
  const formatDateForInput = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  const addActions = (
    <>
      <Button variant="outline" size="sm" onClick={handleAddShell} className={listAddButtonClass}>
        <Plus className="h-4 w-4" />
        新しいシェル
      </Button>
      <ConstellationTemplateMenu onSelect={handleSelectPreset} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => openMission(null)}
        className={`${listAddButtonClass} border-brand text-brand-text hover:text-fg`}
      >
        <Wand2 className="h-4 w-4" />
        ミッションから設計
      </Button>
    </>
  );

  return (
    <EditorDialogShell
      open={open}
      onClose={onClose}
      icon={<Layers />}
      title={mode === "mission" ? "ミッションから設計" : "コンステレーション"}
      description={mode === "mission" ? "目的に合う配置を探し、候補からシェルを作成します。" : "一覧からシェルを選んで設定を調整し、右側の計算結果を確認します。"}
      leading={mode === "mission" && (
        <button
          type="button"
          onClick={backToShells}
          aria-label="シェル一覧へ戻る"
          className="p-1 -ml-1 rounded text-fg-muted hover:text-fg hover:bg-sunken max-md:p-2 max-md:-ml-2"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      onEscapeKeyDown={(event) => {
        // In the wizard, Escape steps back to the shell list rather than
        // discarding the whole editing session.
        if (mode === "mission") {
          event.preventDefault();
          backToShells();
        }
      }}
      footer={mode === "shells" && (
        <EditorDialogFooter errors={blockingErrors.map((e) => e.message)} onCancel={onClose} onApply={handleApply} />
      )}
    >
      {mode === "shells" && (
        <div className="flex items-center gap-2 px-1">
          <Label htmlFor="constellation-epoch" className="text-xs text-fg-muted whitespace-nowrap">全シェル共通の基準時刻 (UTC)</Label>
          <input
            id="constellation-epoch"
            type="datetime-local"
            value={formatDateForInput(config.epoch)}
            onChange={(e) => handleEpochChange(e.target.value + ":00Z")}
            className="w-48 px-2 py-1 text-sm bg-sunken border border-line-strong rounded focus:border-brand focus:outline-none text-fg"
          />
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
        <EditorSplitBody
          list={
            <EditorItemList
              noun="シェル"
              items={config.shells.map((shell, index) => ({
                id: shell.id,
                title: getShellDisplayName(shell, index),
                subtitle: shellSummary(shell),
                badge: <PatternBadge pattern={shell.pattern} />,
                issue: shellIssue(index),
              }))}
              selectedId={selectedShellId}
              onSelect={setSelectedShellId}
              onMove={handleMoveShell}
              onDelete={handleDeleteShell}
              addActions={addActions}
            />
          }
        >
          <EditorDetailPane
            title={selectedShell ? getShellDisplayName(selectedShell, selectedShellIndex) : null}
            badge={selectedShell && <PatternBadge pattern={selectedShell.pattern} />}
            summary={selectedShell && shellSummary(selectedShell)}
            emptyText={config.shells.length === 0
              ? "「新しいシェル」・テンプレート・ミッションから設計のいずれかで最初のシェルを追加してください"
              : "一覧からシェルを選択してください"}
            scroll={false}
          >
            {selectedShell && (
              <ConstellationShellForm
                shell={selectedShell}
                shellIndex={selectedShellIndex}
                errors={errors}
                onChange={handleShellChange}
                onRedesign={(shell) => openMission(constraintsFromShell(shell))}
              />
            )}
          </EditorDetailPane>
        </EditorSplitBody>
      )}
    </EditorDialogShell>
  );
}
