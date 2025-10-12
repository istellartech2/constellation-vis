import { useState, type RefObject } from "react";
import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { FileInput, Trash2 } from "lucide-react";
import type SatelliteScene from "../../lib/visualization";

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
