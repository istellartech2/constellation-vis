import { useRef } from "react";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../../utils/tomlParse";
import type { SatelliteSpec } from "../../data/satellites";
import type { GroundStation } from "../../data/groundStations";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startText: string;
  onSatTextChange: (text: string) => void;
  onConstTextChange: (text: string) => void;
  onGsTextChange: (text: string) => void;
  onStartTextChange: (text: string) => void;
  onImportClick: () => void;
  onUpdate: () => void;
  onSaveBundle: () => void;
  onLoadBundle: (file: File) => void;
}

export default function EditorTab({
  satText,
  constText,
  gsText,
  startText,
  onSatTextChange,
  onConstTextChange,
  onGsTextChange,
  onStartTextChange,
  onImportClick,
  onUpdate,
  onSaveBundle,
  onLoadBundle,
}: Props) {
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

  return (
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
              onClick={() => onSatTextChange("")}
              style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
              title="Clear"
            >
              🗑️
            </button>
            <button
              onClick={onImportClick}
              style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
              title="Import from CelesTrak"
            >
              🌐
            </button>
          </div>
        </div>
        <textarea
          value={satText}
          onChange={(e) => onSatTextChange(e.target.value)}
          style={{ width: "100%", height: 60, fontSize: "0.85em" }}
        />
        <input
          ref={satInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onSatTextChange, parseSatellitesToml, validateSatellites);
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
              onClick={() => onConstTextChange("")}
              style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
              title="Clear"
            >
              🗑️
            </button>
          </div>
        </div>
        <textarea
          value={constText}
          onChange={(e) => onConstTextChange(e.target.value)}
          style={{ width: "100%", height: 60, fontSize: "0.85em" }}
        />
        <input
          ref={constInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onConstTextChange, parseConstellationToml, validateSatellites);
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
              onClick={() => onGsTextChange("")}
              style={{ background: "transparent", border: "none", color: "#fff", padding: "2px 6px", fontSize: "0.9em" }}
              title="Clear"
            >
              🗑️
            </button>
          </div>
        </div>
        <textarea
          value={gsText}
          onChange={(e) => onGsTextChange(e.target.value)}
          style={{ width: "100%", height: 60, fontSize: "0.85em" }}
        />
        <input
          ref={gsInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onGsTextChange, parseGroundStationsToml, validateGroundStations);
            e.target.value = "";
          }}
        />
      </div>
      
      <hr className="hr-dashed" style={{ margin: "8px 0" }} />
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <button
          className="secondary"
          onClick={onSaveBundle}
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
            if (f) onLoadBundle(f);
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
          onChange={(e) => onStartTextChange(e.target.value)}
          style={{ width: "100%", fontSize: "0.85em" }}
        />
      </div>
      
      <hr style={{ margin: "8px 0" }} />
      <button
        className="primary"
        onClick={onUpdate}
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
  );
}