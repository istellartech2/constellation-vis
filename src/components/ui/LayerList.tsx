import { Eye, EyeOff, FileText, FileUp, FlaskConical, Globe, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { CatalogLayer, CatalogLayerKind, LayerColorMode } from "../../lib/catalogLayers";
import { SegmentedControl } from "./compactControls";

const KIND_ICON: Record<CatalogLayerKind, ReactNode> = {
  celestrak: <Globe className="size-3" />,
  file: <FileUp className="size-3" />,
  filing: <FileText className="size-3" />,
  synthetic: <FlaskConical className="size-3" />,
};

interface Props {
  layers: CatalogLayer[];
  colorMode: LayerColorMode;
  onColorModeChange: (mode: LayerColorMode) => void;
  onChange: (id: string, patch: Partial<Pick<CatalogLayer, "visible" | "color">>) => void;
  onRemove: (id: string) => void;
}

/** Display layers, styled like the editor entries; every action applies to the 3D view at once. */
export default function LayerList({ layers, colorMode, onColorModeChange, onChange, onRemove }: Props) {
  return (
    <div className="space-y-1.5">
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-raised">
        {layers.map((layer) => (
          <li key={layer.id} className={cn("flex items-center gap-2 px-2 py-1.5", !layer.visible && "opacity-55")}>
            <label className="relative size-4 shrink-0 cursor-pointer rounded-full border border-line-strong" style={{ background: layer.color }} title="レイヤーの色を変更">
              <input type="color" value={layer.color} onChange={(e) => onChange(layer.id, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${layer.name} の色`} />
            </label>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight" title={layer.name}>{layer.name}</p>
              <p className="flex items-center gap-1 truncate text-[10px] text-fg-muted" title={layer.detail}>
                <span className="shrink-0 text-fg-subtle">{KIND_ICON[layer.kind]}</span>
                <span className="tabular-nums">{layer.catalog.count.toLocaleString()}機</span>
                {layer.detail && <span className="truncate">· {layer.detail}</span>}
              </p>
            </div>
            <button type="button" data-slot="button" onClick={() => onChange(layer.id, { visible: !layer.visible })} aria-pressed={layer.visible}
              aria-label={layer.visible ? `${layer.name} を非表示` : `${layer.name} を表示`} title={layer.visible ? "非表示にする" : "表示する"}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-raised-hover hover:text-fg">
              {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
            <button type="button" data-slot="button" onClick={() => onRemove(layer.id)} aria-label={`${layer.name} を削除`} title="削除"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-danger-soft hover:text-danger">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="shrink-0">色分け</span>
        <SegmentedControl<LayerColorMode>
          ariaLabel="レイヤーの色分け"
          value={colorMode}
          onChange={onColorModeChange}
          options={[{ value: "layer", label: "レイヤー別" }, { value: "visibility", label: "地上局から可視" }]}
        />
      </div>
      <p className="text-[10px] leading-snug text-fg-subtle">GPUのJ2近似で表示し、解析・ISLの対象外です。ブラウザに保存され、設定ファイルには含まれません。</p>
    </div>
  );
}
