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
} from "lucide-react";
import PanelSection from "./PanelSection";
import type SatelliteScene from "../../lib/visualization";
import type { EarthTextureMode } from "../../lib/earthTextures";

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
  showSunDirection: boolean;
  onShowSunDirectionChange: (v: boolean) => void;
  showGroundStationCones: boolean;
  onShowGroundStationConesChange: (v: boolean) => void;
  showSatelliteFovCones: boolean;
  onShowSatelliteFovConesChange: (v: boolean) => void;
  groundConeMinElevationDeg: number;
  onGroundConeMinElevationDegChange: (v: number) => void;
  groundConeDistanceKm: number;
  onGroundConeDistanceKmChange: (v: number) => void;
  groundConeColor: string;
  onGroundConeColorChange: (color: string) => void;
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

function SliderControl({
  label,
  valueText,
  min,
  max,
  step,
  value,
  onChange,
  unit,
  hint,
}: {
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  hint?: string;
}) {
  const clamped = (v: number) => Math.min(Math.max(v, min), max);
  const handle = (v: number) => onChange(clamped(v));
  return (
    <div className="option-control">
      <div className="option-control-label">
        <span>{label}</span>
        <span>{valueText}</span>
      </div>
      <div className="option-control-inputs">
        <input
          className="option-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handle(Number(e.target.value))}
        />
        <input
          className="option-number-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handle(Number(e.target.value))}
        />
        {unit && <span className="option-control-unit">{unit}</span>}
      </div>
      {hint && <div className="option-control-hint">{hint}</div>}
    </div>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="option-control">
      <div className="option-control-label">
        <span>{label}</span>
      </div>
      <div className="option-control-inputs">
        <input
          className="option-color-input"
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="option-color-value">{value.toUpperCase()}</span>
      </div>
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
    showSunDirection,
    onShowSunDirectionChange,
    showGroundStationCones,
    onShowGroundStationConesChange,
    showSatelliteFovCones,
    onShowSatelliteFovConesChange,
    groundConeMinElevationDeg,
    onGroundConeMinElevationDegChange,
    groundConeDistanceKm,
    onGroundConeDistanceKmChange,
    groundConeColor,
    onGroundConeColorChange,
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
  } = props;

  const [loadedKMLs, setLoadedKMLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {/* C. 座標と太陽 */}
      <PanelSection title="座標と太陽" icon={<Sun />}>
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
      </PanelSection>

      {/* D. 可視範囲 */}
      <PanelSection title="可視範囲（コーン）" icon={<Radio />}>
        <CheckboxItem
          id="satelliteFovCones"
          checked={showSatelliteFovCones}
          onChange={onShowSatelliteFovConesChange}
          label="衛星の視野を表示"
        />
        {showSatelliteFovCones && (
          <div className="option-subsection">
            <SliderControl
              label="視野半角"
              valueText={`${fovConeHalfAngleDeg.toFixed(0)}°`}
              min={1}
              max={80}
              step={1}
              value={fovConeHalfAngleDeg}
              onChange={onFovConeHalfAngleDegChange}
              unit="°"
            />
            <SliderControl
              label="Along-track オフセット"
              valueText={`${fovConeAlongTrackDeg.toFixed(0)}°`}
              min={-60}
              max={60}
              step={1}
              value={fovConeAlongTrackDeg}
              onChange={onFovConeAlongTrackDegChange}
              unit="°"
              hint="正: 進行方向へ傾斜"
            />
            <SliderControl
              label="Cross-track オフセット"
              valueText={`${fovConeCrossTrackDeg.toFixed(0)}°`}
              min={-60}
              max={60}
              step={1}
              value={fovConeCrossTrackDeg}
              onChange={onFovConeCrossTrackDegChange}
              unit="°"
              hint="正: 軌道面左方向へ傾斜"
            />
            <div className="option-control">
              <div className="option-control-label">
                <span>円錐最小高さ</span>
                <span>
                  {fovConeMinHeight.toFixed(2)}R<sub>⊕</sub>
                  （約 {Math.round(fovConeMinHeight * EARTH_RADIUS_KM).toLocaleString()} km）
                </span>
              </div>
              <div className="option-control-hint">※衛星高度に応じて自動的に変化する固定スケールです</div>
            </div>
            <ColorControl label="表示カラー" value={fovConeColor} onChange={onFovConeColorChange} />
          </div>
        )}

        <CheckboxItem
          id="groundStationCones"
          checked={showGroundStationCones}
          onChange={onShowGroundStationConesChange}
          label="地上局の通信可能範囲を表示"
        />
        {showGroundStationCones && (
          <div className="option-subsection">
            <SliderControl
              label="最小仰角しきい値"
              valueText={`${groundConeMinElevationDeg.toFixed(0)}°`}
              min={0}
              max={85}
              step={1}
              value={groundConeMinElevationDeg}
              onChange={onGroundConeMinElevationDegChange}
              unit="°"
            />
            <SliderControl
              label="可視距離上限"
              valueText={`${Math.round(groundConeDistanceKm).toLocaleString()} km`}
              min={100}
              max={20000}
              step={50}
              value={groundConeDistanceKm}
              onChange={onGroundConeDistanceKmChange}
            />
            <ColorControl label="表示カラー" value={groundConeColor} onChange={onGroundConeColorChange} />
          </div>
        )}
      </PanelSection>

      {/* E. 衛星ポイントカラー */}
      <PanelSection title="衛星ポイントカラー" icon={<Palette />} collapsible defaultOpen={false}>
        <div className="option-color-grid">
          <div className="option-color-row">
            <span className="option-color-label">リンク可視</span>
            <input
              className="option-color-input"
              type="color"
              value={satelliteVisibleColor}
              onChange={(e) => onSatelliteVisibleColorChange(e.target.value)}
            />
            <span className="option-color-value">{satelliteVisibleColor.toUpperCase()}</span>
          </div>
          <div className="option-color-row">
            <span className="option-color-label">リンク不可</span>
            <input
              className="option-color-input"
              type="color"
              value={satelliteHiddenColor}
              onChange={(e) => onSatelliteHiddenColorChange(e.target.value)}
            />
            <span className="option-color-value">{satelliteHiddenColor.toUpperCase()}</span>
          </div>
          <div className="option-color-row">
            <span className="option-color-label">選択中</span>
            <input
              className="option-color-input"
              type="color"
              value={satelliteSelectedColor}
              onChange={(e) => onSatelliteSelectedColorChange(e.target.value)}
            />
            <span className="option-color-value">{satelliteSelectedColor.toUpperCase()}</span>
          </div>
        </div>
      </PanelSection>

      {/* F. KML */}
      <PanelSection title="KML 重ね合わせ" icon={<FolderOpen />} collapsible defaultOpen={false}>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleKMLLoad}
            disabled={loading}
            className="flex items-center gap-2 h-9"
            variant="secondary"
          >
            <FileInput className="w-4 h-4" />
            {loading ? "読み込み中..." : "KMLを読み込む"}
          </Button>
          {loadedKMLs.length > 0 && (
            <Button
              onClick={handleClearKML}
              variant="ghost"
              className="flex items-center gap-2 h-9"
            >
              <Trash2 className="w-4 h-4" />
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

        <p className="text-[11px] text-gray-400">
          ポイント・ライン・ポリゴンを地球上に重ねて表示します。
        </p>
      </PanelSection>
    </div>
  );
}
