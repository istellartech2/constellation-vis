import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import { Checkbox } from "./checkbox";
import { Label } from "./label";

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
}: Props) {
  return (
    <div>
      <div className="option-section">
        <div className="option-section-title">Visualization Controls</div>
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
        <div className="option-section-title">Display Options</div>
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
              Show latitude/longitude lines
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
              Show ecliptic plane
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
              ECEF mode
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
              Show perturbation
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
}