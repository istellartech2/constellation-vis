interface Props {
  value: number;
  onChange: (value: number) => void;
}

// Slider widget used to adjust the simulation speed. The slider
// represents the exponent of the speed multiplier (10^value).

export default function SpeedControl({ value, onChange }: Props) {
  return (
    <div className="speed-control">
      <input
        type="range"
        min={0}
        max={2.56}
        step={0.01}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(parseFloat(e.target.value))
        }
      />
      <span className="speed-value">{Math.pow(10, value).toFixed(1)}×</span>
    </div>
  );
}
