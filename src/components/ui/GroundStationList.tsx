import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type {
  GroundStationDraft,
  GroundStationValidationError,
} from "../../lib/groundStationSerializer";
import {
  GROUND_STATION_PRESETS,
  type GroundStationPreset,
} from "../../lib/groundStationPresets";
import { Button } from "./button";

interface Props {
  stations: GroundStationDraft[];
  selectedId: string | null;
  errors: GroundStationValidationError[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onAddPreset: (preset: GroundStationPreset) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export default function GroundStationList({
  stations,
  selectedId,
  errors,
  onSelect,
  onAdd,
  onAddPreset,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {
  const hasError = (id: string): boolean => errors.some((e) => e.stationId === id);
  const selectedIndex = stations.findIndex((s) => s.id === selectedId);

  return (
    <div className="flex flex-col h-full border-r border-gray-600">
      <div className="p-2 border-b border-gray-600 space-y-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
        >
          <Plus className="h-4 w-4" />
          <span>地上局追加</span>
        </Button>
        <select
          value=""
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            const [groupIdx, presetIdx] = value.split(":").map(Number);
            const preset = GROUND_STATION_PRESETS[groupIdx]?.presets[presetIdx];
            if (preset) onAddPreset(preset);
            e.target.value = "";
          }}
          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-amber-500 focus:outline-none"
        >
          <option value="">プリセットから追加...</option>
          {GROUND_STATION_PRESETS.map((group, gi) => (
            <optgroup key={group.label} label={group.label}>
              {group.presets.map((p, pi) => (
                <option key={p.name} value={`${gi}:${pi}`}>
                  {p.labelJa}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {stations.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            地上局がありません
          </div>
        ) : (
          <ul className="divide-y divide-gray-700">
            {stations.map((s) => (
              <li
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                  s.id === selectedId
                    ? "bg-amber-900/40 text-amber-50"
                    : "hover:bg-gray-800 text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  {hasError(s.id) && (
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  )}
                  <span className="truncate flex-1">{s.name || "(無名)"}</span>
                  <span className="text-xs text-gray-400">
                    {s.latitudeDeg.toFixed(2)}, {s.longitudeDeg.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
            disabled={selectedIndex >= stations.length - 1}
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
