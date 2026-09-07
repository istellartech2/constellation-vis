import { Plus, Trash2, ChevronUp, ChevronDown, ArrowUp, ArrowDown, Wand2 } from "lucide-react";
import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import { getShellDisplayName, isBlockingError } from "../../lib/constellationSerializer";
import { computeShellDerived, type ShellDerived } from "../../lib/constellationPatterns";
import { Button } from "./button";
import PatternBadge from "./PatternBadge";
import ConstellationTemplateMenu from "./ConstellationTemplateMenu";

interface Props {
  shells: ConstellationShell[];
  selectedId: string | null;
  errors: ValidationError[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onSelectPreset?: (shell: ConstellationShell, note?: string) => void;
  onOpenMission?: () => void;
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

export default function ConstellationShellList({
  shells,
  selectedId,
  errors,
  onSelect,
  onAdd,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSelectPreset,
  onOpenMission,
}: Props) {
  const shellErrors = (shellId: string): ValidationError[] => {
    const shellIndex = shells.findIndex((s) => s.id === shellId);
    return errors.filter(
      (err) => err.field === `shell.${shellIndex}` || err.field.startsWith(`shell.${shellIndex}.`),
    );
  };

  const selectedIndex = shells.findIndex((s) => s.id === selectedId);
  const showTemplateTools = Boolean(onSelectPreset || onOpenMission);

  const addTools = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
      >
        <Plus className="h-4 w-4" />
        <span>シェル追加</span>
      </Button>
      {showTemplateTools && (
        <>
          {onSelectPreset && <ConstellationTemplateMenu onSelect={onSelectPreset} />}
          {onOpenMission && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenMission}
              className="w-full flex items-center justify-center gap-1 border-amber-700/60 text-amber-200 hover:bg-amber-900/30"
            >
              <Wand2 className="h-4 w-4" />
              <span>✨ ミッションから設計</span>
            </Button>
          )}
        </>
      )}
    </>
  );

  const moveDeleteButtons = (id: string, index: number) => (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onMoveUp(id)}
        disabled={index <= 0}
        className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
        title="上へ移動"
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onMoveDown(id)}
        disabled={index >= shells.length - 1}
        className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
        title="下へ移動"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onDelete(id)}
        className="h-8 w-8 bg-gray-800 hover:bg-red-700 text-gray-100 hover:text-white border-gray-600 hover:border-red-600"
        title="削除"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );

  return (
    <>
      {/* Desktop / tablet: full vertical list */}
      <div className="hidden md:flex md:flex-col h-full border-r border-gray-600">
        <div className="p-2 border-b border-gray-600 space-y-1.5">{addTools}</div>

        <div className="flex-1 overflow-y-auto">
          {shells.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              シェルがありません
            </div>
          ) : (
            <ul className="divide-y divide-gray-700">
              {shells.map((shell, index) => {
                const errs = shellErrors(shell.id);
                const hasError = errs.length > 0;
                const isBlocking = errs.some(isBlockingError);
                return (
                  <li
                    key={shell.id}
                    onClick={() => onSelect(shell.id)}
                    className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                      shell.id === selectedId
                        ? "bg-amber-900/40 text-amber-50"
                        : "hover:bg-gray-800 text-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {hasError && (
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            isBlocking ? "bg-red-500" : "bg-amber-500"
                          }`}
                        />
                      )}
                      <span className="truncate flex-1">
                        {getShellDisplayName(shell, index)}
                      </span>
                      <PatternBadge pattern={shell.pattern} />
                    </div>
                    <div className="text-[11px] text-gray-400 truncate mt-0.5">
                      {shellSummary(shell)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId && (
          <div className="p-2 border-t border-gray-600 flex gap-1 justify-center">
            {moveDeleteButtons(selectedId, selectedIndex)}
          </div>
        )}
      </div>

      {/* Mobile: compact select + icon row */}
      <div className="md:hidden flex flex-col gap-2 p-2 border-b border-gray-600">
        <select
          value={selectedId ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-amber-500 focus:outline-none"
        >
          {shells.length === 0 ? (
            <option value="">シェルがありません</option>
          ) : (
            shells.map((shell, index) => (
              <option key={shell.id} value={shell.id}>
                {getShellDisplayName(shell, index)}
              </option>
            ))
          )}
        </select>

        <div className="flex gap-1 justify-center">
          <Button
            variant="outline"
            size="icon"
            onClick={onAdd}
            className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
            title="シェル追加"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => selectedId && onMoveUp(selectedId)}
            disabled={!selectedId || selectedIndex <= 0}
            className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
            title="上へ移動"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => selectedId && onMoveDown(selectedId)}
            disabled={!selectedId || selectedIndex >= shells.length - 1}
            className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
            title="下へ移動"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => selectedId && onDelete(selectedId)}
            disabled={!selectedId}
            className="h-8 w-8 bg-gray-800 hover:bg-red-700 text-gray-100 hover:text-white border-gray-600 hover:border-red-600 disabled:opacity-40"
            title="削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {showTemplateTools && (
          <div className="flex flex-col gap-1.5">
            {onSelectPreset && <ConstellationTemplateMenu onSelect={onSelectPreset} />}
            {onOpenMission && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenMission}
                className="w-full flex items-center justify-center gap-1 border-amber-700/60 text-amber-200 hover:bg-amber-900/30"
              >
                <Wand2 className="h-4 w-4" />
                <span>✨ ミッションから設計</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
