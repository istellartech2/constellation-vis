import { useEffect, useMemo, useState } from "react";
import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import { planShellFailures } from "../../lib/constellationPatterns";
import { Button } from "./button";
import { HelpTip } from "./compactControls";
import NumberField from "./NumberField";
import { Label } from "./label";

interface Props {
  shell: ConstellationShell;
  /** Nominal satellite count from `computeShellDerived`; null while unresolvable. */
  totalSats: number | null;
  shellIndex: number;
  errors: ValidationError[];
  onChange: (updates: Partial<ConstellationShell>) => void;
}

type FailureMode = "none" | "count" | "percent";

function currentMode(shell: ConstellationShell): FailureMode {
  if ((shell.failure_percent ?? 0) > 0) return "percent";
  if ((shell.failed_count ?? 0) > 0) return "count";
  return "none";
}

/**
 * Failure (attrition) controls for one shell.
 *
 * Writes only three TOML keys (`failed_count` / `failure_percent` /
 * `failure_seed`); the removal itself happens in
 * `constellationPatterns/failure.ts` on the shared generation path, so the 3D
 * scene, every analysis and the CLI see the same survivors. The mode radio
 * zeroes the key it does not own, which is what makes "percent wins over
 * count" unambiguous in the saved file.
 */
export default function ShellFailureSection({
  shell,
  totalSats,
  shellIndex,
  errors,
  onChange,
}: Props) {
  // The mode is local state, *not* derived from the values on every render:
  // `NumberField` reports NaN while the box is empty mid-edit, and a derived
  // mode would read that as "no failure" and unmount the very input being
  // typed into. It is re-seeded when a different shell (or a freshly parsed
  // TOML, which mints new ids) is selected.
  const [mode, setMode] = useState<FailureMode>(() => currentMode(shell));
  useEffect(() => {
    setMode(currentMode(shell));
    // Only on shell identity: re-seeding on value changes is the bug above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.id]);

  const nominal = totalSats ?? 0;
  const plan = useMemo(
    () => (totalSats === null ? null : planShellFailures(shell, nominal)),
    // The plan depends on the three failure keys and the nominal count only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nominal, totalSats, shell.failed_count, shell.failure_percent, shell.failure_seed],
  );

  const errorFor = (key: string) =>
    errors.find((e) => e.field === `shell.${shellIndex}.${key}`)?.message;

  const selectMode = (next: FailureMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === "none") {
      onChange({ failed_count: 0, failure_percent: 0 });
      return;
    }
    if (next === "count") {
      onChange({
        failure_percent: 0,
        failed_count: Math.max(1, shell.failed_count ?? 0),
      });
      return;
    }
    onChange({
      failed_count: 0,
      failure_percent: shell.failure_percent && shell.failure_percent > 0 ? shell.failure_percent : 10,
    });
  };

  const reroll = () => {
    // A fresh seed in a range that stays an exact integer in TOML.
    onChange({ failure_seed: Math.floor(Math.random() * 1_000_000) + 1 });
  };

  return (
    <div className="space-y-2 rounded border border-gray-800 bg-gray-900/40 p-3">
      <Label className="text-xs text-gray-400 inline-flex items-center gap-1">
        <span>故障モデル</span>
        <HelpTip text="指定した機数または割合の衛星を「故障」として取り除きます。抽選はシード値で決まる決定論的な処理なので、保存したTOMLを読み直しても、3D表示・各解析・CLI のどこでも同じ衛星が欠けます。残った衛星の衛星番号は変わらないため、欠番が故障機です。" />
      </Label>

      <div className="flex flex-wrap gap-3 text-xs text-gray-300">
        {(
          [
            ["none", "故障なし"],
            ["count", "機数で指定"],
            ["percent", "割合で指定"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name={`failure-mode-${shell.id}`}
              checked={mode === value}
              onChange={() => selectMode(value)}
              className="accent-amber-500"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {mode === "count" && (
        <NumberField
          id={`failed-count-${shell.id}`}
          label="故障機数"
          unit="機"
          value={shell.failed_count ?? 0}
          onChange={(v) => onChange({ failed_count: v })}
          min={0}
          max={nominal}
          step={1}
          integer
          error={errorFor("failed_count")}
          help="取り除く衛星の数。総衛星数以下である必要があります。"
        />
      )}

      {mode === "percent" && (
        <NumberField
          id={`failure-percent-${shell.id}`}
          label="故障率"
          unit="%"
          value={shell.failure_percent ?? 0}
          onChange={(v) => onChange({ failure_percent: v })}
          min={0}
          max={100}
          step={1}
          error={errorFor("failure_percent")}
          help="シェル全体に対する故障割合。機数は round(割合 × 総衛星数) で決まります。"
        />
      )}

      {mode !== "none" && (
        <div className="flex items-end gap-2">
          <NumberField
            id={`failure-seed-${shell.id}`}
            label="抽選シード"
            value={shell.failure_seed ?? 0}
            onChange={(v) => onChange({ failure_seed: v })}
            min={0}
            step={1}
            integer
            className="flex-1"
            help="どの衛星が故障するかを決める乱数シード。同じシードなら常に同じ組み合わせになります。"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reroll}
            className="mb-0.5 shrink-0"
          >
            再抽選
          </Button>
        </div>
      )}

      {plan && plan.failedCount === 0 && mode !== "none" && (
        <p className="text-xs text-gray-500">
          公称 {plan.nominalCount} 機 / 稼働 {plan.nominalCount} 機（指定量が小さいため故障 0 機）
        </p>
      )}
      {plan && plan.failedCount > 0 && (
        <p className="text-xs text-amber-300">
          公称 {plan.nominalCount} 機 / 稼働 {plan.activeCount} 機（{plan.failedCount} 機故障、
          {((plan.failedCount / Math.max(1, plan.nominalCount)) * 100).toFixed(1)}%）
        </p>
      )}
      {plan && plan.failedCount > 0 && (
        <p className="text-xs text-gray-500 break-all">
          故障機のシェル内番号: {plan.failedIndices.map((i) => i + 1).join(", ")}
        </p>
      )}
    </div>
  );
}
