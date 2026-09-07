/**
 * TOML parsing and serialization for the constellation *editor*.
 *
 * Unlike `tomlParsers.ts` (which feeds the runtime/CLI/build generation path),
 * this module round-trips the editor's `ConstellationShell` — it keeps `id`,
 * preserves user-entered values and re-emits them. Both modules read the same
 * field registry (`constellationPatterns/fields.ts`) and the same table
 * scanner, so a new TOML key cannot land in one parser and be forgotten in the
 * other (which used to show up as "saving works but the 3D shape changed").
 */

import type { ConstellationConfig, ConstellationShell } from "./constellationTypes";
import { createDefaultConfig } from "./constellationTypes";
import {
  DEFAULT_PATTERN_ID,
  FIELD_REGISTRY,
  PATTERN_SHORT_LABELS,
  computeShellDerived,
  defaultFor,
  fieldsForPattern,
  isPatternId,
  numberField,
  patternIdOf,
  scanArrayTable,
  validateShell,
  type FieldSpec,
  type PatternId,
  type TomlScalar,
  type ValidationError,
} from "./constellationPatterns";

export type { ValidationError };

/** Keys that are always emitted first and never treated as optional. */
const ALWAYS_EMITTED = new Set(["name", "pattern", "count", "planes"]);

export function parseConstellationConfig(tomlText: string): ConstellationConfig {
  if (!tomlText.trim()) {
    return createDefaultConfig();
  }

  const { header, rows } = scanArrayTable(tomlText, "constellation.shells");
  const epochRaw = header.epoch;

  return {
    // Older TOMLs may carry a `[constellation] name`; silently ignored.
    epoch:
      epochRaw instanceof Date
        ? epochRaw
        : epochRaw !== undefined
          ? new Date(String(epochRaw))
          : new Date(),
    shells: rows.map(finalizeShell),
  };
}

function coerceField(spec: FieldSpec, raw: TomlScalar | undefined): unknown {
  if (raw === undefined) return undefined;
  switch (spec.kind) {
    case "string":
      return typeof raw === "string" ? raw : String(raw);
    case "intArray":
      return Array.isArray(raw) ? raw.map((v) => Number(v)) : undefined;
    case "int":
    case "number":
      return Number(raw);
  }
}

function finalizeShell(row: Record<string, TomlScalar>): ConstellationShell {
  const shell: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name: typeof row.name === "string" ? row.name : "",
  };

  for (const spec of FIELD_REGISTRY) {
    if (spec.key === "name") continue;
    if (spec.key === "pattern") {
      shell.pattern = isPatternId(row.pattern) ? row.pattern : undefined;
      continue;
    }
    shell[spec.key] = coerceField(spec, row[spec.key]);
  }

  // `count`/`planes` are structurally required on ConstellationShell.
  shell.count = typeof shell.count === "number" && Number.isFinite(shell.count) ? shell.count : 1;
  shell.planes =
    typeof shell.planes === "number" && Number.isFinite(shell.planes) ? shell.planes : 1;

  return shell as unknown as ConstellationShell;
}

function formatTomlDate(date: Date): string {
  // Format as unquoted ISO timestamp: 2025-05-20T00:00:00Z
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatNumber(value: number | undefined, decimals: number = 4): string {
  if (value === undefined) return "0";
  // Remove trailing zeros after decimal point
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function formatFieldValue(spec: FieldSpec, value: unknown): string | null {
  switch (spec.kind) {
    case "string": {
      const s = String(value);
      return s ? `"${s}"` : null;
    }
    case "intArray": {
      if (!Array.isArray(value) || value.length === 0) return null;
      return `[${value.map((v) => String(Math.trunc(Number(v)))).join(", ")}]`;
    }
    case "int":
      return String(Math.trunc(Number(value)));
    case "number":
      // A field with no declared precision is written raw (the old serializer
      // did this for `phasing`), so fractional values are not clipped.
      return spec.decimals === undefined
        ? String(Number(value))
        : formatNumber(Number(value), spec.decimals);
  }
}

export function serializeConstellationConfig(config: ConstellationConfig): string {
  const lines: string[] = [];

  lines.push("[constellation]");
  lines.push(`epoch = ${formatTomlDate(config.epoch)}`);

  for (const shell of config.shells) {
    const pattern = patternIdOf(shell);
    const derived = computeShellDerived(shell);

    lines.push("");
    lines.push("[[constellation.shells]]");

    if (shell.name) {
      lines.push(`name = "${shell.name}"`);
    }
    // Omitted for walker_delta so pre-pattern files round-trip byte-identically.
    if (pattern !== DEFAULT_PATTERN_ID) {
      lines.push(`pattern = "${pattern}"`);
    }
    // Always written, for every pattern: `EditorTab` counts `count =` lines to
    // show the satellite total, and `IslShellRange.planes` seeds the ISL grid
    // topology. For the derived-size patterns (streets_of_coverage, flower,
    // lattice/necklace flower) these are the *computed* values, not whatever
    // the user last typed.
    lines.push(`count = ${derived.totalSats}`);
    lines.push(`planes = ${derived.planes}`);

    for (const spec of fieldsForPattern(pattern)) {
      if (ALWAYS_EMITTED.has(spec.key)) continue;
      const value = (shell as unknown as Record<string, unknown>)[spec.key];
      if (value === undefined || value === null || value === "") continue;

      // Omit anything equal to what an omitted key would mean anyway.
      if (!spec.alwaysWrite && (spec.kind === "number" || spec.kind === "int")) {
        const fallback = defaultFor(spec.key, shell);
        if (fallback !== undefined && Number(value) === fallback) continue;
      }

      const formatted = formatFieldValue(spec, value);
      if (formatted !== null) lines.push(`${spec.key} = ${formatted}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/** Warnings are advisory: they are surfaced in the form but never block saving. */
export function isBlockingError(error: ValidationError): boolean {
  return error.severity !== "warning";
}

/** Patterns whose `planes`/`count` the user types directly. */
const USER_SIZED_PATTERNS: readonly PatternId[] = ["walker_delta", "walker_star"];

export function validateConfig(config: ConstellationConfig): ValidationResult {
  const errors: ValidationError[] = [];

  config.shells.forEach((shell, index) => {
    const pattern = patternIdOf(shell);

    if (shell.count < 1 || !Number.isInteger(shell.count)) {
      errors.push({
        field: `shell.${index}.count`,
        message: "衛星数は1以上の整数が必要です",
      });
    }
    if (shell.planes < 1 || !Number.isInteger(shell.planes)) {
      errors.push({
        field: `shell.${index}.planes`,
        message: "軌道面数は1以上の整数が必要です",
      });
    }
    // Only meaningful where count/planes are both user inputs; for the derived
    // patterns `count` is computed from the design and cannot conflict.
    if (USER_SIZED_PATTERNS.includes(pattern) && shell.planes > shell.count) {
      errors.push({
        field: `shell.${index}.planes`,
        message: "軌道面数は衛星数以下である必要があります",
      });
    }
    if (
      shell.eccentricity !== undefined &&
      (shell.eccentricity < 0 || shell.eccentricity >= 1)
    ) {
      errors.push({
        field: `shell.${index}.eccentricity`,
        message: "離心率は0以上1未満である必要があります",
      });
    }
    if (shell.apogee_altitude !== undefined && shell.apogee_altitude < 0) {
      errors.push({
        field: `shell.${index}.apogee_altitude`,
        message: "高度は0以上である必要があります",
      });
    }

    // Non-finite numbers, unknown pattern ids, and the pattern's own rules.
    errors.push(...validateShell(shell, index));
  });

  return {
    isValid: !errors.some(isBlockingError),
    errors,
  };
}

export function getShellDisplayName(shell: ConstellationShell, index: number): string {
  if (shell.name) {
    return shell.name;
  }
  const label = PATTERN_SHORT_LABELS[patternIdOf(shell)];
  const alt = numberField("apogee_altitude", shell);
  const inc = numberField("inclination", shell);
  return `Shell ${index + 1} (${label} ${alt}km, ${inc}°)`;
}
