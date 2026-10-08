import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";
import GroundStationList from "./GroundStationList";
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
  type GroundStationValidationError,
} from "../../lib/groundStationSerializer";
import type { GroundStationPreset } from "../../lib/groundStationPresets";

interface Props {
  open: boolean;
  gsText: string;
  onGsTextChange: (text: string) => void;
  onClose: () => void;
}

export default function GroundStationEditorDialog({
  open,
  gsText,
  onGsTextChange,
  onClose,
}: Props) {
  const [stations, setStations] = useState<GroundStationDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<GroundStationValidationError[]>([]);

  useEffect(() => {
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
      setErrors([]);
    }
  }, [open, gsText]);

  useEffect(() => {
    setErrors(validateGroundStations(stations));
  }, [stations]);

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

  const handleOK = useCallback(() => {
    const toml = serializeGroundStations(stations.map(fromDraft));
    onGsTextChange(toml);
    onClose();
  }, [stations, onGsTextChange, onClose]);

  const selected = stations.find((s) => s.id === selectedId);
  const selectedIndex = stations.findIndex((s) => s.id === selectedId);
  const isValid = errors.length === 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="!w-[90vw] !max-w-6xl max-h-[85vh] overflow-hidden max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col max-md:gap-3 bg-surface-solid text-fg">
        <DialogHeader className="max-md:pr-10">
          <DialogTitle className="text-fg max-md:text-left">地上局編集</DialogTitle>
        </DialogHeader>

        <div className="flex-1 border border-line-strong rounded-md overflow-hidden max-md:overflow-y-auto max-md:overscroll-contain flex flex-col md:flex-row min-h-0">
          <div className="md:w-56 flex-shrink-0 bg-surface-solid">
            <GroundStationList
              stations={stations}
              selectedId={selectedId}
              errors={errors}
              onSelect={setSelectedId}
              onAdd={handleAdd}
              onAddPreset={handleAddPreset}
              onDelete={handleDelete}
              onMoveUp={(id) => handleMove(id, "up")}
              onMoveDown={(id) => handleMove(id, "down")}
            />
          </div>

          <div className="flex-1 flex flex-col min-w-0 max-md:flex-none">
            <div className="flex-shrink-0 md:max-h-[45%] md:overflow-y-auto bg-sunken border-b border-line-strong">
              {selected ? (
                <GroundStationForm
                  station={selected}
                  index={selectedIndex}
                  errors={errors}
                  onChange={handleChange}
                />
              ) : (
                <div className="h-32 flex items-center justify-center text-fg-muted text-sm">
                  {stations.length === 0
                    ? "「地上局追加」をクリックして最初の地上局を作成してください"
                    : "地上局を選択してください"}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-[280px] relative max-md:flex-none max-md:h-[280px]">
              <div className="absolute top-2 left-2 max-md:left-14 max-md:right-2 z-[1000] bg-sunken text-xs text-fg px-2 py-1 rounded pointer-events-none">
                {selected
                  ? "地図クリックで選択中の地上局の座標を上書き"
                  : "地上局を選択してください"}
              </div>
              <GroundStationMap
                stations={stations}
                selectedId={selectedId}
                onMapClick={handleMapClick}
                onSelect={setSelectedId}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-line pt-3 shrink-0 max-md:flex-row max-md:gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-raised hover:bg-raised-hover text-fg border-line-strong max-md:h-11 max-md:flex-1"
          >
            キャンセル
          </Button>
          <Button
            onClick={handleOK}
            disabled={!isValid}
            className="bg-brand hover:bg-brand-hover text-brand-fg disabled:opacity-50 max-md:h-11 max-md:flex-1"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
