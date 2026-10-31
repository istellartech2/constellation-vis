import { useMemo, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "../../lib/utils";
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
  Check,
  Plus,
  Database,
  ChevronRight,
} from "lucide-react";
import ConstellationEditorDialog from "./ConstellationEditorDialog";
import SatelliteTomlEditorDialog from "./SatelliteTomlEditorDialog";
import GroundStationEditorDialog from "./GroundStationEditorDialog";
import PanelSection from "./PanelSection";
import EntryButton from "./EntryButton";
import NoticeDialog from "./NoticeDialog";
import LayerList from "./LayerList";
import type { CatalogLayer } from "../../lib/catalogLayers";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startText: string;
  /** Each editor's save applies its text to the 3D view straight away. */
  onApplySatText: (text: string) => void;
  onApplyConstText: (text: string) => void;
  onApplyGsText: (text: string) => void;
  onStartTextChange: (text: string) => void;
  /** Opens the unified external-data dialog. */
  onImportClick: () => void;
  layers: CatalogLayer[];
  onLayerChange: (id: string, patch: Partial<Pick<CatalogLayer, "visible" | "color">>) => void;
  onLayerRemove: (id: string) => void;
  /** The editor holds changes (e.g. a new start time) not yet in the 3D view. */
  pending: boolean;
  onUpdate: () => void;
  /** Empties satellites, constellations and ground stations and applies it to the 3D view. */
  onClearAll: () => void;
  updateFeedback: "idle" | "success";
  onSaveBundle: () => void;
  onLoadBundle: (file: File) => void;
}

// Cheap scans of the TOML text. We avoid the full parser here because the
// editor re-renders on every keystroke / import, and 10k+ satellite lists make
// a real parse noticeable.
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

function tomlNames(text: string): string[] {
  const names: string[] = [];
  const re = /^\s*name\s*=\s*"([^"]*)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
}

const SATELLITE_TYPE_LABELS: Record<string, string> = {
  tle: "TLE",
  elements: "軌道要素",
  geo: "静止軌道",
  formation: "編隊",
};

/** 「TLE 2 · 軌道要素 1」: how many satellite entries of each input type. */
function satelliteTypeSummary(text: string): string {
  const counts = new Map<string, number>();
  const re = /^\s*type\s*=\s*"(\w+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = SATELLITE_TYPE_LABELS[m[1]] ?? m[1];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${label} ${n.toLocaleString()}`).join(" · ");
}

function joinNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} ほか ${names.length - max}`;
}

/** Item count plus a chevron: the row opens that item's editor. */
function EditBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1 text-fg-muted">
      <CountBadge value={count} />
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function CountBadge({ value, unit = "件" }: { value: number; unit?: string }) {
  return (
    <span className="text-[11px] font-medium text-brand-text bg-brand-soft border border-brand/40 rounded-full px-2 py-0.5 leading-none tabular-nums">
      {value.toLocaleString()} {unit}
    </span>
  );
}

export default function EditorTab({
  satText,
  constText,
  gsText,
  startText,
  onApplySatText,
  onApplyConstText,
  onApplyGsText,
  onStartTextChange,
  onImportClick,
  layers,
  onLayerChange,
  onLayerRemove,
  pending,
  onUpdate,
  onClearAll,
  updateFeedback,
  onSaveBundle,
  onLoadBundle,
}: Props) {
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [constEditorOpen, setConstEditorOpen] = useState(false);
  const [satEditorOpen, setSatEditorOpen] = useState(false);
  const [gsEditorOpen, setGsEditorOpen] = useState(false);

  const satCount = useMemo(
    () => countTomlSections(satText, "satellites"),
    [satText],
  );
  const satSummary = useMemo(() => satelliteTypeSummary(satText), [satText]);
  const shellCount = useMemo(
    () => countTomlSections(constText, "constellation.shells"),
    [constText],
  );
  const constSummary = useMemo(() => {
    const sats = countConstellationSatellites(constText);
    // Skip the top-level [constellation] name; list the shells' own names.
    const shellsStart = constText.indexOf("[[constellation.shells]]");
    const names = shellsStart >= 0 ? tomlNames(constText.slice(shellsStart)) : [];
    return sats > 0 ? `計 ${sats.toLocaleString()} 機 · ${joinNames(names)}` : "";
  }, [constText]);
  const gsCount = useMemo(
    () => countTomlSections(gsText, "groundstations"),
    [gsText],
  );
  const gsSummary = useMemo(() => joinNames(tomlNames(gsText)), [gsText]);

  const clearAllAction = (
    <button
      type="button"
      onClick={() => setClearOpen(true)}
      className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-danger transition-colors px-1.5 py-0.5 rounded"
      title="エディタの衛星・コンステレーション・地上局をすべて削除（表示レイヤーは残ります）"
    >
      <Trash2 className="h-3 w-3" />
      すべて削除
    </button>
  );

  return (
    <>
      <NoticeDialog open={clearOpen} onClose={() => setClearOpen(false)} title="すべて削除しますか？" description="衛星・コンステレーション・地上局の編集内容を削除します。3Dビューにもすぐ反映します。表示レイヤーは残ります（レイヤーごとに削除できます）。" confirmLabel="すべて削除" onConfirm={onClearAll} destructive />
      <PanelSection title="シミュレーション対象" icon={<Pencil />} action={clearAllAction}>
        <EntryButton
          icon={<Satellite className="h-4 w-4" />}
          title="衛星"
          subtitle={satCount > 0 ? satSummary : "未登録 · クリックして追加"}
          onClick={() => setSatEditorOpen(true)}
          badge={<EditBadge count={satCount} />}
        />
        <EntryButton
          icon={<Layers className="h-4 w-4" />}
          title="コンステレーション"
          subtitle={shellCount > 0 ? constSummary : "未登録 · クリックして追加"}
          onClick={() => setConstEditorOpen(true)}
          badge={<EditBadge count={shellCount} />}
        />
        <EntryButton
          icon={<MapPin className="h-4 w-4" />}
          title="地上局"
          subtitle={gsCount > 0 ? gsSummary : "未登録 · クリックして追加"}
          onClick={() => setGsEditorOpen(true)}
          badge={<EditBadge count={gsCount} />}
        />
        <Button
          variant="outline"
          className="w-full h-9 gap-2 bg-raised hover:bg-raised-hover border-2 border-line-strong hover:border-brand text-fg"
          onClick={onImportClick}
          title="CelesTrak・ITU申請・TLE/OMMファイル・合成カタログ"
        >
          <Plus className="h-4 w-4" />
          外部データを追加
          <span className="flex items-center gap-1 text-fg-subtle" aria-hidden="true"><Globe className="h-3 w-3" /><Database className="h-3 w-3" /></span>
        </Button>
      </PanelSection>

      {layers.length > 0 && (
        <PanelSection title="表示レイヤー" icon={<Layers />} action={<CountBadge value={layers.reduce((sum, l) => sum + l.catalog.count, 0)} unit="機" />}>
          <LayerList layers={layers} onChange={onLayerChange} onRemove={onLayerRemove} />
        </PanelSection>
      )}

      <PanelSection title="開始時刻" icon={<Clock />}>
        <input
          type="datetime-local"
          value={startText}
          onChange={(e) => onStartTextChange(e.target.value)}
          className="w-full text-sm bg-sunken border-2 border-line-strong text-fg rounded px-2 py-1 focus:border-brand focus:ring-1 focus:ring-brand/20 outline-none"
        />
        <p className="text-[11px] text-fg-muted">UTC で指定します。変更後は「3D ビューに反映」を押してください。</p>
      </PanelSection>

      <PanelSection title="設定ファイル" icon={<FileCog />}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="w-full h-9 gap-2 bg-raised border-2 border-line-strong text-fg hover:bg-raised-hover hover:border-brand font-medium"
            onClick={onSaveBundle}
          >
            <Save className="h-4 w-4" />
            保存
          </Button>
          <Button
            variant="outline"
            className="w-full h-9 gap-2 bg-raised border-2 border-line-strong text-fg hover:bg-raised-hover hover:border-brand font-medium"
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

      {pending ? (
        <div className="flex items-center gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2" role="status">
          <span className="flex-1 text-xs text-fg">3D ビューに未反映の変更があります</span>
          <Button onClick={onUpdate} className="h-8 shrink-0 gap-1.5 bg-brand px-3 text-xs font-semibold text-brand-fg hover:bg-brand-hover">
            <RefreshCw className="h-3.5 w-3.5" />
            3D ビューに反映
          </Button>
        </div>
      ) : (
        <p className={cn("flex items-center gap-1.5 px-1 text-[11px] transition-colors", updateFeedback === "success" ? "text-success" : "text-fg-subtle")} role="status">
          <Check className="h-3.5 w-3.5" />
          {updateFeedback === "success" ? "3D ビューに反映しました" : "各エディタで「保存して反映」を押すと 3D ビューへ反映されます"}
        </p>
      )}

      <ConstellationEditorDialog
        open={constEditorOpen}
        constText={constText}
        onApply={onApplyConstText}
        onClose={() => setConstEditorOpen(false)}
      />
      <SatelliteTomlEditorDialog
        open={satEditorOpen}
        satText={satText}
        onApply={onApplySatText}
        onClose={() => setSatEditorOpen(false)}
      />
      <GroundStationEditorDialog
        open={gsEditorOpen}
        gsText={gsText}
        onApply={onApplyGsText}
        onClose={() => setGsEditorOpen(false)}
      />
    </>
  );
}
