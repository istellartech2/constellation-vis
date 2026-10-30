import type { FC, CSSProperties } from "react";
import { PIXEL_SIZE_OPTIONS } from "../../lib/satellitePointStyle";

interface Props {
  /** World-size dot radius (Earth radii), used when `pixelSize` is 0. */
  radius: number;
  /** Fixed dot size in CSS px; 0 = world size. */
  pixelSize: number;
  onRadiusChange: (r: number) => void;
  onPixelSizeChange: (px: number) => void;
  style?: CSSProperties;
}

// One dropdown for both kinds of size: fixed-pixel dots (stay tiny at any
// zoom, closer to how real satellites look) and the world-size dots that
// grow as the camera approaches.

const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: "S", value: 0.01 },
  { label: "M", value: 0.02 },
  { label: "L", value: 0.03 },
  { label: "LL", value: 0.05 },
];

const SatelliteSizeControl: FC<Props> = ({ radius, pixelSize, onRadiusChange, onPixelSizeChange, style }) => {
  const value = pixelSize > 0 ? `px:${pixelSize}` : `r:${radius}`;
  return (
    <div className="sat-size-control" style={style}>
      <label htmlFor="sat-size-select">衛星表示サイズ</label>
      <select
        id="sat-size-select"
        value={value}
        onChange={(e) => {
          const [kind, raw] = e.target.value.split(":");
          if (kind === "px") onPixelSizeChange(Number(raw));
          else onRadiusChange(Number(raw));
        }}
      >
        <optgroup label="画面上で一定（実物に近い）">
          {PIXEL_SIZE_OPTIONS.map((px) => (
            <option key={px} value={`px:${px}`}>点 {px}px</option>
          ))}
        </optgroup>
        <optgroup label="ズームで拡大">
          {/* Older views may hold a radius outside the presets (e.g. 0.015); keep it selectable. */}
          {!RADIUS_OPTIONS.some((o) => o.value === radius) && <option value={`r:${radius}`}>既定</option>}
          {RADIUS_OPTIONS.map((o) => (
            <option key={o.value} value={`r:${o.value}`}>{o.label}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
};

export default SatelliteSizeControl;
