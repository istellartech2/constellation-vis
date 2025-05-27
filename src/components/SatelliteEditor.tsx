import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as satellite from "satellite.js";
import type { SatelliteSpec } from "../data/satellites";
import { toSatrec } from "../data/satellites";
import type { GroundStation } from "../data/groundStations";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../utils/tomlParse";

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
ground stations and constellations.\n\nClick Update to apply changes.\n\nSelect the Report tab to generate ground station visibility information.`;

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
}

export default function SatelliteEditor({ onUpdate }: Props) {
  const [satText, setSatText] = useState("");
  const [constText, setConstText] = useState("");
  const [gsText, setGsText] = useState("");
  const [startText, setStartText] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"editor" | "report" | "help">("editor");
  const [reportText, setReportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const satInputRef = useRef<HTMLInputElement | null>(null);
  const constInputRef = useRef<HTMLInputElement | null>(null);
  const gsInputRef = useRef<HTMLInputElement | null>(null);

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


  function generateVisibilityReport(
    sats: SatelliteSpec[],
    stations: GroundStation[],
    date: Date,
  ): string {
    const satRecs = sats.map((s) => toSatrec(s));
    const observerGds = stations.map((gs) => ({
      longitude: satellite.degreesToRadians(gs.longitudeDeg),
      latitude: satellite.degreesToRadians(gs.latitudeDeg),
      height: gs.heightKm,
    }));
    const minEl = stations.map((gs) =>
      THREE.MathUtils.degToRad(gs.minElevationDeg),
    );

    const header = ["Time", ...stations.map((s) => s.name)].join(",");
    const lines: string[] = [header];

    const startMs = date.getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000; // one day

    for (let ms = startMs, t = 0; ms <= endMs; ms += 10000, t += 10) {
      const current = new Date(ms);
      const gmst = satellite.gstime(current);

      const counts = stations.map(() => 0);

      satRecs.forEach((rec) => {
        const pv = satellite.propagate(rec, current);
        if (!pv?.position) return;
        const ecf = satellite.eciToEcf(pv.position, gmst);
        stations.forEach((_, gi) => {
          const look = satellite.ecfToLookAngles(observerGds[gi], ecf);
          if (look.elevation > minEl[gi]) counts[gi]++;
        });
      });

      lines.push([String(t), ...counts.map(String)].join(","));
    }

    return lines.join("\n");
  }

  useEffect(() => {
    fetch("/satellites.toml")
      .then((r) => r.text())
      .then(setSatText);
    fetch("/constellation.toml")
      .then((r) => r.text())
      .then(setConstText)
      .catch(() => setConstText(""));
    fetch("/groundstations.toml")
      .then((r) => r.text())
      .then(setGsText)
      .catch(() => setGsText(""));
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
    } catch (e) {
      alert("Failed to generate report: " + (e as Error).message);
    }
  };

  return (
    <>
      {importOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace",
          }}
        >
          <div style={{ background: "rgba(0,0,0,0.8)", padding: 16 }}>
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
                <button
                  onClick={() => setImportOpen(false)}
                  style={{ marginRight: 8 }}
                >
                  Cancel
                </button>
                <button onClick={handleImport}>Import</button>
              </div>
            )}
          </div>
        </div>
      )}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            border: "none",
            padding: "4px 8px",
            fontSize: "1.2rem",
            zIndex: 30,
          }}
        >
          ☰
        </button>
      )}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100%",
          width: 300,
          maxWidth: "80%",
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          padding: 8,
          fontFamily: "monospace",
          zIndex: 20,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease-out",
          boxSizing: "border-box",
        }}
      >
        <button
          onClick={() => setOpen(false)}
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            background: "transparent",
            border: "none",
            color: "#fff",
            fontSize: "1.2rem",
          }}
        >
          ✕
        </button>
        <div style={{ paddingTop: 36 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button
              onClick={() => setTab("editor")}
              style={{
                background: tab === "editor" ? "#1976d2" : "transparent",
                color: "#fff",
                border: "none",
                padding: "4px 8px",
              }}
            >
              Editor
            </button>
            <button
              onClick={() => setTab("report")}
              style={{
                background: tab === "report" ? "#1976d2" : "transparent",
                color: "#fff",
                border: "none",
                padding: "4px 8px",
              }}
            >
              Report
            </button>
            <button
              onClick={() => setTab("help")}
              style={{
                background: tab === "help" ? "#1976d2" : "transparent",
                color: "#fff",
                border: "none",
                padding: "4px 8px",
              }}
            >
              Help
            </button>
          </div>
          {tab === "editor" && (
            <>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <span>satellites.toml</span>
                <textarea
                  value={satText}
                  onChange={(e) => setSatText(e.target.value)}
                  style={{ width: "98%", height: 80 }}
                />
                <div style={{ flexBasis: "100%", height: 0 }} />
                <button
                  onClick={() => downloadFile("satellites.toml", satText)}
                  style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                >
                  💾
                </button>
                <button
                  onClick={() => satInputRef.current?.click()}
                  style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                >
                  📂
                </button>
                <button
                  onClick={() => setSatText("")}
                  style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                >
                  🗑️
                </button>
                <button
                  onClick={() => setImportOpen(true)}
                  style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                >
                  🌐
                </button>
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

              <hr style={{ marginTop: 8, marginBottom: 8 }} />
              <div style={{ marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                  <span>constellation.toml</span>
                  <textarea
                    value={constText}
                    onChange={(e) => setConstText(e.target.value)}
                    style={{ width: "98%", height: 80 }}
                  />
                  <div style={{ flexBasis: "100%", height: 0 }} />
                  <button
                    onClick={() => downloadFile("constellation.toml", constText)}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    💾
                  </button>
                  <button
                    onClick={() => constInputRef.current?.click()}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    📂
                  </button>
                  <button
                    onClick={() => setConstText("")}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    🗑️
                  </button>
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
              </div>
              <hr style={{ marginTop: 8, marginBottom: 8 }} />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                  <span>groundstations.toml</span>
                  <textarea
                    value={gsText}
                    onChange={(e) => setGsText(e.target.value)}
                    style={{ width: "98%", height: 100 }}
                  />
                  <div style={{ flexBasis: "100%", height: 0 }} />
                  <button
                    onClick={() => downloadFile("groundstations.toml", gsText)}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    💾
                  </button>
                  <button
                    onClick={() => gsInputRef.current?.click()}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    📂
                  </button>
                  <button
                    onClick={() => setGsText("")}
                    style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
                  >
                    🗑️
                  </button>
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
              </div>
              <hr style={{ marginTop: 8, marginBottom: 8 }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <label>
                  Simulation start (UTC)
                  <input
                    type="datetime-local"
                    value={startText}
                    onChange={(e) => setStartText(e.target.value)}
                    style={{ width: "98%" }}
                  />
                </label>
              </div>
              <hr style={{ marginTop: 12, marginBottom: 6 }} />
              <button
                onClick={handleUpdate}
                style={{
                  marginTop: 8,
                  padding: "8px 20px",
                  background: "#1976d2",
                  color: "#fff",
                  border: "none",
                  fontWeight: "bold",
                }}
              >
                Update
              </button>
            </>
          )}
          {tab === "report" && (
            <div>
              <button onClick={handleGenerateReport}>Generate</button>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{reportText}</pre>
            </div>
          )}
          {tab === "help" && (
            <div style={{ whiteSpace: "pre-wrap" }}>{HELP_TEXT}</div>
          )}
        </div>
      </div>
    </>
  );
}
