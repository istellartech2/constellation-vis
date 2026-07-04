import type { GroundStationDraft, GroundStationValidationError } from "../../lib/groundStationSerializer";
import { VISIBILITY_MODE_OPTIONS } from "../../lib/groundStationSerializer";
import type { VisibilityMode } from "../../lib/groundStations";
import { numericInputValue, parseNumericInput } from "../../lib/numericInput";
import { Label } from "./label";

interface Props {
  station: GroundStationDraft;
  index: number;
  errors: GroundStationValidationError[];
  onChange: (updates: Partial<GroundStationDraft>) => void;
}

export default function GroundStationForm({ station, index, errors, onChange }: Props) {
  const fieldError = (name: string) =>
    errors.find((e) => e.stationId === station.id && e.field === `station.${index}.${name}`);

  const inputCls = (hasErr: boolean) =>
    `w-full px-2 py-1 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
      hasErr ? "border-red-500" : "border-gray-600 focus:border-amber-500"
    }`;

  return (
    <div className="p-3 space-y-3">
      <Field label="名前" error={fieldError("name")?.message}>
        <input
          type="text"
          value={station.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inputCls(!!fieldError("name"))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="緯度 (deg)" error={fieldError("latitudeDeg")?.message}>
          <input
            type="number"
            step="0.0001"
            value={numericInputValue(station.latitudeDeg)}
            onChange={(e) => onChange({ latitudeDeg: parseNumericInput(e.target.value) })}
            className={inputCls(!!fieldError("latitudeDeg"))}
          />
        </Field>
        <Field label="経度 (deg)" error={fieldError("longitudeDeg")?.message}>
          <input
            type="number"
            step="0.0001"
            value={numericInputValue(station.longitudeDeg)}
            onChange={(e) => onChange({ longitudeDeg: parseNumericInput(e.target.value) })}
            className={inputCls(!!fieldError("longitudeDeg"))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="高度 (km)" error={fieldError("heightKm")?.message}>
          <input
            type="number"
            step="0.001"
            value={numericInputValue(station.heightKm)}
            onChange={(e) => onChange({ heightKm: parseNumericInput(e.target.value) })}
            className={inputCls(!!fieldError("heightKm"))}
          />
        </Field>
        <Field label="最低仰角 (deg)" error={fieldError("minElevationDeg")?.message}>
          <input
            type="number"
            step="0.1"
            value={numericInputValue(station.minElevationDeg)}
            onChange={(e) => onChange({ minElevationDeg: parseNumericInput(e.target.value) })}
            className={inputCls(!!fieldError("minElevationDeg"))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="可視判定モード">
          <select
            value={station.visibilityMode ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ visibilityMode: v === "" ? undefined : (v as VisibilityMode) });
            }}
            className={inputCls(false)}
          >
            {VISIBILITY_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="最大オフナディア (deg)" error={fieldError("maxOffNadirDeg")?.message}>
          <input
            type="number"
            step="0.1"
            value={station.maxOffNadirDeg ?? ""}
            placeholder="(未指定)"
            onChange={(e) => {
              const v = e.target.value;
              onChange({ maxOffNadirDeg: v === "" ? undefined : parseFloat(v) });
            }}
            className={inputCls(!!fieldError("maxOffNadirDeg"))}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs text-gray-400 mb-1 block">{label}</Label>
      {children}
      {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
    </div>
  );
}
