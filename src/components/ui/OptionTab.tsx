import { useState, type RefObject } from "react";
import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { FileInput, Trash2, ChevronDown } from "lucide-react";
import type SatelliteScene from "../../lib/visualization";

const EARTH_RADIUS_KM = 6378.137;

interface Props {
  satRadius: number;
  onSatRadiusChange: (r: number) => void;
  earthTexture: string;
  onEarthTextureChange: (t: string) => void;
  showGraticule: boolean;
  onShowGraticuleChange: (v: boolean) => void;
  showEcliptic: boolean;
  onShowEclipticChange: (v: boolean) => void;
  showSunDirection: boolean;
  onShowSunDirectionChange: (v: boolean) => void;
  showGroundStationCones: boolean;
  onShowGroundStationConesChange: (v: boolean) => void;
  showSatelliteNadirCones: boolean;
  onShowSatelliteNadirConesChange: (v: boolean) => void;
  groundConeMinElevationDeg: number;
  onGroundConeMinElevationDegChange: (v: number) => void;
  groundConeDistanceKm: number;
  onGroundConeDistanceKmChange: (v: number) => void;
  groundConeColor: string;
  onGroundConeColorChange: (color: string) => void;
  satelliteConeHalfAngleDeg: number;
  onSatelliteConeHalfAngleDegChange: (v: number) => void;
  satelliteConeMinHeight: number;
  satelliteConeColor: string;
  onSatelliteConeColorChange: (color: string) => void;
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
  brightEarth: boolean;
  onBrightEarthChange: (v: boolean) => void;
  sceneRef?: RefObject<SatelliteScene | null>;
}

export default function OptionTab({
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
  showSatelliteNadirCones,
  onShowSatelliteNadirConesChange,
  groundConeMinElevationDeg,
  onGroundConeMinElevationDegChange,
  groundConeDistanceKm,
  onGroundConeDistanceKmChange,
  groundConeColor,
  onGroundConeColorChange,
  satelliteConeHalfAngleDeg,
  onSatelliteConeHalfAngleDegChange,
  satelliteConeMinHeight,
  satelliteConeColor,
  onSatelliteConeColorChange,
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
  brightEarth,
  onBrightEarthChange,
  sceneRef,
}: Props) {
  const [loadedKMLs, setLoadedKMLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  const handleGroundConeMinElChange = (value: number) => {
    onGroundConeMinElevationDegChange(clamp(value, 0, 85));
  };
  const handleGroundConeDistanceChange = (value: number) => {
    onGroundConeDistanceKmChange(clamp(value, 100, 20000));
  };
  const handleSatelliteAngleChange = (value: number) => {
    onSatelliteConeHalfAngleDegChange(clamp(value, 1, 80));
  };

  const handleKMLLoad = async () => {
    if (!sceneRef?.current) {
      setError("シーンが初期化されていません");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setLoading(true);
      setError(null);

      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const kmlContent = event.target?.result as string;
            
            // Create a data URL for the KML content
            const dataUrl = `data:application/vnd.google-earth.kml+xml;base64,${btoa(kmlContent)}`;
            
            await sceneRef.current!.loadKML(dataUrl);
            
            setLoadedKMLs(prev => [...prev, file.name]);
          } catch (err) {
            setError(err instanceof Error ? err.message : "KMLの読み込みに失敗しました");
          } finally {
            setLoading(false);
          }
        };
        reader.readAsText(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ファイルの読み取りに失敗しました");
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
      <div className="option-section">
        <div className="option-section-title">表示コントロール</div>
        <SatelliteSizeControl
          value={satRadius}
          onChange={onSatRadiusChange}
        />
        <div style={{ marginTop: 8 }}>
          <EarthTextureSelector
            value={earthTexture}
            onChange={onEarthTextureChange}
          />
        </div>
      </div>

      <div className="option-section">
        <div className="option-section-title">表示オプション</div>
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="graticule"
              checked={showGraticule}
              onCheckedChange={(checked) => onShowGraticuleChange(!!checked)}
            />
            <Label
              htmlFor="graticule"
              className="text-sm font-normal cursor-pointer"
            >
              経緯線を表示
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="ecliptic"
              checked={showEcliptic && showSunDirection}
              onCheckedChange={(checked) => {
                onShowEclipticChange(!!checked);
                onShowSunDirectionChange(!!checked);
              }}
            />
            <Label
              htmlFor="ecliptic"
              className="text-sm font-normal cursor-pointer"
            >
              黄道面を表示
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="groundStationCones"
              checked={showGroundStationCones}
              onCheckedChange={(checked) => onShowGroundStationConesChange(!!checked)}
            />
            <Label
              htmlFor="groundStationCones"
              className="text-sm font-normal cursor-pointer"
            >
              地上局の可視円錐を表示
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="satelliteNadirCones"
              checked={showSatelliteNadirCones}
              onCheckedChange={(checked) => onShowSatelliteNadirConesChange(!!checked)}
            />
            <Label
              htmlFor="satelliteNadirCones"
              className="text-sm font-normal cursor-pointer"
            >
              衛星のナディア円錐を表示
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="ecef"
              checked={ecef}
              onCheckedChange={(checked) => onEcefChange(!!checked)}
            />
            <Label
              htmlFor="ecef"
              className="text-sm font-normal cursor-pointer"
            >
              ECEFモード
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="perturbation"
              checked={showPerturbation}
              onCheckedChange={(checked) => onShowPerturbationChange(!!checked)}
            />
            <Label
              htmlFor="perturbation"
              className="text-sm font-normal cursor-pointer"
            >
              摂動を表示
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="brightEarth"
              checked={brightEarth}
              onCheckedChange={(checked) => onBrightEarthChange(!!checked)}
            />
            <Label
              htmlFor="brightEarth"
              className="text-sm font-normal cursor-pointer"
            >
              Bright earth
            </Label>
          </div>
        </div>
      </div>

      <div className="option-section option-advanced">
        <button
          type="button"
          className="option-advanced-toggle"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          aria-expanded={advancedOpen}
        >
          <span>可視コーン・カラー調整</span>
          <ChevronDown
            className={`option-advanced-icon${advancedOpen ? " rotate" : ""}`}
            size={16}
          />
        </button>
        {advancedOpen && (
          <div className="option-advanced-panel">
            <div className="option-subsection">
              <div className="option-section-title">地上局可視円錐</div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>最小仰角しきい値</span>
                  <span>{groundConeMinElevationDeg.toFixed(0)}°</span>
                </div>
                <div className="option-control-inputs">
                  <input
                    className="option-slider"
                    type="range"
                    min={0}
                    max={85}
                    step={1}
                    value={groundConeMinElevationDeg}
                    onChange={(e) => handleGroundConeMinElChange(Number((e.target as HTMLInputElement).value))}
                  />
                  <input
                    className="option-number-input"
                    type="number"
                    min={0}
                    max={85}
                    step={1}
                    value={groundConeMinElevationDeg}
                    onChange={(e) => handleGroundConeMinElChange(Number((e.target as HTMLInputElement).value))}
                  />
                  <span className="option-control-unit">°</span>
                </div>
              </div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>可視距離上限</span>
                  <span>{Math.round(groundConeDistanceKm).toLocaleString()} km</span>
                </div>
                <div className="option-control-inputs">
                  <input
                    className="option-slider"
                    type="range"
                    min={100}
                    max={20000}
                    step={50}
                    value={groundConeDistanceKm}
                    onChange={(e) => handleGroundConeDistanceChange(Number((e.target as HTMLInputElement).value))}
                  />
                  <input
                    className="option-number-input"
                    type="number"
                    min={100}
                    max={20000}
                    step={50}
                    value={groundConeDistanceKm}
                    onChange={(e) => handleGroundConeDistanceChange(Number((e.target as HTMLInputElement).value))}
                  />
                </div>
                <div className="option-control-hint">※地上局からの直線距離（km）で指定します</div>
              </div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>表示カラー</span>
                </div>
                <div className="option-control-inputs">
                  <input
                    className="option-color-input"
                    type="color"
                    value={groundConeColor}
                    onChange={(e) => onGroundConeColorChange((e.target as HTMLInputElement).value)}
                  />
                  <span className="option-color-value">{groundConeColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="option-subsection">
              <div className="option-section-title">衛星ナディア円錐</div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>ナディア角</span>
                  <span>{satelliteConeHalfAngleDeg.toFixed(0)}°</span>
                </div>
                <div className="option-control-inputs">
                  <input
                    className="option-slider"
                    type="range"
                    min={1}
                    max={80}
                    step={1}
                    value={satelliteConeHalfAngleDeg}
                    onChange={(e) => handleSatelliteAngleChange(Number((e.target as HTMLInputElement).value))}
                  />
                  <input
                    className="option-number-input"
                    type="number"
                    min={1}
                    max={80}
                    step={1}
                    value={satelliteConeHalfAngleDeg}
                    onChange={(e) => handleSatelliteAngleChange(Number((e.target as HTMLInputElement).value))}
                  />
                  <span className="option-control-unit">°</span>
                </div>
              </div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>円錐最小高さ</span>
                  <span>
                    {satelliteConeMinHeight.toFixed(2)}R<sub>⊕</sub>
                    （約 {Math.round(satelliteConeMinHeight * EARTH_RADIUS_KM).toLocaleString()} km）
                  </span>
                </div>
                <div className="option-control-hint">※衛星高度に応じて自動的に変化する固定スケールです</div>
              </div>
              <div className="option-control">
                <div className="option-control-label">
                  <span>表示カラー</span>
                </div>
                <div className="option-control-inputs">
                  <input
                    className="option-color-input"
                    type="color"
                    value={satelliteConeColor}
                    onChange={(e) => onSatelliteConeColorChange((e.target as HTMLInputElement).value)}
                  />
                  <span className="option-color-value">{satelliteConeColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="option-subsection">
              <div className="option-section-title">衛星ポイントカラー</div>
              <div className="option-color-grid">
                <div className="option-color-row">
                  <span className="option-color-label">リンク可視</span>
                  <input
                    className="option-color-input"
                    type="color"
                    value={satelliteVisibleColor}
                    onChange={(e) => onSatelliteVisibleColorChange((e.target as HTMLInputElement).value)}
                  />
                  <span className="option-color-value">{satelliteVisibleColor.toUpperCase()}</span>
                </div>
                <div className="option-color-row">
                  <span className="option-color-label">リンク不可</span>
                  <input
                    className="option-color-input"
                    type="color"
                    value={satelliteHiddenColor}
                    onChange={(e) => onSatelliteHiddenColorChange((e.target as HTMLInputElement).value)}
                  />
                  <span className="option-color-value">{satelliteHiddenColor.toUpperCase()}</span>
                </div>
                <div className="option-color-row">
                  <span className="option-color-label">選択中</span>
                  <input
                    className="option-color-input"
                    type="color"
                    value={satelliteSelectedColor}
                    onChange={(e) => onSatelliteSelectedColorChange((e.target as HTMLInputElement).value)}
                  />
                  <span className="option-color-value">{satelliteSelectedColor.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="option-section">
        <div className="option-section-title">KMLインポート</div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              onClick={handleKMLLoad}
              disabled={loading}
              className="flex items-center gap-2"
              variant="secondary"
            >
              <FileInput className="w-4 h-4" />
              {loading ? "読み込み中..." : "KMLファイルを読み込む"}
            </Button>
            {loadedKMLs.length > 0 && (
              <Button
                onClick={handleClearKML}
                variant="ghost"
                className="flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                すべてクリア
              </Button>
            )}
          </div>
          
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">
              {error}
            </div>
          )}
          
          {loadedKMLs.length > 0 && (
            <div className="text-sm text-gray-300">
              <div className="font-semibold mb-1">読み込んだKMLファイル:</div>
              <ul className="list-disc list-inside">
                {loadedKMLs.map((file, index) => (
                  <li key={index}>{file}</li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="text-xs text-gray-400">
            KMLファイルを読み込むと3D地球上にポイント、ライン、ポリゴンを表示できます。
          </div>
        </div>
      </div>
    </div>
  );
}
