import { useEffect, useRef, useState } from "react";
import type { SatelliteSpec } from "../data/satellites";
import { generateVisibilityReport } from "../utils/visibility";
import type { GroundStation } from "../data/groundStations";
import SatelliteSizeControl from "./SatelliteSizeControl";
import EarthTextureSelector from "./EarthTextureSelector";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../utils/tomlParse";
import {
  parseConfigBundle,
  buildConfigBundle,
} from "../utils/configBundle";

/**
 * Editor side panel allowing the user to load, edit and save TOML files
 * describing satellites, constellations and ground stations. The parsed
 * data is fed back into the visualization via the provided `onUpdate`
 * callback.
 */

const CELESTRACK_GROUPS = [
  { label: "Last 30 Days' Launches", group: "last-30-days" },
  { label: "Space Stations", group: "stations" },
  { label: "Active GEO", group: "geo" },
  { label: "Weather", group: "weather" },
  { label: "GNSS", group: "gnss" },
  { label: "Starlink", group: "starlink" },
  { label: "Oneweb", group: "oneweb" },
] as const;

const HELP_TEXT = `\
Use this panel to edit or load TOML files defining satellites,\
ground stations and constellations.\n\nClick Update to apply changes.\n\nSelect the Option tab to adjust settings and generate ground station visibility information.`;

const MU = 398600.4418; // km^3/s^2

interface CelestrakEntry {
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  NORAD_CAT_ID: number;
  EPOCH: string;
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
}

// Convert an entry from the CelesTrak API into our internal satellite
// representation (classical orbital elements).
function celestrakEntryToSat(entry: CelestrakEntry): SatelliteSpec {
  const mm = Number(entry.MEAN_MOTION);
  const n = (mm * 2 * Math.PI) / 86400; // rad/s
  const a = Math.pow(MU / (n * n), 1 / 3);
  return {
    type: "elements",
    elements: {
      satnum: Number(entry.NORAD_CAT_ID),
      epoch: new Date(String(entry.EPOCH)),
      semiMajorAxisKm: a,
      eccentricity: Number(entry.ECCENTRICITY),
      inclinationDeg: Number(entry.INCLINATION),
      raanDeg: Number(entry.RA_OF_ASC_NODE),
      argPerigeeDeg: Number(entry.ARG_OF_PERICENTER),
      meanAnomalyDeg: Number(entry.MEAN_ANOMALY),
    },
    meta: {
      objectName: entry.OBJECT_NAME,
      objectId: entry.OBJECT_ID,
      noradCatId: Number(entry.NORAD_CAT_ID),
    },
  };
}

// Helper to convert our satellite list back into TOML so it can be saved
// to disk or shared with other tools.
function satellitesToToml(list: SatelliteSpec[]): string {
  return list
    .map((s) => {
      const meta = s.meta
        ? ((s.meta.objectName ? `name = ${JSON.stringify(s.meta.objectName)}\n` : "") +
            (s.meta.objectId ? `objectId = ${JSON.stringify(s.meta.objectId)}\n` : "") +
            (s.meta.noradCatId !== undefined ? `noradCatId = ${s.meta.noradCatId}\n` : ""))
        : "";
      if (s.type === "tle") {
        return (
          "[[satellites]]\n" +
          'type = "tle"\n' +
          meta +
          `line1 = ${JSON.stringify(s.lines[0])}\n` +
          `line2 = ${JSON.stringify(s.lines[1])}`
        );
      }
      const e = s.elements;
      return (
        "[[satellites]]\n" +
        'type = "elements"\n' +
        meta +
        `satnum = ${e.satnum}\n` +
        `epoch = ${JSON.stringify(e.epoch.toISOString())}\n` +
        `semiMajorAxisKm = ${e.semiMajorAxisKm}\n` +
        `eccentricity = ${e.eccentricity}\n` +
        `inclinationDeg = ${e.inclinationDeg}\n` +
        `raanDeg = ${e.raanDeg}\n` +
        `argPerigeeDeg = ${e.argPerigeeDeg}\n` +
        `meanAnomalyDeg = ${e.meanAnomalyDeg}`
      );
    })
    .join("\n\n");
}

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
  const [tab, setTab] = useState<"editor" | "option" | "help">("editor");
  const [reportText, setReportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const satInputRef = useRef<HTMLInputElement | null>(null);
  const constInputRef = useRef<HTMLInputElement | null>(null);
  const gsInputRef = useRef<HTMLInputElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);

  function downloadFile(name: string, text: string) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Read a user-provided file, parse it and update the corresponding
  // text box. Optional validation logic can be supplied to reject
  // invalid input before it reaches the state.
  async function handleFileLoad<T>(
    file: File,
    setter: (t: string) => void,
    parser: (t: string) => T,
    validator?: (v: T) => void,
  ) {
    const text = await file.text();
    try {
      const parsed = parser(text);
      if (validator) validator(parsed);
      setter(text);
    } catch (e) {
      alert("Invalid file: " + (e as Error).message);
    }
  }

  function toggleGroup(g: string) {
    setSelectedGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  // Fetch orbital data for the selected CelesTrak groups and merge it
  // with whatever the user already has in the satellites text area.
  async function handleImport() {
    setImporting(true);
    try {
      const base = parseSatellitesToml(satText);
      for (const g of selectedGroups) {
        const url =
          "https://celestrak.org/NORAD/elements/gp.php?GROUP=" +
          g +
          "&FORMAT=json";
        const resp = await fetch(url);
        const data = await resp.json();
        for (const e of data) {
          base.push(celestrakEntryToSat(e));
        }
      }
      setSatText(satellitesToToml(base));
    } catch (e) {
      alert("Failed to import satellites: " + (e as Error).message);
    } finally {
      setImporting(false);
      setImportOpen(false);
      setSelectedGroups([]);
    }
  }

  function validateSatellites(list: SatelliteSpec[]) {
    for (const s of list) {
      if (s.type === "tle") {
        if (!s.lines[0] || !s.lines[1]) {
          throw new Error("satellites.toml: missing TLE lines");
        }
      } else if (s.type === "elements") {
        const e = s.elements;
        if (
          e.satnum === undefined ||
          !(e.epoch instanceof Date) ||
          Number.isNaN(e.semiMajorAxisKm) ||
          Number.isNaN(e.eccentricity) ||
          Number.isNaN(e.inclinationDeg) ||
          Number.isNaN(e.raanDeg) ||
          Number.isNaN(e.argPerigeeDeg) ||
          Number.isNaN(e.meanAnomalyDeg)
        ) {
          throw new Error("satellites.toml: incomplete elements entry");
        }
      }
    }
  }

  function validateGroundStations(list: GroundStation[]) {
    for (const g of list) {
      if (!g.name || Number.isNaN(g.latitudeDeg) || Number.isNaN(g.longitudeDeg)) {
        throw new Error("groundstations.toml: missing required fields");
      }
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

  const handleGenerateReport = () => {
    try {
      const base = parseSatellitesToml(satText);
      const con = constText ? parseConstellationToml(constText) : [];
      const gs = parseGroundStationsToml(gsText);
      validateSatellites([...base, ...con]);
      validateGroundStations(gs);
      const text = generateVisibilityReport(
        [...base, ...con],
        gs,
        new Date(startText),
      );
      setReportText(text);
      downloadFile("report.csv", text);
    } catch (e) {
      alert("Failed to generate report: " + (e as Error).message);
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
      {importOpen && (
        <div className="overlay">
          <div className="overlay-box">
            <h3 style={{ marginTop: 0 }}>Import from CelesTrak</h3>
            {CELESTRACK_GROUPS.map(({ label, group }) => (
              <label key={group} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  disabled={importing}
                  checked={selectedGroups.includes(group)}
                  onChange={() => toggleGroup(group)}
                />
                <span style={{ marginLeft: 4 }}>{label}</span>
              </label>
            ))}
            {importing ? (
              <div style={{ marginTop: 8, textAlign: "center" }}>Loading...</div>
            ) : (
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <button onClick={() => setImportOpen(false)} style={{ marginRight: 8 }}>
                  Cancel
                </button>
                <button onClick={handleImport}>Import</button>
              </div>
            )}
          </div>
        </div>
      )}
      {!open && (
        <button className="side-panel-button" onClick={() => setOpen(true)}>
          ☰
        </button>
      )}
      <div className={`side-panel ${open ? "" : "closed"}`}>
        <button className="side-panel-close" onClick={() => setOpen(false)}>
          ✕
        </button>
        <div style={{ paddingTop: 36 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button
              className={`tab-button ${tab === "editor" ? "active" : ""}`}
              onClick={() => setTab("editor")}
            >
              Editor
            </button>
            <button
              className={`tab-button ${tab === "option" ? "active" : ""}`}
              onClick={() => setTab("option")}
            >
              Option
            </button>
            <button
              className={`tab-button ${tab === "help" ? "active" : ""}`}
              onClick={() => setTab("help")}
            >
              Help
            </button>
          </div>
          <div className="tab-content">
          {tab === "editor" && (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.9em", fontWeight: 500 }}>satellites.toml</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      onClick={() => downloadFile("satellites.toml", satText)}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Download"
                    >
                      💾
                    </button>
                    <button
                      onClick={() => satInputRef.current?.click()}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Open file"
                    >
                      📂
                    </button>
                    <button
                      onClick={() => setSatText("")}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Clear"
                    >
                      🗑️
                    </button>
                    <button
                      onClick={() => setImportOpen(true)}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Import from CelesTrak"
                    >
                      🌐
                    </button>
                  </div>
                </div>
                <textarea
                  value={satText}
                  onChange={(e) => setSatText(e.target.value)}
                  style={{ width: "100%", height: 60, fontSize: "0.85em" }}
                />
                <input
                  ref={satInputRef}
                  type="file"
                  accept=".toml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileLoad(f, setSatText, parseSatellitesToml, validateSatellites);
                    e.target.value = "";
                  }}
                />
              </div>

              <hr className="hr-dashed" style={{ margin: "8px 0" }} />
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.9em", fontWeight: 500 }}>constellation.toml</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      onClick={() => downloadFile("constellation.toml", constText)}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Download"
                    >
                      💾
                    </button>
                    <button
                      onClick={() => constInputRef.current?.click()}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Open file"
                    >
                      📂
                    </button>
                    <button
                      onClick={() => setConstText("")}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Clear"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <textarea
                  value={constText}
                  onChange={(e) => setConstText(e.target.value)}
                  style={{ width: "100%", height: 60, fontSize: "0.85em" }}
                />
                <input
                  ref={constInputRef}
                  type="file"
                  accept=".toml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileLoad(f, setConstText, parseConstellationToml, validateSatellites);
                    e.target.value = "";
                  }}
                />
              </div>
              <hr className="hr-dashed" style={{ margin: "8px 0" }} />
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.9em", fontWeight: 500 }}>groundstations.toml</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      onClick={() => downloadFile("groundstations.toml", gsText)}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Download"
                    >
                      💾
                    </button>
                    <button
                      onClick={() => gsInputRef.current?.click()}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Open file"
                    >
                      📂
                    </button>
                    <button
                      onClick={() => setGsText("")}
                      style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
                      title="Clear"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <textarea
                  value={gsText}
                  onChange={(e) => setGsText(e.target.value)}
                  style={{ width: "100%", height: 60, fontSize: "0.85em" }}
                />
                <input
                  ref={gsInputRef}
                  type="file"
                  accept=".toml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileLoad(f, setGsText, parseGroundStationsToml, validateGroundStations);
                    e.target.value = "";
                  }}
                />
              </div>
              <hr className="hr-dashed" style={{ margin: "8px 0" }} />
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <button
                  className="secondary"
                  onClick={handleSaveBundle}
                  style={{ fontSize: "0.85em", padding: "4px 10px" }}
                >
                  Save All
                </button>
                <button 
                  className="secondary" 
                  onClick={() => bundleInputRef.current?.click()}
                  style={{ fontSize: "0.85em", padding: "4px 10px" }}
                >
                  Load All
                </button>
                <input
                  ref={bundleInputRef}
                  type="file"
                  accept=".toml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleBundleFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <hr style={{ margin: "8px 0" }} />
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: "0.9em", fontWeight: 500, display: "block", marginBottom: 4 }}>
                  Simulation start (UTC)
                </label>
                <input
                  type="datetime-local"
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  style={{ width: "100%", fontSize: "0.85em" }}
                />
              </div>
              <hr style={{ margin: "8px 0" }} />
              <button
                className="primary"
                onClick={handleUpdate}
                style={{
                  padding: "6px 16px",
                  fontWeight: "bold",
                  fontSize: "0.9em",
                  width: "100%"
                }}
              >
                Update
              </button>
            </>
          )}
          {tab === "option" && (
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
              <hr style={{ marginTop: 12, marginBottom: 12 }} />
              <span>Ground Station Visibility Report</span>
              <button onClick={handleGenerateReport}>Generate</button>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{reportText}</pre>
            </div>
          )}
          {tab === "help" && (
            <div style={{ whiteSpace: "pre-wrap" }}>{HELP_TEXT}</div>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
