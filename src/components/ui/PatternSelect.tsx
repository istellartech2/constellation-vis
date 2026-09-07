import type { PatternId } from "../../lib/constellationPatterns";
import { PATTERN_GROUPS, PATTERN_META } from "../../lib/constellationPatterns/uiMeta";
import { HelpTip } from "./compactControls";
import { Label } from "./label";

interface Props {
  value: PatternId;
  onChange: (pattern: PatternId) => void;
  id?: string;
  disabled?: boolean;
}

/**
 * Design-method picker. A native `<select>` with `<optgroup>`s (ウォーカー系 /
 * フラワー系) rather than a Radix listbox: the option list is short, static and
 * has to work inside the dialog on mobile, where the OS picker is better than
 * anything we would render.
 */
export default function PatternSelect({ value, onChange, id, disabled }: Props) {
  const meta = PATTERN_META[value];

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-gray-400 inline-flex items-center gap-1">
        <span>設計方式</span>
        <HelpTip text={meta.help} />
      </Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PatternId)}
        className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
      >
        {PATTERN_GROUPS.map(({ group, patterns }) => (
          <optgroup key={group} label={group}>
            {patterns.map((pattern) => (
              <option key={pattern} value={pattern}>
                {PATTERN_META[pattern].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-gray-500">{meta.summary}</p>
    </div>
  );
}
