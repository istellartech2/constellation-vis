import { useCallback, useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { Button } from "./button";
import EditorDialogShell, { EditorDetailPane, EditorDialogFooter, EditorSplitBody } from "./EditorDialogShell";
import EditorItemList, { listAddButtonClass, listAddSelectClass } from "./EditorItemList";
import GroundStationForm from "./GroundStationForm";
import GroundStationMap from "./GroundStationMap";
import {
  parseGroundStationsConfig,
  serializeGroundStations,
  validateGroundStations,
  createNewStation,
  toDraft,
  fromDraft,
  type GroundStationDraft,
} from "../../lib/groundStationSerializer";
import { GROUND_STATION_PRESETS, type GroundStationPreset } from "../../lib/groundStationPresets";

interface Props {
  open: boolean;
  gsText: string;
  /** Saves the edited TOML and applies it to the 3D view. */
  onApply: (text: string) => void;
  onClose: () => void;
}

function formatLatLon(s: GroundStationDraft): string {
  const lat = `${Math.abs(s.latitudeDeg).toFixed(2)}°${s.latitudeDeg >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(s.longitudeDeg).toFixed(2)}°${s.longitudeDeg >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}

export default function GroundStationEditorDialog({
  open,
  gsText,
  onApply,
  onClose,
}: Props) {
  const [stations, setStations] = useState<GroundStationDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const errors = useMemo(() => validateGroundStations(stations), [stations]);

  const [source, setSource] = useState({ open: false, gsText });
  if (source.open !== open || source.gsText !== gsText) {
    setSource({ open, gsText });
    if (open) {
      try {
        const parsed = parseGroundStationsConfig(gsText);
        const drafts = parsed.map(toDraft);
        setStations(drafts);
        setSelectedId(drafts[0]?.id ?? null);
      } catch (err) {
        console.error("Failed to parse groundstations.toml:", err);
        setStations([]);
        setSelectedId(null);
      }
    }
  }

  const handleAdd = useCallback(() => {
    const next = createNewStation(stations.length);
    setStations((prev) => [...prev, next]);
    setSelectedId(next.id);
  }, [stations.length]);

  const handleAddPreset = useCallback(
    (preset: GroundStationPreset) => {
      const existingNames = new Set(stations.map((s) => s.name));
      let name = preset.name;
      let suffix = 2;
      while (existingNames.has(name)) {
        name = `${preset.name} ${suffix}`;
        suffix += 1;
      }
      const next: GroundStationDraft = {
        id: crypto.randomUUID(),
        name,
        latitudeDeg: preset.latitudeDeg,
        longitudeDeg: preset.longitudeDeg,
        heightKm: preset.heightKm,
        minElevationDeg: 20,
      };
      setStations((prev) => [...prev, next]);
      setSelectedId(next.id);
    },
    [stations],
  );

  const handleDelete = useCallback((id: string) => {
    setStations((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      setSelectedId((curr) => {
        if (curr !== id) return curr;
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  const handleMove = useCallback((id: string, direction: "up" | "down") => {
    setStations((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  const handleChange = useCallback(
    (updates: Partial<GroundStationDraft>) => {
      setStations((prev) =>
        prev.map((s) => (s.id === selectedId ? { ...s, ...updates } : s)),
      );
    },
    [selectedId],
  );

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!selectedId) return;
      setStations((prev) =>
        prev.map((s) =>
          s.id === selectedId ? { ...s, latitudeDeg: lat, longitudeDeg: lng } : s,
        ),
      );
    },
    [selectedId],
  );

  const handleApply = useCallback(() => {
    onApply(serializeGroundStations(stations.map(fromDraft)));
    onClose();
  }, [stations, onApply, onClose]);

  const selected = stations.find((s) => s.id === selectedId);
  const selectedIndex = stations.findIndex((s) => s.id === selectedId);

  const addActions = (
    <>
      <Button variant="outline" size="sm" onClick={handleAdd} className={listAddButtonClass}>
        <Plus className="h-4 w-4" />
        新しい地上局
      </Button>
      <select
        value=""
        aria-label="プリセットから地上局を追加"
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          const [groupIdx, presetIdx] = value.split(":").map(Number);
          const preset = GROUND_STATION_PRESETS[groupIdx]?.presets[presetIdx];
          if (preset) handleAddPreset(preset);
          e.target.value = "";
        }}
        className={listAddSelectClass}
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
    </>
  );

  return (
    <EditorDialogShell
      open={open}
      onClose={onClose}
      icon={<MapPin />}
      title="地上局"
      description="一覧から地上局を選んで位置と可視条件を編集します。地図をクリックすると選択中の地上局を移動できます。"
      footer={<EditorDialogFooter errors={errors.map((e) => e.message)} onCancel={onClose} onApply={handleApply} />}
    >
      <EditorSplitBody
        list={
          <EditorItemList
            noun="地上局"
            items={stations.map((s) => ({
              id: s.id,
              title: s.name || "(無名)",
              subtitle: `${formatLatLon(s)} · 最低仰角 ${s.minElevationDeg}°`,
              issue: errors.some((e) => e.stationId === s.id) ? "error" : undefined,
            }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={handleMove}
            onDelete={handleDelete}
            addActions={addActions}
          />
        }
      >
        <EditorDetailPane
          title={selected ? selected.name || "(無名)" : null}
          summary={selected ? `${formatLatLon(selected)} · 高度 ${selected.heightKm} km` : undefined}
          emptyText={stations.length === 0 ? "「新しい地上局」かプリセットから最初の地上局を追加してください" : "一覧から地上局を選択してください"}
          scroll={false}
        >
          {selected && (
            <>
              <div className="shrink-0 md:max-h-[45%] md:overflow-y-auto border-b border-line-strong">
                <GroundStationForm station={selected} index={selectedIndex} errors={errors} onChange={handleChange} />
              </div>
              <div className="relative min-h-[280px] flex-1 max-md:h-[280px] max-md:flex-none">
                <div className="pointer-events-none absolute top-2 left-14 z-[1000] rounded bg-sunken px-2 py-1 text-xs text-fg max-md:right-2">
                  地図クリックで「{selected.name || "(無名)"}」の位置を移動
                </div>
                <GroundStationMap stations={stations} selectedId={selectedId} onMapClick={handleMapClick} onSelect={setSelectedId} />
              </div>
            </>
          )}
        </EditorDetailPane>
      </EditorSplitBody>
    </EditorDialogShell>
  );
}
