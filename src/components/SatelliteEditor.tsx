import { useEffect, useState } from "react";
import type { SatelliteSpec } from "../satellites";
import type { GroundStation } from "../groundStations";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../utils/tomlParse";

interface Props {
  onUpdate: (sats: SatelliteSpec[], stations: GroundStation[]) => void;
}

export default function SatelliteEditor({ onUpdate }: Props) {
  const [satText, setSatText] = useState("");
  const [constText, setConstText] = useState("");
  const [gsText, setGsText] = useState("");
  const [open, setOpen] = useState(false);

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
      onUpdate([...base, ...con], gs);
    } catch (e) {
      alert("Failed to parse files: " + (e as Error).message);
    }
  };

  return (
    <>
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
        <div style={{ paddingTop: 24 }}>
          <div>satellites.toml</div>
          <textarea
            value={satText}
            onChange={(e) => setSatText(e.target.value)}
            style={{ width: "100%", height: 80 }}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <div>constellation.toml</div>
          <textarea
            value={constText}
            onChange={(e) => setConstText(e.target.value)}
            style={{ width: "100%", height: 80 }}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <div>groundstations.toml</div>
          <textarea
            value={gsText}
            onChange={(e) => setGsText(e.target.value)}
            style={{ width: "100%", height: 80 }}
          />
        </div>
        <button onClick={handleUpdate} style={{ marginTop: 4 }}>
          Update
        </button>
      </div>
    </>
  );
}
