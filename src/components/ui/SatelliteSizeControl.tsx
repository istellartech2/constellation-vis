import type { FC } from "react";
import { PIXEL_SIZE_OPTIONS } from "../../lib/satellitePointStyle";
import { SegmentedControl } from "./compactControls";

interface Props {
  /** World-size dot radius (Earth radii), used when `pixelSize` is 0. */
  radius: number;
  /** Fixed dot size in CSS px; 0 = world size. */
  pixelSize: number;
  /** Change the world-size radius (and switch to world-size dots). */
  onRadiusChange: (r: number) => void;
  onPixelSizeChange: (px: number) => void;
}

// Two kinds of size, picked separately: fixed-pixel dots (stay tiny at any
// zoom, closer to how real satellites look) and world-size dots that grow as
// the camera approaches.

const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: "小", value: 0.01 },
  { label: "中", value: 0.02 },
  { label: "大", value: 0.03 },
  { label: "特大", value: 0.05 },
];

/**
 * The presets, plus the current radius as 「既定」 when it is off-preset (the
 * desktop first-visit default 0.015, or an older saved view), so one option
 * is always highlighted.
 */
function radiusOptions(radius: number) {
  if (RADIUS_OPTIONS.some((o) => o.value === radius)) return RADIUS_OPTIONS;
  return [...RADIUS_OPTIONS, { label: "既定", value: radius }].sort((a, b) => a.value - b.value);
}

/** Pixel size used when switching to fixed-pixel dots. */
const DEFAULT_PIXEL_SIZE = 2;

type SizeMode = "pixel" | "world";

const SatelliteSizeControl: FC<Props> = ({ radius, pixelSize, onRadiusChange, onPixelSizeChange }) => {
  const mode: SizeMode = pixelSize > 0 ? "pixel" : "world";
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-fg">点の大きさ</div>
      <SegmentedControl<SizeMode>
        ariaLabel="衛星の大きさの決め方"
        value={mode}
        options={[
          { value: "pixel", label: "画面上で一定" },
          { value: "world", label: "ズームで拡大" },
        ]}
        onChange={(next) => (next === "pixel" ? onPixelSizeChange(DEFAULT_PIXEL_SIZE) : onRadiusChange(radius))}
      />
      {mode === "pixel" ? (
        <SegmentedControl<string>
          ariaLabel="点の大きさ(ピクセル)"
          value={String(pixelSize)}
          options={PIXEL_SIZE_OPTIONS.map((px) => ({ value: String(px), label: `${px}px` }))}
          onChange={(v) => onPixelSizeChange(Number(v))}
        />
      ) : (
        <SegmentedControl<string>
          ariaLabel="点の大きさ"
          value={String(radius)}
          options={radiusOptions(radius).map((o) => ({ value: String(o.value), label: o.label }))}
          onChange={(v) => onRadiusChange(Number(v))}
        />
      )}
      <p className="text-[11px] text-fg-subtle leading-snug">
        {mode === "pixel" ? "実物に近い見え方です。近づくと衛星は地球に対して小さくなります。" : "近づくほど点が大きく見えます。"}
      </p>
    </div>
  );
};

export default SatelliteSizeControl;
