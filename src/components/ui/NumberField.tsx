import { numericInputValue, parseNumericInput } from "../../lib/numericInput";
import { HelpTip } from "./compactControls";
import { Label } from "./label";

interface Props {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  help?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  id?: string;
}

/**
 * Labeled numeric input following the ConstellationShellForm input styling.
 * Lets the field be blank or a bare "-" mid-edit without snapping to 0 by
 * routing through numericInputValue/parseNumericInput (see src/lib/numericInput.ts).
 */
export default function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  integer,
  help,
  error,
  hint,
  disabled,
  readOnly,
  className,
  id,
}: Props) {
  const inputCls = `w-full px-2 py-1.5 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
    error ? "border-red-500" : "border-gray-600 focus:border-amber-500"
  }`;

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-xs text-gray-400 inline-flex items-center gap-1">
        <span>{label}</span>
        {help && <HelpTip text={help} />}
        {unit && <span className="text-gray-500">({unit})</span>}
      </Label>
      {readOnly ? (
        <div className="w-full px-2 py-1.5 text-sm text-gray-300 tabular-nums">{value}</div>
      ) : (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={numericInputValue(value)}
          onChange={(e) => {
            const parsed = parseNumericInput(e.target.value);
            if (!Number.isFinite(parsed)) {
              onChange(NaN);
              return;
            }
            onChange(integer ? Math.round(parsed) : parsed);
          }}
          className={inputCls}
        />
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
