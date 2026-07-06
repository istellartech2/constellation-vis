/**
 * Shared numeric <input type="number"> parsing so a field can be cleared
 * (or hold a bare "-") while typing without the value being coerced to 0
 * mid-edit. `parseNumericInput` returns NaN for
 * those in-progress states instead of 0 — callers should only commit the
 * value once it is finite.
 */
export function parseNumericInput(raw: string): number {
  if (raw === "" || raw === "-") return NaN;
  return parseFloat(raw);
}

/** Inverse of {@link parseNumericInput}: render a NaN/non-finite value as an empty field. */
export function numericInputValue(n: number): number | "" {
  return Number.isFinite(n) ? n : "";
}
