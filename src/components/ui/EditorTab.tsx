import { useRef } from "react";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../../utils/tomlParse";
import { downloadFile, handleFileLoad } from "../../utils/fileUtils";
import { validateSatellites, validateGroundStations } from "../../utils/validators";

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


  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: "0.9em", fontWeight: 500 }}>satellites.toml</span>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              className="editor-icon-button"
              onClick={() => downloadFile("satellites.toml", satText)}
              title="Download"
            >
              💾
            </button>
            <button
              className="editor-icon-button"
              onClick={() => satInputRef.current?.click()}
              title="Open file"
            >
              📂
            </button>
            <button
              className="editor-icon-button"
              onClick={() => onSatTextChange("")}
              title="Clear"
            >
              🗑️
            </button>
            <button
              className="editor-icon-button"
              onClick={onImportClick}
              title="Import from CelesTrak"
            >
              🌐
            </button>
          </div>
        </div>
        <textarea
          value={satText}
          onChange={(e) => onSatTextChange(e.target.value)}
          style={{ width: "100%", height: 80, fontSize: "0.85em", boxSizing: "border-box" }}
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
              className="editor-icon-button"
              onClick={() => downloadFile("constellation.toml", constText)}
              title="Download"
            >
              💾
            </button>
            <button
              className="editor-icon-button"
              onClick={() => constInputRef.current?.click()}
              title="Open file"
            >
              📂
            </button>
            <button
              className="editor-icon-button"
              onClick={() => onConstTextChange("")}
              title="Clear"
            >
              🗑️
            </button>
          </div>
        </div>
        <textarea
          value={constText}
          onChange={(e) => onConstTextChange(e.target.value)}
          style={{ width: "100%", height: 80, fontSize: "0.85em", boxSizing: "border-box" }}
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
              className="editor-icon-button"
              onClick={() => downloadFile("groundstations.toml", gsText)}
              title="Download"
            >
              💾
            </button>
            <button
              className="editor-icon-button"
              onClick={() => gsInputRef.current?.click()}
              title="Open file"
            >
              📂
            </button>
            <button
              className="editor-icon-button"
              onClick={() => onGsTextChange("")}
              title="Clear"
            >
              🗑️
            </button>
          </div>
        </div>
        <textarea
          value={gsText}
          onChange={(e) => onGsTextChange(e.target.value)}
          style={{ width: "100%", height: 80, fontSize: "0.85em", boxSizing: "border-box" }}
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
          className="editor-action-button"
          onClick={onSaveBundle}
        >
          Save All
        </button>
        <button 
          className="editor-action-button" 
          onClick={() => bundleInputRef.current?.click()}
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
          style={{ width: "100%", fontSize: "0.85em", boxSizing: "border-box" }}
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