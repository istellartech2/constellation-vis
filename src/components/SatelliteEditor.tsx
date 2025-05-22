import { useEffect, useState } from "react";
import type { SatelliteSpec } from "../satellites";
import { parseSatellitesToml, parseConstellationToml } from "../utils/tomlParse";

interface Props {
  onUpdate: (sats: SatelliteSpec[]) => void;
}

export default function SatelliteEditor({ onUpdate }: Props) {
  const [satText, setSatText] = useState("");
  const [constText, setConstText] = useState("");

  useEffect(() => {
    fetch("/satellites.toml")
      .then((r) => r.text())
      .then(setSatText);
    fetch("/constellation.toml")
      .then((r) => r.text())
      .then(setConstText)
      .catch(() => setConstText(""));
  }, []);

  const handleUpdate = () => {
    try {
      const base = parseSatellitesToml(satText);
      const con = constText ? parseConstellationToml(constText) : [];
      onUpdate([...base, ...con]);
    } catch (e) {
      alert("Failed to parse files: " + (e as Error).message);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 8,
        top: 8,
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        padding: 8,
        fontFamily: "monospace",
        zIndex: 20,
        maxWidth: 300,
      }}
    >
      <div>
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
      <button onClick={handleUpdate} style={{ marginTop: 4 }}>
        Update
      </button>
    </div>
  );
}
