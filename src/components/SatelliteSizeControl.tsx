import type { FC } from "react";

interface Props {
  value: number;
  onChange: (v: number) => void;
}

const SIZE_OPTIONS: { label: string; value: number }[] = [
  { label: "S", value: 0.01 },
  { label: "M", value: 0.02 },
  { label: "L", value: 0.03 },
  { label: "LL", value: 0.05 },
];

const SatelliteSizeControl: FC<Props> = ({ value, onChange }) => (
  <div
    style={{
      position: "absolute",
      right: 8,
      top: 62,
      color: "#fff",
      fontFamily: "'Noto Sans Mono', monospace",
      display: "flex",
      alignItems: "center",
      gap: 4,
    }}
  >
    <label htmlFor="sat-size-select">Sat size</label>
    <select
      id="sat-size-select"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    >
      {SIZE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export default SatelliteSizeControl;
