/**
 * Minimal line-based scanner for the `[constellation]` + `[[constellation.shells]]`
 * subset of TOML this project writes. Shared by `tomlParsers.ts` and
 * `constellationSerializer.ts`, which previously carried two near-identical
 * copies that had already drifted apart.
 *
 * Deliberately not a full TOML parser: the surface is exactly what
 * `serializeConstellationConfig` emits plus what users hand-edit.
 */

export type TomlScalar = string | number | Date | number[];

const KEY_VALUE = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/;

/**
 * Parses one right-hand side. Behaviour matches the historical `parseValue`
 * for scalars; the only addition is integer arrays (`nec_necklace = [1, 4, 6]`),
 * which used to fall through to "string".
 */
export function parseTomlScalar(raw: string): TomlScalar {
  const s = raw.trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    // Tolerate arbitrary spacing and a trailing comma: "[1, 4, 6,]".
    const parts = inner
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const numbers = parts.map((p) => Number(p));
    if (parts.length > 0 && numbers.every((n) => Number.isFinite(n))) return numbers;
    return s;
  }
  if (ISO_DATE.test(s)) {
    return new Date(s.replace(/['"]/g, ""));
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

export interface TomlTableScan {
  /** Keys that appeared before the first array-table marker (the `[constellation]` block). */
  header: Record<string, TomlScalar>;
  /** One record per array-table block, in file order. */
  rows: Record<string, TomlScalar>[];
}

/**
 * Scans `text` for one array table, e.g. `scanArrayTable(text, "constellation.shells")`.
 * Section headers (`[constellation]`) are skipped; keys seen before the first
 * `[[marker]]` land in `header`.
 */
export function scanArrayTable(text: string, marker: string): TomlTableScan {
  const header: Record<string, TomlScalar> = {};
  const rows: Record<string, TomlScalar>[] = [];
  let current: Record<string, TomlScalar> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === `[[${marker}]]`) {
      if (current) rows.push(current);
      current = {};
      continue;
    }
    // Any other table header ends the current row but is otherwise ignored.
    if (line.startsWith("[")) continue;

    const m = KEY_VALUE.exec(line);
    if (!m) continue;
    const value = parseTomlScalar(m[2]);
    if (current) current[m[1]] = value;
    else header[m[1]] = value;
  }

  if (current) rows.push(current);
  return { header, rows };
}
