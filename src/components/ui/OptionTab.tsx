import { useState, type RefObject } from "react";
import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import {
  FileInput,
  Trash2,
  Globe,
  Satellite,
  Sun,
  Radio,
  Palette,
  FolderOpen,
  Check,
  Bookmark,
  Save,
  Plus,
  X,
} from "lucide-react";
import PanelSection from "./PanelSection";
import { ColorChip, HelpTip, InlineSlider } from "./compactControls";
import type SatelliteScene from "../../lib/visualization";
import type { EarthTextureMode } from "../../lib/earthTextures";
import {
  listSavedViews,
  saveNamedView,
  deleteNamedView,
  type NamedView,
  type ViewSettings,
} from "../../lib/viewState";

const EARTH_RADIUS_KM = 6378.137;

interface Props {
  satRadius: number;
  onSatRadiusChange: (r: number) => void;
  earthTexture: EarthTextureMode;
  onEarthTextureChange: (t: EarthTextureMode) => void;
  showGraticule: boolean;
  onShowGraticuleChange: (v: boolean) => void;
  showEcliptic: boolean;
  onShowEclipticChange: (v: boolean) => void;
  showGeoOrbit: boolean;
  onShowGeoOrbitChange: (v: boolean) => void;
  showSunDirection: boolean;
  onShowSunDirectionChange: (v: boolean) => void;
  showSatelliteFovCones: boolean;
  onShowSatelliteFovConesChange: (v: boolean) => void;
  fovConeHalfAngleDeg: number;
  onFovConeHalfAngleDegChange: (v: number) => void;
  fovConeMinHeight: number;
  fovConeColor: string;
  onFovConeColorChange: (color: string) => void;
  fovConeAlongTrackDeg: number;
  onFovConeAlongTrackDegChange: (v: number) => void;
  fovConeCrossTrackDeg: number;
  onFovConeCrossTrackDegChange: (v: number) => void;
  satelliteVisibleColor: string;
  onSatelliteVisibleColorChange: (color: string) => void;
  satelliteHiddenColor: string;
  onSatelliteHiddenColorChange: (color: string) => void;
  satelliteSelectedColor: string;
  onSatelliteSelectedColorChange: (color: string) => void;
  ecef: boolean;
  onEcefChange: (v: boolean) => void;
  showPerturbation: boolean;
  onShowPerturbationChange: (v: boolean) => void;
  showDerivedSatelliteInfo: boolean;
  onShowDerivedSatelliteInfoChange: (v: boolean) => void;
  brightEarth: boolean;
  onBrightEarthChange: (v: boolean) => void;
  whiteBackground: boolean;
  onWhiteBackgroundChange: (v: boolean) => void;
  sceneRef?: RefObject<SatelliteScene | null>;
  /** Capture the current view (camera + display settings) on demand */
  getCurrentView: () => ViewSettings;
  /** Apply a previously saved view */
  onApplyView: (settings: ViewSettings) => void;
}

function CheckboxItem({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
      />
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer text-gray-200">
        {label}
      </Label>
    </div>
  );
}

export default function OptionTab(props: Props) {
  const {
    satRadius,
    onSatRadiusChange,
    earthTexture,
    onEarthTextureChange,
    showGraticule,
    onShowGraticuleChange,
    showEcliptic,
    onShowEclipticChange,
    showGeoOrbit,
    onShowGeoOrbitChange,
    showSunDirection,
    onShowSunDirectionChange,
    showSatelliteFovCones,
    onShowSatelliteFovConesChange,
    fovConeHalfAngleDeg,
    onFovConeHalfAngleDegChange,
    fovConeMinHeight,
    fovConeColor,
    onFovConeColorChange,
    fovConeAlongTrackDeg,
    onFovConeAlongTrackDegChange,
    fovConeCrossTrackDeg,
    onFovConeCrossTrackDegChange,
    satelliteVisibleColor,
    onSatelliteVisibleColorChange,
    satelliteHiddenColor,
    onSatelliteHiddenColorChange,
    satelliteSelectedColor,
    onSatelliteSelectedColorChange,
    ecef,
    onEcefChange,
    showPerturbation,
    onShowPerturbationChange,
    showDerivedSatelliteInfo,
    onShowDerivedSatelliteInfoChange,
    brightEarth,
    onBrightEarthChange,
    whiteBackground,
    onWhiteBackgroundChange,
    sceneRef,
    getCurrentView,
    onApplyView,
  } = props;

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
      {/* 0. ビュー(画角・表示設定)の保存と呼び出し */}
      <PanelSection
        title="ビュー保存"
        icon={<Bookmark />}
        action={
          savedViews.length > 0 ? (
            <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
              {savedViews.length}
            </span>
          ) : undefined
        }
      >
        {addingView ? (
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
              className="shrink-0 text-gray-400 hover:text-gray-200 px-1"
              aria-label="キャンセル"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <Button
            onClick={() => setAddingView(true)}
            variant="secondary"
            className="w-full h-8 justify-center gap-1.5 text-xs bg-gray-700 text-gray-200 border border-gray-600 hover:bg-gray-600 hover:text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            現在のビューを保存
          </Button>
        )}

        {savedViews.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {savedViews.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center rounded-full border border-gray-600 bg-gray-700/70 text-xs text-gray-200 transition-colors hover:border-gray-400"
              >
                <button
                  type="button"
                  onClick={() => onApplyView(v.settings)}
                  className="max-w-[150px] truncate py-1 pl-3 pr-1.5 hover:text-white"
                  title={`「${v.name}」を適用`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteView(v.id)}
                  className="py-1 pl-0.5 pr-2 text-gray-400 hover:text-red-400"
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
            <p className="text-[11px] text-gray-400 leading-snug">
              画角と表示設定に名前を付けて保存できます。
            </p>
          )
        )}
      </PanelSection>

      {/* A. 地球の見た目 */}
      <PanelSection title="地球の見た目" icon={<Globe />}>
        <EarthTextureSelector value={earthTexture} onChange={onEarthTextureChange} />
        <CheckboxItem
          id="graticule"
          checked={showGraticule}
          onChange={onShowGraticuleChange}
          label="経緯線を表示"
        />
        <CheckboxItem
          id="brightEarth"
          checked={brightEarth}
          onChange={onBrightEarthChange}
          label="地球を明るく表示"
        />
        <CheckboxItem
          id="whiteBackground"
          checked={whiteBackground}
          onChange={onWhiteBackgroundChange}
          label="背景を白にする"
        />
      </PanelSection>

      {/* B. 衛星の見た目 */}
      <PanelSection title="衛星の見た目" icon={<Satellite />}>
        <SatelliteSizeControl value={satRadius} onChange={onSatRadiusChange} />
        <CheckboxItem
          id="derivedSatelliteInfo"
          checked={showDerivedSatelliteInfo}
          onChange={onShowDerivedSatelliteInfoChange}
          label="選択衛星の詳細情報を表示"
        />
        <CheckboxItem
          id="perturbation"
          checked={showPerturbation}
          onChange={onShowPerturbationChange}
          label="摂動・軌道変化情報を表示"
        />
      </PanelSection>

      {/* C. 座標系と補助表示(ECI/ECEF・太陽・黄道面・GEO) */}
      <PanelSection title="座標系・補助表示" icon={<Sun />}>
        <div className="space-y-1">
          <div className="text-sm text-gray-200">表示する座標系</div>
          <div
            className="inline-flex w-full rounded-md border border-gray-600 bg-gray-900/60 p-0.5"
            role="group"
            aria-label="座標系の選択"
          >
            <button
              type="button"
              onClick={() => onEcefChange(false)}
              aria-pressed={!ecef}
              data-slot="button"
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                !ecef
                  ? "bg-gray-700 text-white font-medium"
                  : "bg-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {!ecef && <Check className="h-3 w-3 text-orange-400" />}
              ECI（慣性系）
            </button>
            <button
              type="button"
              onClick={() => onEcefChange(true)}
              aria-pressed={ecef}
              data-slot="button"
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                ecef
                  ? "bg-gray-700 text-white font-medium"
                  : "bg-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {ecef && <Check className="h-3 w-3 text-orange-400" />}
              ECEF（地球固定）
            </button>
          </div>
          <p className="text-[11px] text-gray-500 leading-snug">
            {ecef
              ? "地球と一緒に回転。地表の動きが見やすい。"
              : "星に対して静止。軌道の形が見やすい。"}
          </p>
        </div>
        <CheckboxItem
          id="ecliptic"
          checked={showEcliptic && showSunDirection}
          onChange={(v) => {
            onShowEclipticChange(v);
            onShowSunDirectionChange(v);
          }}
          label="太陽方向と黄道面を表示"
        />
        <CheckboxItem
          id="geoOrbit"
          checked={showGeoOrbit}
          onChange={onShowGeoOrbitChange}
          label="静止軌道（GEO）を表示"
        />
      </PanelSection>

      {/* D. 衛星の視野コーン(地上局の通信範囲コーンは通信タブへ移設) */}
      <PanelSection title="衛星の視野（コーン）" icon={<Radio />}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="satelliteFovCones"
            checked={showSatelliteFovCones}
            onCheckedChange={(v) => onShowSatelliteFovConesChange(!!v)}
          />
          <Label
            htmlFor="satelliteFovCones"
            className="text-sm font-normal cursor-pointer text-gray-200 flex-1"
          >
            衛星の視野を表示
          </Label>
          {showSatelliteFovCones && (
            <input
              type="color"
              className="option-color-input"
              value={fovConeColor}
              onChange={(e) => onFovConeColorChange(e.target.value)}
              title="表示カラー"
              aria-label="表示カラー"
            />
          )}
        </div>
        {showSatelliteFovCones && (
          <>
            <InlineSlider
              label="視野半角"
              labelW="w-24"
              value={fovConeHalfAngleDeg}
              min={1}
              max={80}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              onChange={onFovConeHalfAngleDegChange}
            />
            <InlineSlider
              label="Along-track"
              labelW="w-24"
              value={fovConeAlongTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="視野の傾き(進行方向)。正で進行方向へ傾斜します。"
              onChange={onFovConeAlongTrackDegChange}
            />
            <InlineSlider
              label="Cross-track"
              labelW="w-24"
              value={fovConeCrossTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="視野の傾き(直交方向)。正で軌道面左方向へ傾斜します。"
              onChange={onFovConeCrossTrackDegChange}
            />
            <p className="text-[11px] text-gray-500">
              円錐最小高さ {fovConeMinHeight.toFixed(2)}R<sub>⊕</sub>(約{" "}
              {Math.round(fovConeMinHeight * EARTH_RADIUS_KM).toLocaleString()} km)—
              衛星高度に応じた固定スケール
            </p>
          </>
        )}
      </PanelSection>

      {/* E. 衛星ポイントカラー */}
      <PanelSection title="衛星ポイントカラー" icon={<Palette />}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ColorChip
            label="リンク可視"
            value={satelliteVisibleColor}
            onChange={onSatelliteVisibleColorChange}
          />
          <ColorChip
            label="リンク不可"
            value={satelliteHiddenColor}
            onChange={onSatelliteHiddenColorChange}
          />
          <ColorChip
            label="選択中"
            value={satelliteSelectedColor}
            onChange={onSatelliteSelectedColorChange}
          />
        </div>
      </PanelSection>

      {/* F. KML */}
      <PanelSection
        title="KML 重ね合わせ"
        icon={<FolderOpen />}
        action={<HelpTip text="KML ファイルのポイント・ライン・ポリゴンを地球上に重ねて表示します。" />}
      >
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            onClick={handleKMLLoad}
            disabled={loading}
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs bg-gray-700 text-gray-200 border border-gray-600 hover:bg-gray-600 hover:text-white"
          >
            <FileInput className="w-3.5 h-3.5" />
            {loading ? "読み込み中..." : "KMLを読み込む"}
          </Button>
          {loadedKMLs.length > 0 && (
            <Button
              onClick={handleClearKML}
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
              クリア
            </Button>
          )}
        </div>

        {error && (
          <div className="text-red-400 text-xs bg-red-900/20 p-2 rounded">{error}</div>
        )}

        {loadedKMLs.length > 0 && (
          <ul className="text-xs text-gray-300 list-disc list-inside">
            {loadedKMLs.map((file, index) => (
              <li key={index}>{file}</li>
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}
