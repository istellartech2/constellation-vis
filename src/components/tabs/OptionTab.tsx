import SatelliteSizeControl from "../SatelliteSizeControl";
import EarthTextureSelector from "../EarthTextureSelector";
import "../../styles.css";

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
  reportText: string;
  onGenerateReport: () => void;
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
  reportText,
  onGenerateReport,
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
        <div className="option-checkbox-group">
          <label className="option-checkbox-item">
            <input
              type="checkbox"
              checked={showGraticule}
              onChange={(e) => onShowGraticuleChange(e.target.checked)}
            />
            <span>Show latitude/longitude lines</span>
          </label>
          <label className="option-checkbox-item">
            <input
              type="checkbox"
              checked={showEcliptic && showSunDirection}
              onChange={(e) => {
                onShowEclipticChange(e.target.checked);
                onShowSunDirectionChange(e.target.checked);
              }}
            />
            <span>Show ecliptic plane</span>
          </label>
          <label className="option-checkbox-item">
            <input
              type="checkbox"
              checked={ecef}
              onChange={(e) => onEcefChange(e.target.checked)}
            />
            <span>ECEF mode</span>
          </label>
          <label className="option-checkbox-item">
            <input
              type="checkbox"
              checked={showPerturbation}
              onChange={(e) => onShowPerturbationChange(e.target.checked)}
            />
            <span>Show perturbation</span>
          </label>
        </div>
      </div>
    </div>
  );
}