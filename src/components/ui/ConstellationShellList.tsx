import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import { getShellDisplayName } from "../../lib/constellationSerializer";
import { Button } from "./button";

interface Props {
  shells: ConstellationShell[];
  selectedId: string | null;
  errors: ValidationError[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
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
}: Props) {
  const hasShellError = (shellId: string): boolean => {
    const shellIndex = shells.findIndex((s) => s.id === shellId);
    return errors.some((err) => err.field.startsWith(`shell.${shellIndex}.`));
  };

  const selectedIndex = shells.findIndex((s) => s.id === selectedId);

  return (
    <div className="flex flex-col h-full border-r border-gray-600">
      {/* Header with Add button */}
      <div className="p-2 border-b border-gray-600">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
        >
          <Plus className="h-4 w-4" />
          <span>シェル追加</span>
        </Button>
      </div>

      {/* Shell list */}
      <div className="flex-1 overflow-y-auto">
        {shells.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            シェルがありません
          </div>
        ) : (
          <ul className="divide-y divide-gray-700">
            {shells.map((shell, index) => (
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
                  {hasShellError(shell.id) && (
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  )}
                  <span className="truncate flex-1">
                    {getShellDisplayName(shell, index)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {shell.count}衛星
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Action buttons */}
      {selectedId && (
        <div className="p-2 border-t border-gray-600 flex gap-1 justify-center">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMoveUp(selectedId)}
            disabled={selectedIndex <= 0}
            className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
            title="上へ移動"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMoveDown(selectedId)}
            disabled={selectedIndex >= shells.length - 1}
            className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
            title="下へ移動"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onDelete(selectedId)}
            className="h-8 w-8 bg-gray-800 hover:bg-red-700 text-gray-100 hover:text-white border-gray-600 hover:border-red-600"
            title="削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
