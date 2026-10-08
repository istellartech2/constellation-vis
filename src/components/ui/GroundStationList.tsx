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
    <div className="flex flex-col h-full border-r border-line-strong">
      <div className="p-2 border-b border-line-strong space-y-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-1 bg-sunken hover:bg-raised-hover text-fg border-line-strong"
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
          className="w-full px-2 py-1 text-xs bg-sunken border border-line-strong rounded text-fg focus:border-brand focus:outline-none"
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
          <div className="p-4 text-center text-fg-subtle text-sm">
            地上局がありません
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {stations.map((s) => (
              <li
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                  s.id === selectedId
                    ? "bg-brand-soft text-fg"
                    : "hover:bg-sunken text-fg"
                }`}
              >
                <div className="flex items-center gap-2">
                  {hasError(s.id) && (
                    <span className="w-2 h-2 rounded-full bg-danger flex-shrink-0" />
                  )}
                  <span className="truncate flex-1">{s.name || "(無名)"}</span>
                  <span className="text-xs text-fg-muted">
                    {s.latitudeDeg.toFixed(2)}, {s.longitudeDeg.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId && (
        <div className="p-2 border-t border-line-strong flex gap-1 justify-center">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMoveUp(selectedId)}
            disabled={selectedIndex <= 0}
            className="h-8 w-8 bg-sunken hover:bg-raised-hover text-fg border-line-strong disabled:opacity-40"
            title="上へ移動"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMoveDown(selectedId)}
            disabled={selectedIndex >= stations.length - 1}
            className="h-8 w-8 bg-sunken hover:bg-raised-hover text-fg border-line-strong disabled:opacity-40"
            title="下へ移動"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onDelete(selectedId)}
            className="h-8 w-8 bg-sunken hover:bg-danger text-fg hover:text-fg border-line-strong hover:border-danger"
            title="削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
