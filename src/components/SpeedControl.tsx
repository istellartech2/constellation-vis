interface Props {
  value: number;
  onChange: (value: number) => void;
}

export default function SpeedControl({ value, onChange }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        right: 8,
        top: 8,
        color: "#fff",
        fontFamily: "'Noto Sans Mono', monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <input
        type="range"
        min={1}
        max={2.5}
        step={0.01}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(parseFloat(e.target.value))
        }
        style={{ width: 150 }}
      />
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {Math.pow(10, value).toFixed(1)}×
      </span>
    </div>
  );
}
