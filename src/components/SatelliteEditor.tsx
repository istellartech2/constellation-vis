import { useEffect, useRef, useState } from "react";
import type { SatelliteSpec } from "../satellites";
import type { GroundStation } from "../groundStations";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../utils/tomlParse";

const CELESTRACK_GROUPS = [
  { label: "Last 30 Days' Launches", group: "last-30-days" },
  { label: "Space Stations", group: "stations" },
  { label: "100 Brightest", group: "visual" },
  { label: "Active Satellites", group: "active" },
  { label: "Starlink", group: "starlink" },
  { label: "Oneweb", group: "oneweb" },
] as const;

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
}

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
  };
}

function satellitesToToml(list: SatelliteSpec[]): string {
  return list
    .map((s) => {
      if (s.type === "tle") {
        return (
          "[[satellites]]\n" +
          'type = "tle"\n' +
          `line1 = ${JSON.stringify(s.lines[0])}\n` +
          `line2 = ${JSON.stringify(s.lines[1])}`
        );
      }
      const e = s.elements;
      return (
        "[[satellites]]\n" +
        'type = "elements"\n' +
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
  const [importOpen, setImportOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

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

  async function handleImport() {
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
                  checked={selectedGroups.includes(group)}
                  onChange={() => toggleGroup(group)}
                />
                <span style={{ marginLeft: 4 }}>{label}</span>
              </label>
            ))}
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <button
                onClick={() => setImportOpen(false)}
                style={{ marginRight: 8 }}
              >
                Cancel
              </button>
              <button onClick={handleImport}>Import</button>
            </div>
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
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>satellites.toml</span>
            <button
              onClick={() => downloadFile("satellites.toml", satText)}
              style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
            >
              💾
            </button>
            <button
              onClick={() => satInputRef.current?.click()}
              style={{ marginLeft: 0, background: "transparent", border: "none", color: "#fff" }}
            >
              📂
            </button>
            <button
              onClick={() => setImportOpen(true)}
              style={{ marginLeft: 0, background: "transparent", border: "none", color: "#fff" }}
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
          <textarea
            value={satText}
            onChange={(e) => setSatText(e.target.value)}
            style={{ width: "98%", height: 80 }}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>constellation.toml</span>
            <button
              onClick={() => downloadFile("constellation.toml", constText)}
              style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
            >
              💾
            </button>
            <button
              onClick={() => constInputRef.current?.click()}
              style={{ marginLeft: 0, background: "transparent", border: "none", color: "#fff" }}
            >
              📂
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
          <textarea
            value={constText}
            onChange={(e) => setConstText(e.target.value)}
            style={{ width: "98%", height: 80 }}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>groundstations.toml</span>
            <button
              onClick={() => downloadFile("groundstations.toml", gsText)}
              style={{ marginLeft: 2, background: "transparent", border: "none", color: "#fff" }}
            >
              💾
            </button>
            <button
              onClick={() => gsInputRef.current?.click()}
              style={{ marginLeft: 0, background: "transparent", border: "none", color: "#fff" }}
            >
              📂
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
          <textarea
            value={gsText}
            onChange={(e) => setGsText(e.target.value)}
            style={{ width: "98%", height: 100 }}
          />
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
            padding: "6px 12px",
            background: "#1976d2",
            color: "#fff",
            border: "none",
            fontWeight: "bold",
          }}
        >
          Update
        </button>
      </div>
    </>
  );
}
