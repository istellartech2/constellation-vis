import type { FC, CSSProperties } from "react";
import {
  EARTH_TEXTURE_OPTIONS,
  type EarthTextureMode,
} from "../../lib/earthTextures";

interface Props {
  value: EarthTextureMode;
  onChange: (v: EarthTextureMode) => void;
  style?: CSSProperties;
}

const EarthTextureSelector: FC<Props> = ({ value, onChange, style }) => (
  <div className="sat-size-control" style={style}>
    <label htmlFor="earth-texture-select">地球テクスチャ</label>
    <select
      id="earth-texture-select"
      value={value}
      onChange={(e) => onChange(e.target.value as EarthTextureMode)}
    >
      {EARTH_TEXTURE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export default EarthTextureSelector;
