import type { ChangeEvent } from "react";
import type { ConstellationShell } from "../../lib/constellationTypes";
import { computeShellDerived } from "../../lib/constellationPatterns";
import {
  CONSTELLATION_PRESETS,
  PRESET_HEAVY_SATELLITE_COUNT,
  createShellFromPreset,
  type ConstellationPresetItem,
} from "../../lib/constellationPresets";

interface Props {
  onSelect: (shell: ConstellationShell, note?: string) => void;
  className?: string;
}

/** Total satellite count for a preset, falling back to its raw `count` field. */
function presetSatelliteCount(item: ConstellationPresetItem): number {
  try {
    return computeShellDerived(item.shell).totalSats;
  } catch {
    return item.shell.count ?? 0;
  }
}

/** Native `<select>` for adding a shell from a ready-made constellation template. */
export default function ConstellationTemplateMenu({ onSelect, className }: Props) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    e.target.value = "";
    if (!value) return;

    const [groupIdx, itemIdx] = value.split(":").map(Number);
    const item = CONSTELLATION_PRESETS[groupIdx]?.items[itemIdx];
    if (!item) return;

    const satelliteCount = presetSatelliteCount(item);
    if (satelliteCount > PRESET_HEAVY_SATELLITE_COUNT) {
      const confirmed = window.confirm(
        `${satelliteCount}機を生成します。描画が重くなる場合があります。よろしいですか？`,
      );
      if (!confirmed) return;
    }

    onSelect(createShellFromPreset(item), item.note);
  };

  return (
    <select
      value=""
      onChange={handleChange}
      className={`w-full px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-amber-500 focus:outline-none ${className ?? ""}`}
    >
      <option value="">テンプレートから追加...</option>
      {CONSTELLATION_PRESETS.map((group, gi) => (
        <optgroup key={group.group} label={group.group}>
          {group.items.map((item, ii) => (
            <option key={item.id} value={`${gi}:${ii}`}>
              {item.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
