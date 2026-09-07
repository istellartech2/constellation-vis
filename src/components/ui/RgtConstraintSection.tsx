import { useEffect, useState } from "react";
import {
  solveAltitudeFromInclinationAndRatio,
  solveInclinationFromAltitudeAndRatio,
  suggestRgtRatioFromAltitudeInclination,
} from "../../lib/rgt";
import { Button } from "./button";
import CollapsibleSubsection from "./CollapsibleSubsection";

interface RgtApplyUpdates {
  apogee_altitude?: number;
  inclination?: number;
  rgt_repeat_orbits?: number;
  rgt_repeat_days?: number;
}

interface Props {
  shellId: string;
  altitudeKm: number;
  inclinationDeg: number;
  eccentricity: number;
  onApply: (updates: RgtApplyUpdates) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  defaultOpen?: boolean;
  alwaysOpen?: boolean;
}

/**
 * RGT (Repeat Ground Track) solver UI, extracted from ConstellationShellForm
 * so it can be reused standalone. Keeps the same Japanese copy and solver
 * behavior as the original inline implementation.
 */
export default function RgtConstraintSection({
  shellId,
  altitudeKm,
  inclinationDeg,
  eccentricity,
  onApply,
  open,
  onOpenChange,
  defaultOpen,
  alwaysOpen,
}: Props) {
  const [rgtStatus, setRgtStatus] = useState<string | null>(null);
  const [rgtMode, setRgtMode] = useState<"inclinationRatio" | "altitudeRatio">("inclinationRatio");
  const [rgtRepeatOrbits, setRgtRepeatOrbits] = useState<number>(15);
  const [rgtRepeatDays, setRgtRepeatDays] = useState<number>(1);

  useEffect(() => {
    setRgtStatus(null);
    const suggestion = suggestRgtRatioFromAltitudeInclination(
      altitudeKm ?? 0,
      inclinationDeg ?? 0,
      eccentricity ?? 0,
      {
        minRepeatDays: 1,
        maxRepeatDays: 30,
        maxRepeatOrbits: 2000,
      }
    );
    if (suggestion) {
      setRgtRepeatOrbits(suggestion.repeatOrbits);
      setRgtRepeatDays(suggestion.repeatDays);
    }
  }, [shellId, altitudeKm, inclinationDeg, eccentricity]);

  const handleApplyRgt = () => {
    const repeatOrbits = Math.max(1, Math.round(rgtRepeatOrbits));
    const repeatDays = Math.max(1, Math.round(rgtRepeatDays));

    if (!Number.isFinite(repeatOrbits) || !Number.isFinite(repeatDays)) {
      setRgtStatus("RGT比の入力が正しくありません");
      return;
    }

    if (rgtMode === "inclinationRatio") {
      const result = solveAltitudeFromInclinationAndRatio(
        altitudeKm ?? 0,
        inclinationDeg ?? 0,
        repeatOrbits,
        repeatDays,
        eccentricity ?? 0,
        {
          minAltitudeKm: 120,
          maxAltitudeKm: 50000,
        }
      );

      if (!result) {
        setRgtStatus("RGT条件を満たす高度が見つかりませんでした");
        return;
      }

      const updatedAltitude = Number(result.altitudeKm.toFixed(2));
      onApply({
        apogee_altitude: updatedAltitude,
        rgt_repeat_orbits: repeatOrbits,
        rgt_repeat_days: repeatDays,
      });
      setRgtStatus(
        `RGT比 ${repeatOrbits}/${repeatDays} (周期${repeatDays}日) → 高度 ${updatedAltitude.toFixed(1)} km`
      );
    } else {
      const result = solveInclinationFromAltitudeAndRatio(
        altitudeKm ?? 0,
        repeatOrbits,
        repeatDays,
        eccentricity ?? 0,
        {
          minInclinationDeg: 0,
          maxInclinationDeg: 180,
        }
      );

      if (!result) {
        setRgtStatus("RGT条件を満たす傾斜角が見つかりませんでした");
        return;
      }

      const updatedInclination = Number(result.inclinationDeg.toFixed(2));
      onApply({
        inclination: updatedInclination,
        rgt_repeat_orbits: repeatOrbits,
        rgt_repeat_days: repeatDays,
      });
      setRgtStatus(
        `RGT比 ${repeatOrbits}/${repeatDays} (周期${repeatDays}日) → 傾斜角 ${updatedInclination.toFixed(2)}°`
      );
    }
  };

  const content = (
    <>
      <div className="flex flex-wrap gap-3 text-xs text-gray-300">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`rgt-mode-${shellId}`}
            checked={rgtMode === "inclinationRatio"}
            onChange={() => setRgtMode("inclinationRatio")}
          />
          <span>傾斜角 + RGT比 → 高度</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`rgt-mode-${shellId}`}
            checked={rgtMode === "altitudeRatio"}
            onChange={() => setRgtMode("altitudeRatio")}
          />
          <span>高度 + RGT比 → 傾斜角</span>
        </label>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <input
          type="number"
          min={1}
          step={1}
          value={rgtRepeatOrbits}
          onChange={(e) => setRgtRepeatOrbits(Number(e.target.value))}
          className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
        />
        <span className="text-xs text-gray-400">/</span>
        <input
          type="number"
          min={1}
          step={1}
          value={rgtRepeatDays}
          onChange={(e) => setRgtRepeatDays(Number(e.target.value))}
          className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
        />
      </div>
      <span className="text-xs text-gray-500">
        RGT比 = N_S / N_D（同じ地上軌跡が戻るまでの「衛星の周回数 / 地球の自転回数」）
      </span>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleApplyRgt}
        className="bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 w-fit"
      >
        RGT比を適用
      </Button>
      {rgtStatus && <p className="text-xs text-amber-300">{rgtStatus}</p>}
    </>
  );

  if (alwaysOpen) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-400">RGT 条件（回帰軌道）</div>
        {content}
      </div>
    );
  }

  return (
    <CollapsibleSubsection
      title="RGT 条件（回帰軌道）"
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={defaultOpen}
    >
      {content}
    </CollapsibleSubsection>
  );
}
