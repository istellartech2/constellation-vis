import { useMemo, useRef, useState } from "react";
import { Button } from "./button";
import {
  Save,
  FolderOpen,
  Globe,
  Satellite,
  Layers,
  MapPin,
  RefreshCw,
  Trash2,
  Pencil,
  Clock,
  FileCog,
} from "lucide-react";
import ConstellationEditorDialog from "./ConstellationEditorDialog";
import SatelliteTomlEditorDialog from "./SatelliteTomlEditorDialog";
import GroundStationEditorDialog from "./GroundStationEditorDialog";
import PanelSection from "./PanelSection";
import EntryButton from "./EntryButton";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startText: string;
  onSatTextChange: (text: string) => void;
  onConstTextChange: (text: string) => void;
  onGsTextChange: (text: string) => void;
  onStartTextChange: (text: string) => void;
  onImportClick: () => void;
  onUpdate: () => void;
  onSaveBundle: () => void;
  onLoadBundle: (file: File) => void;
}

// Cheap counters that scan the TOML text directly. We avoid the full parser
// here because the editor re-renders on every keystroke / import, and 10k+
// satellite lists make a real parse noticeable.
function countTomlSections(text: string, marker: string): number {
  if (!text) return 0;
  const re = new RegExp(`^\\s*\\[\\[${marker}\\]\\]`, "gm");
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

function countConstellationSatellites(text: string): number {
  if (!text) return 0;
  const re = /^\s*count\s*=\s*(\d+)/gm;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) total += parseInt(m[1], 10);
  return total;
}

function CountBadge({ value }: { value: number }) {
  return (
    <span className="text-[11px] font-medium text-orange-200 bg-orange-900/50 border border-orange-700 rounded-full px-2 py-0.5 leading-none">
      {value} 件
    </span>
  );
}

export default function EditorTab({
  satText,
  constText,
  gsText,
  startText,
  onSatTextChange,
  onConstTextChange,
  onGsTextChange,
  onStartTextChange,
  onImportClick,
  onUpdate,
  onSaveBundle,
  onLoadBundle,
}: Props) {
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [constEditorOpen, setConstEditorOpen] = useState(false);
  const [satEditorOpen, setSatEditorOpen] = useState(false);
  const [gsEditorOpen, setGsEditorOpen] = useState(false);

  const satCount = useMemo(
    () => countTomlSections(satText, "satellites"),
    [satText],
  );
  const constCount = useMemo(
    () => countConstellationSatellites(constText),
    [constText],
  );
  const gsCount = useMemo(
    () => countTomlSections(gsText, "groundstations"),
    [gsText],
  );

  const handleClearAll = () => {
    if (
      window.confirm(
        "衛星・コンステレーション・地上局のデータをすべて削除します。よろしいですか？",
      )
    ) {
      onSatTextChange("");
      onConstTextChange("");
      onGsTextChange("");
    }
  };

  const clearAllAction = (
    <button
      type="button"
      onClick={handleClearAll}
      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-300 transition-colors px-1.5 py-0.5 rounded"
      title="衛星・コンステレーション・地上局をすべて削除"
    >
      <Trash2 className="h-3 w-3" />
      すべて削除
    </button>
  );

  return (
    <>
      <PanelSection title="シミュレーション対象" icon={<Pencil />} action={clearAllAction}>
        <EntryButton
          icon={<Satellite className="h-4 w-4" />}
          title="衛星"
          onClick={() => setSatEditorOpen(true)}
          badge={<CountBadge value={satCount} />}
        />
        <EntryButton
          icon={<Layers className="h-4 w-4" />}
          title="コンステレーション"
          onClick={() => setConstEditorOpen(true)}
          badge={<CountBadge value={constCount} />}
        />
        <EntryButton
          icon={<MapPin className="h-4 w-4" />}
          title="地上局"
          onClick={() => setGsEditorOpen(true)}
          badge={<CountBadge value={gsCount} />}
        />
        <Button
          variant="outline"
          className="w-full h-9 gap-2 bg-gray-700 hover:bg-gray-600 border-2 border-gray-500 hover:border-orange-400 text-white"
          onClick={onImportClick}
        >
          <Globe className="h-4 w-4" />
          CelesTrak からインポート
        </Button>
      </PanelSection>

      <PanelSection title="開始時刻" icon={<Clock />}>
        <input
          type="datetime-local"
          value={startText}
          onChange={(e) => onStartTextChange(e.target.value)}
          className="w-full text-sm bg-gray-800 border-2 border-gray-500 text-gray-100 rounded px-2 py-1 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 outline-none"
        />
        <p className="text-[11px] text-gray-400">UTC で指定します</p>
      </PanelSection>

      <PanelSection title="設定ファイル" icon={<FileCog />}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="w-full h-9 gap-2 bg-gray-700 border-2 border-gray-500 text-white hover:bg-gray-600 hover:border-orange-400 font-medium"
            onClick={onSaveBundle}
          >
            <Save className="h-4 w-4" />
            保存
          </Button>
          <Button
            variant="outline"
            className="w-full h-9 gap-2 bg-gray-700 border-2 border-gray-500 text-white hover:bg-gray-600 hover:border-orange-400 font-medium"
            onClick={() => bundleInputRef.current?.click()}
          >
            <FolderOpen className="h-4 w-4" />
            読み込み
          </Button>
          <input
            ref={bundleInputRef}
            type="file"
            accept=".toml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLoadBundle(f);
              e.target.value = "";
            }}
          />
        </div>
      </PanelSection>

      <Button
        onClick={onUpdate}
        className="w-full font-semibold bg-amber-600 border border-amber-500 hover:bg-amber-700 hover:border-amber-600 text-amber-50 shadow-sm transition-all duration-200 text-sm h-9 rounded-md gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        この内容で 3D ビューを更新
      </Button>

      <ConstellationEditorDialog
        open={constEditorOpen}
        constText={constText}
        onConstTextChange={onConstTextChange}
        onClose={() => setConstEditorOpen(false)}
      />
      <SatelliteTomlEditorDialog
        open={satEditorOpen}
        satText={satText}
        onSatTextChange={onSatTextChange}
        onClose={() => setSatEditorOpen(false)}
      />
      <GroundStationEditorDialog
        open={gsEditorOpen}
        gsText={gsText}
        onGsTextChange={onGsTextChange}
        onClose={() => setGsEditorOpen(false)}
      />
    </>
  );
}
