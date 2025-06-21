import type { FC, CSSProperties } from "react";

interface Option {
  label: string;
  value: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}

const TEXTURE_OPTIONS: Option[] = [
  { label: "Base", value: "./assets/earth01.webp" },
  { label: "Simple", value: "./assets/earth02.webp" },
  { label: "Pale", value: "./assets/earth03.webp" },
  { label: "Blue Marbel", value: "./assets/earth04.webp" },
  { label: "High Resolution", value: "./assets/earth05_highres.webp" },
];

const EarthTextureSelector: FC<Props> = ({ value, onChange, style }) => (
  <div className="sat-size-control" style={style}>
    <label htmlFor="earth-texture-select">Earth texture</label>
    <select
      id="earth-texture-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {TEXTURE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export default EarthTextureSelector;
