import SatelliteSizeControl from "../SatelliteSizeControl";
import EarthTextureSelector from "../EarthTextureSelector";

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
      <SatelliteSizeControl
        value={satRadius}
        onChange={onSatRadiusChange}
      />
      <EarthTextureSelector
        value={earthTexture}
        onChange={onEarthTextureChange}
        style={{ marginTop: 8 }}
      />
      <div style={{ marginTop: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={showGraticule}
            onChange={(e) => onShowGraticuleChange(e.target.checked)}
          />
          <span style={{ marginLeft: 4 }}>Show latitude/longitude lines</span>
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <label>
          <input
            type="checkbox"
            checked={showEcliptic && showSunDirection}
            onChange={(e) => {
              onShowEclipticChange(e.target.checked);
              onShowSunDirectionChange(e.target.checked);
            }}
          />
          <span style={{ marginLeft: 4 }}>Show ecliptic plane</span>
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <label>
          <input
            type="checkbox"
            checked={ecef}
            onChange={(e) => onEcefChange(e.target.checked)}
          />
          <span style={{ marginLeft: 4 }}>ECEF mode</span>
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <label>
          <input
            type="checkbox"
            checked={showPerturbation}
            onChange={(e) => onShowPerturbationChange(e.target.checked)}
          />
          <span style={{ marginLeft: 4 }}>Show perturbation</span>
        </label>
      </div>
      <hr style={{ marginTop: 12, marginBottom: 12 }} />
      <span>Ground Station Visibility Report</span>
      <button onClick={onGenerateReport}>Generate</button>
      <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{reportText}</pre>
    </div>
  );
}