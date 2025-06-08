import { useEffect, useState } from "react";
import type { SatelliteSpec } from "../../lib/satellites";
import type { GroundStation } from "../../lib/groundStations";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../../utils/tomlParse";
import {
  parseConfigBundle,
  buildConfigBundle,
} from "../../utils/configBundle";
import EditorTab from "./EditorTab";
import AnalysisTab from "./AnalysisTab";
import OptionTab from "./OptionTab";
import ImportDialog from "./ImportDialog";
import { celestrakEntryToSat, satellitesToToml, getCelestrakUrl } from "../../utils/celestrakUtils";
import { downloadFile } from "../../utils/fileUtils";
import { validateSatellites, validateGroundStations } from "../../utils/validators";

/**
 * Editor side panel allowing the user to load, edit and save TOML files
 * describing satellites, constellations and ground stations. The parsed
 * data is fed back into the visualization via the provided `onUpdate`
 * callback.
 */

interface Props {
  /**
   * Called when the user clicks Update. Provides the parsed satellite list,
   * ground station list and simulation start time back to the parent
   * component.
   */
  onUpdate: (
    sats: SatelliteSpec[],
    stations: GroundStation[],
    startTime: Date,
  ) => void;
  /** Current satellite draw radius */
  satRadius: number;
  /** Called when satellite size is changed */
  onSatRadiusChange: (r: number) => void;
  /** Current earth texture URL */
  earthTexture: string;
  /** Called when earth texture is changed */
  onEarthTextureChange: (t: string) => void;
  /** Show or hide graticule */
  showGraticule: boolean;
  /** Called when graticule visibility changes */
  onShowGraticuleChange: (v: boolean) => void;
  /** Show or hide ecliptic plane */
  showEcliptic: boolean;
  /** Called when ecliptic visibility changes */
  onShowEclipticChange: (v: boolean) => void;
  /** Show or hide sun direction marker */
  showSunDirection: boolean;
  /** Called when sun direction visibility changes */
  onShowSunDirectionChange: (v: boolean) => void;
  /** Display scene in Earth-fixed (ECEF) mode */
  ecef: boolean;
  /** Called when ECEF mode changes */
  onEcefChange: (v: boolean) => void;
  /** Show perturbation information */
  showPerturbation: boolean;
  /** Called when perturbation visibility changes */
  onShowPerturbationChange: (v: boolean) => void;
  /** Called when analysis is started (to pause animation) */
  onAnalysisStart?: () => void;
  /** Called when analysis is closed (to resume animation) */
  onAnalysisEnd?: () => void;
}

export default function SatelliteEditor({
  onUpdate,
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
  onAnalysisStart,
  onAnalysisEnd,
}: Props) {
  const [satText, setSatText] = useState("");
  const [constText, setConstText] = useState("");
  const [gsText, setGsText] = useState("");
  const [startText, setStartText] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"editor" | "analysis" | "option">("editor");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);


  function toggleGroup(g: string) {
    setSelectedGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  // Fetch orbital data for the selected CelesTrak groups and merge it
  // with whatever the user already has in the satellites text area.
  async function handleImport() {
    setImporting(true);
    const errors: string[] = [];
    
    try {
      const base = parseSatellitesToml(satText);
      
      for (const g of selectedGroups) {
        try {
          const url = getCelestrakUrl(g);
          const resp = await fetch(url);
          
          if (!resp.ok) {
            errors.push(`HTTP ${resp.status} for group "${g}"`);
            continue;
          }
          
          const text = await resp.text();
          
          // Check if response is valid JSON
          if (text.startsWith('Invalid query:') || text.startsWith('Error:')) {
            errors.push(`Invalid group "${g}": ${text}`);
            continue;
          }
          
          let data;
          try {
            data = JSON.parse(text);
          } catch (jsonError) {
            errors.push(`Invalid JSON response for group "${g}"`);
            continue;
          }
          
          if (!Array.isArray(data)) {
            errors.push(`Expected array for group "${g}", got ${typeof data}`);
            continue;
          }
          
          for (const e of data) {
            try {
              base.push(celestrakEntryToSat(e));
            } catch (conversionError) {
              console.warn(`Failed to convert entry for group "${g}":`, conversionError);
            }
          }
        } catch (groupError) {
          errors.push(`Error processing group "${g}": ${(groupError as Error).message}`);
        }
      }
      
      setSatText(satellitesToToml(base));
      
      if (errors.length > 0) {
        alert(`Import completed with errors:\n${errors.join('\n')}`);
      }
    } catch (e) {
      alert("Failed to import satellites: " + (e as Error).message);
    } finally {
      setImporting(false);
      setImportOpen(false);
      setSelectedGroups([]);
    }
  }




  useEffect(() => {
    // Load satellites.toml
    fetch(import.meta.env.BASE_URL + 'satellites.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load satellites.toml: ${r.status}`);
        return r.text();
      })
      .then(setSatText)
      .catch((error) => {
        console.error('Error loading satellites.toml:', error);
        setSatText("# Failed to load default satellites.toml\n# Please manually enter satellite data");
      });

    // Load constellation.toml
    fetch(import.meta.env.BASE_URL + 'constellation.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load constellation.toml: ${r.status}`);
        return r.text();
      })
      .then(setConstText)
      .catch((error) => {
        console.error('Error loading constellation.toml:', error);
        setConstText("# Failed to load default constellation.toml\n# This file is optional");
      });

    // Load groundstations.toml
    fetch(import.meta.env.BASE_URL + 'groundstations.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load groundstations.toml: ${r.status}`);
        return r.text();
      })
      .then(setGsText)
      .catch((error) => {
        console.error('Error loading groundstations.toml:', error);
        setGsText("# Failed to load default groundstations.toml\n# Please manually enter ground station data");
      });
  }, []);

  const handleUpdate = () => {
    try {
      const base = parseSatellitesToml(satText);
      const con = constText ? parseConstellationToml(constText) : [];
      const gs = parseGroundStationsToml(gsText);
      validateSatellites([...base, ...con]);
      validateGroundStations(gs);
      onUpdate([...base, ...con], gs, new Date(startText));
    } catch (e) {
      alert("Failed to parse files: " + (e as Error).message);
    }
  };


  const handleSaveBundle = () => {
    const bundle = buildConfigBundle(
      satText,
      constText,
      gsText,
      new Date(startText),
    );
    downloadFile("settings.toml", bundle);
  };

  async function handleBundleFile(file: File) {
    const text = await file.text();
    try {
      const parsed = parseConfigBundle(text);
      validateSatellites(parsed.satellites);
      validateGroundStations(parsed.groundStations);
      setSatText(parsed.satText);
      setConstText(parsed.constText);
      setGsText(parsed.gsText);
      setStartText(parsed.startTime.toISOString().slice(0, 16));
    } catch (e) {
      alert("Invalid file: " + (e as Error).message);
    }
  }

  return (
    <>
      <ImportDialog
        open={importOpen}
        importing={importing}
        selectedGroups={selectedGroups}
        onToggleGroup={toggleGroup}
        onImport={handleImport}
        onClose={() => setImportOpen(false)}
      />
      {!open && (
        <button className="side-panel-button" onClick={() => setOpen(true)}>
          ☰
        </button>
      )}
      <div className={`side-panel ${open ? "" : "closed"}`}>
        <button className="side-panel-close" onClick={() => setOpen(false)}>
          ✕
        </button>
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 8, marginRight: 50 }}>
            <button
              className={`tab-button ${tab === "editor" ? "active" : ""}`}
              onClick={() => setTab("editor")}
            >
              Editor
            </button>
            <button
              className={`tab-button ${tab === "analysis" ? "active" : ""}`}
              onClick={() => setTab("analysis")}
            >
              Analysis
            </button>
            <button
              className={`tab-button ${tab === "option" ? "active" : ""}`}
              onClick={() => setTab("option")}
            >
              Option
            </button>
          </div>
          <div className="tab-content">
          {tab === "editor" && (
            <EditorTab
              satText={satText}
              constText={constText}
              gsText={gsText}
              startText={startText}
              onSatTextChange={setSatText}
              onConstTextChange={setConstText}
              onGsTextChange={setGsText}
              onStartTextChange={setStartText}
              onImportClick={() => setImportOpen(true)}
              onUpdate={handleUpdate}
              onSaveBundle={handleSaveBundle}
              onLoadBundle={handleBundleFile}
            />
          )}
          {tab === "analysis" && (
            <AnalysisTab
              satText={satText}
              constText={constText}
              gsText={gsText}
              startTime={new Date(startText)}
              onAnalysisStart={onAnalysisStart}
              onAnalysisEnd={onAnalysisEnd}
            />
          )}
          {tab === "option" && (
            <OptionTab
              satRadius={satRadius}
              onSatRadiusChange={onSatRadiusChange}
              earthTexture={earthTexture}
              onEarthTextureChange={onEarthTextureChange}
              showGraticule={showGraticule}
              onShowGraticuleChange={onShowGraticuleChange}
              showEcliptic={showEcliptic}
              onShowEclipticChange={onShowEclipticChange}
              showSunDirection={showSunDirection}
              onShowSunDirectionChange={onShowSunDirectionChange}
              ecef={ecef}
              onEcefChange={onEcefChange}
              showPerturbation={showPerturbation}
              onShowPerturbationChange={onShowPerturbationChange}
            />
          )}
          </div>
        </div>
      </div>
    </>
  );
}
