import { useState, type RefObject } from "react";
import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import { Button } from "./button";
import { FileInput, Trash2, Globe, Satellite, Compass, Layers, FolderOpen, Bookmark, Save, Plus, X } from "lucide-react";
import PanelSection from "./PanelSection";
import { CheckRow, ColorChip, HelpTip, SegmentedControl } from "./compactControls";
import type SatelliteScene from "../../lib/visualization";
import { isLayeredEarthMode } from "../../lib/earthTextures";
import {
  listSavedViews,
  saveNamedView,
  deleteNamedView,
  type DisplayOptions,
  type NamedView,
  type ViewFrame,
  type ViewSettings,
} from "../../lib/viewState";

const VIEW_FRAME_NOTES: Record<ViewFrame, string> = {
  eci: "慣性系。星に対して静止し、軌道の形が見やすい。",
  ecef: "地球固定。地球と一緒に回り、地表の動きが見やすい。",
  gse: "太陽固定（地心太陽黄道座標）。太陽を右、黄道北を上に固定し、昼夜境界と季節で傾く地軸が見やすい。",
};

interface Props {
  display: DisplayOptions;
  onDisplayChange: (patch: Partial<DisplayOptions>) => void;
  sceneRef?: RefObject<SatelliteScene | null>;
  /** Capture the current view (camera + display settings) on demand */
  getCurrentView: () => ViewSettings;
  /** Apply a previously saved view */
  onApplyView: (settings: ViewSettings) => void;
}

/**
 * 表示タブ: 触っても計算結果が変わらない見た目の設定だけを置く。
 * 判定・解析に効く値(最低仰角・センサ視野など)は通信タブ。
 */
export default function OptionTab({ display, onDisplayChange, sceneRef, getCurrentView, onApplyView }: Props) {
  const set = onDisplayChange;
  const [loadedKMLs, setLoadedKMLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedViews, setSavedViews] = useState<NamedView[]>(() => listSavedViews());
  const [viewName, setViewName] = useState("");
  const [addingView, setAddingView] = useState(false);

  const handleSaveView = () => {
    setSavedViews(saveNamedView(viewName, getCurrentView()));
    setViewName("");
    setAddingView(false);
  };

  const handleCancelAddView = () => {
    setViewName("");
    setAddingView(false);
  };

  const handleDeleteView = (id: string) => {
    setSavedViews(deleteNamedView(id));
  };

  const handleKMLLoad = async () => {
    if (!sceneRef?.current) {
      setError("シーンが初期化されていません");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kml";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length === 0) return;

      setLoading(true);
      setError(null);

      const readAsText = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み取りに失敗しました"));
          reader.readAsText(file);
        });

      try {
        // Load each selected file in turn, overlaying them onto any KML that is
        // already on the globe (append = true) rather than replacing it.
        for (const file of files) {
          let objectUrl: string | null = null;
          try {
            const kmlContent = await readAsText(file);
            // Use a Blob URL instead of a base64 data URL so that KML files
            // containing non-Latin1 characters (e.g. Japanese place names) load
            // correctly. btoa() throws on such characters.
            const blob = new Blob([kmlContent], {
              type: "application/vnd.google-earth.kml+xml",
            });
            objectUrl = URL.createObjectURL(blob);
            await sceneRef.current!.loadKML(objectUrl, true);
            setLoadedKMLs((prev) => [...prev, file.name]);
          } catch (err) {
            setError(err instanceof Error ? err.message : `${file.name} の読み込みに失敗しました`);
          } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          }
        }
      } finally {
        setLoading(false);
      }
    };
    input.click();
  };

  const handleClearKML = () => {
    if (sceneRef?.current) {
      sceneRef.current.clearKML();
      setLoadedKMLs([]);
      setError(null);
    }
  };

  return (
    <div>
      {/* ビュー(画角・表示設定)の保存と呼び出し。このタブのプリセットとして先頭に置く */}
      <PanelSection
        title="保存したビュー"
        icon={<Bookmark />}
        action={
          !addingView && (
            <button
              type="button"
              data-slot="button"
              onClick={() => setAddingView(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-muted hover:bg-raised-hover hover:text-fg"
            >
              <Plus className="h-3.5 w-3.5" />
              現在のビューを保存
            </button>
          )
        }
      >
        {addingView && (
          <div className="flex gap-1.5">
            <input
              autoFocus
              className="option-number-input flex-1 min-w-0"
              type="text"
              placeholder="ビュー名（例: 東京上空）"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveView();
                if (e.key === "Escape") handleCancelAddView();
              }}
            />
            <Button
              onClick={handleSaveView}
              className="flex items-center gap-1 h-9 shrink-0"
              variant="secondary"
            >
              <Save className="w-4 h-4" />
              保存
            </Button>
            <button
              type="button"
              onClick={handleCancelAddView}
              className="shrink-0 text-fg-muted hover:text-fg px-1"
              aria-label="キャンセル"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {savedViews.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {savedViews.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center rounded-full border border-line-strong bg-raised text-xs text-fg transition-colors hover:border-line-strong"
              >
                <button
                  type="button"
                  onClick={() => onApplyView(v.settings)}
                  className="max-w-[150px] truncate py-1 pl-3 pr-1.5 hover:text-fg"
                  title={`「${v.name}」を適用`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteView(v.id)}
                  className="py-1 pl-0.5 pr-2 text-fg-muted hover:text-danger"
                  aria-label={`「${v.name}」を削除`}
                  title="削除"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          !addingView && (
            <p className="text-[11px] text-fg-muted leading-snug">
              画角と表示設定に名前を付けて保存し、ワンクリックで呼び出せます。
            </p>
          )
        )}
      </PanelSection>

      <PanelSection title="地球" icon={<Globe />}>
        <EarthTextureSelector value={display.earthTexture} onChange={(t) => set({ earthTexture: t })} />
        <CheckRow
          id="brightEarth"
          checked={display.brightEarth}
          onChange={(v) => set({ brightEarth: v })}
          label="地球を明るく表示（昼夜の陰影なし）"
        />
        <CheckRow
          id="whiteBackground"
          checked={display.whiteBackground}
          onChange={(v) => set({ whiteBackground: v })}
          label="背景を白にする"
        />
      </PanelSection>

      <PanelSection title="重ねて表示" icon={<Layers />}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CheckRow id="graticule" checked={display.showGraticule} onChange={(v) => set({ showGraticule: v })} label="経緯線" />
          <CheckRow
            id="countryBorders"
            checked={display.showCountryBorders}
            onChange={(v) => set({ showCountryBorders: v })}
            label="国境線"
          />
          <CheckRow id="sunDirection" checked={display.showSunDirection} onChange={(v) => set({ showSunDirection: v })} label="太陽方向" />
          <CheckRow id="ecliptic" checked={display.showEcliptic} onChange={(v) => set({ showEcliptic: v })} label="黄道面" />
          <CheckRow id="geoOrbit" checked={display.showGeoOrbit} onChange={(v) => set({ showGeoOrbit: v })} label="静止軌道" />
          {isLayeredEarthMode(display.earthTexture) && (
            <CheckRow id="clouds" checked={display.showClouds} onChange={(v) => set({ showClouds: v })} label="雲（装飾）" />
          )}
        </div>
      </PanelSection>

      <PanelSection title="衛星" icon={<Satellite />}>
        <SatelliteSizeControl
          radius={display.satRadius}
          pixelSize={display.pointStyle.pixelSize}
          onRadiusChange={(r) => set({ satRadius: r, pointStyle: { ...display.pointStyle, pixelSize: 0 } })}
          onPixelSizeChange={(px) => set({ pointStyle: { ...display.pointStyle, pixelSize: px } })}
        />
        <CheckRow
          id="sat-sunlit-shading"
          checked={display.pointStyle.sunlitShading}
          onChange={(v) => set({ pointStyle: { ...display.pointStyle, sunlitShading: v } })}
          label="地球の影に入った衛星を暗くする"
        />
        <CheckRow
          id="sat-glint"
          checked={display.pointStyle.glint}
          onChange={(v) => set({ pointStyle: { ...display.pointStyle, glint: v } })}
          label="太陽光の反射できらめかせる"
        />
        <ColorChip
          label="選択中の衛星の色"
          value={display.satelliteSelectedColor}
          onChange={(c) => set({ satelliteSelectedColor: c })}
        />
      </PanelSection>

      <PanelSection title="座標系" icon={<Compass />}>
        <SegmentedControl
          ariaLabel="座標系の選択"
          value={display.viewFrame}
          options={[
            { value: "eci", label: "ECI" },
            { value: "ecef", label: "ECEF" },
            { value: "gse", label: "GSE" },
          ]}
          onChange={(frame) => set({ viewFrame: frame })}
        />
        <p className="text-[11px] text-fg-subtle leading-snug">{VIEW_FRAME_NOTES[display.viewFrame]}</p>
      </PanelSection>

      <PanelSection
        title="KML 重ね合わせ"
        icon={<FolderOpen />}
        action={<HelpTip text="KML ファイルのポイント・ライン・ポリゴンを地球上に重ねて表示します。" />}
        collapsible
        defaultOpen={loadedKMLs.length > 0}
      >
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            onClick={handleKMLLoad}
            disabled={loading}
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs bg-raised text-fg border border-line-strong hover:bg-raised-hover hover:text-fg"
          >
            <FileInput className="w-3.5 h-3.5" />
            {loading ? "読み込み中..." : "KMLを読み込む"}
          </Button>
          {loadedKMLs.length > 0 && (
            <Button
              onClick={handleClearKML}
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-fg-muted hover:text-fg"
            >
              <Trash2 className="w-3.5 h-3.5" />
              クリア
            </Button>
          )}
        </div>

        {error && (
          <div className="text-danger text-xs bg-danger-soft p-2 rounded">{error}</div>
        )}

        {loadedKMLs.length > 0 && (
          <ul className="text-xs text-fg-muted list-disc list-inside">
            {loadedKMLs.map((file, index) => (
              <li key={index}>{file}</li>
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}
