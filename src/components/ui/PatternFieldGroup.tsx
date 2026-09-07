import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import type { PatternId, ShellDerived } from "../../lib/constellationPatterns";
import { defaultFor } from "../../lib/constellationPatterns";
import {
  fieldSpecsFor,
  resolveBound,
  resolveHint,
  type FieldUiGroup,
  type FieldUiSpec,
} from "../../lib/constellationPatterns/uiMeta";
import NumberField from "./NumberField";
import { HelpTip, InlineSlider } from "./compactControls";
import { Label } from "./label";

interface Props {
  pattern: PatternId;
  group: FieldUiGroup;
  shell: ConstellationShell;
  shellIndex: number;
  errors: ValidationError[];
  /** `computeShellDerived(shell)`, or null when it could not be computed. */
  derived: ShellDerived | null;
  onChange: (updates: Partial<ConstellationShell>) => void;
}

/**
 * Renders one basic/advanced group of `PATTERN_FIELD_SPECS[pattern]`.
 *
 * Every input in the shell form comes through here, so field ordering, error
 * placement and the readonly/virtual-field conventions live in exactly one
 * place. Errors are matched on the exact `shell.${index}.${key}` field id —
 * the old form matched by suffix and leaked errors between shells.
 */
export default function PatternFieldGroup({
  pattern,
  group,
  shell,
  shellIndex,
  errors,
  derived,
  onChange,
}: Props) {
  const specs = fieldSpecsFor(pattern, group);
  if (specs.length === 0) return null;

  const issuesFor = (key: string) =>
    errors.filter((e) => e.field === `shell.${shellIndex}.${key}`);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {specs.map((spec) => {
        const issues = issuesFor(spec.key as string);
        return (
          <FieldCell
            key={`${spec.key}-${spec.kind}-${spec.group}`}
            spec={spec}
            shell={shell}
            derived={derived}
            // Only blocking issues get the red treatment; advisory ones fall
            // through to the hint line (and the amber banner above the form).
            error={issues.find((e) => e.severity !== "warning")?.message}
            warning={issues.find((e) => e.severity === "warning")?.message}
            onChange={onChange}
          />
        );
      })}
    </div>
  );
}

function storedValue(spec: FieldUiSpec, shell: ConstellationShell): number {
  const raw = (shell as unknown as Record<string, unknown>)[spec.key as string];
  // NaN survives (the field is mid-edit and must stay blank); only a truly
  // absent key falls back to what an omitted TOML key would mean.
  if (raw === undefined || raw === null || raw === "") {
    return defaultFor(spec.key as string, shell) ?? 0;
  }
  return Number(raw);
}

function FieldCell({
  spec,
  shell,
  derived,
  error,
  warning,
  onChange,
}: {
  spec: FieldUiSpec;
  shell: ConstellationShell;
  derived: ShellDerived | null;
  error?: string;
  warning?: string;
  onChange: (updates: Partial<ConstellationShell>) => void;
}) {
  const value = spec.read ? spec.read(shell, derived) : storedValue(spec, shell);
  const min = resolveBound(spec.min, shell);
  const max = resolveBound(spec.max, shell);
  const specHint = resolveHint(spec, shell);
  const hint = [warning, specHint].filter(Boolean).join(" / ") || undefined;
  const disabledReason = spec.disabledWhen?.(shell);

  const commit = (next: number) => {
    onChange(spec.write ? spec.write(next, shell) : ({ [spec.key]: next } as Partial<ConstellationShell>));
  };

  if (spec.kind === "pearls") {
    return (
      <div className="sm:col-span-2">
        <PearlSelector spec={spec} shell={shell} error={error} hint={hint} onChange={onChange} />
      </div>
    );
  }

  if (spec.kind === "slider") {
    const safe = Number.isFinite(value) ? value : (min ?? 0);
    return (
      <div className="sm:col-span-2 space-y-1">
        <InlineSlider
          label={spec.label}
          labelW="w-28"
          value={safe}
          min={min ?? 0}
          max={max ?? 360}
          step={spec.step ?? 1}
          format={(v) => `${v.toFixed(spec.integer ? 0 : 1)}${spec.unit ?? ""}`}
          help={spec.help}
          onChange={commit}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    );
  }

  const readOnly = spec.kind === "readonly";

  return (
    <NumberField
      label={readOnly ? (spec.labelOverride ?? spec.label) : spec.label}
      value={value}
      onChange={commit}
      unit={spec.unit}
      min={min}
      max={max}
      step={spec.step}
      integer={spec.integer}
      help={spec.help}
      error={error}
      hint={disabledReason ?? hint}
      disabled={disabledReason !== undefined}
      readOnly={readOnly}
    />
  );
}

/**
 * Necklace occupancy: one toggle chip per in-plane slot. The last selected
 * pearl cannot be cleared — an empty necklace has no satellites at all, and
 * the domain layer reports it as a blocking validation error.
 */
function PearlSelector({
  spec,
  shell,
  error,
  hint,
  onChange,
}: {
  spec: FieldUiSpec;
  shell: ConstellationShell;
  error?: string;
  hint?: string;
  onChange: (updates: Partial<ConstellationShell>) => void;
}) {
  const pearls = Number(shell.nec_pearls);
  const selected = new Set(shell.nec_necklace ?? []);
  const count = Number.isFinite(pearls) ? Math.max(0, Math.min(120, Math.trunc(pearls))) : 0;

  const toggle = (g: number) => {
    const next = new Set(selected);
    if (next.has(g)) {
      if (next.size <= 1) return;
      next.delete(g);
    } else {
      next.add(g);
    }
    onChange({ nec_necklace: [...next].sort((a, b) => a - b) });
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-400 inline-flex items-center gap-1">
        <span>{spec.label}</span>
        <HelpTip text={spec.help} />
        <span className="text-gray-500">({selected.size}/{count || "-"})</span>
      </Label>
      {count === 0 ? (
        <p className="text-xs text-gray-500">パール数 (N_so) を入力してください</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: count }, (_, i) => i + 1).map((g) => {
            const on = selected.has(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g)}
                className={`min-w-7 px-1.5 py-0.5 text-xs rounded border tabular-nums transition-colors ${
                  on
                    ? "bg-amber-600/80 border-amber-500 text-amber-50"
                    : "bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
