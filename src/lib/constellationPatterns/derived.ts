/**
 * Read-only shell summary for the editor UI.
 *
 * Thin dispatcher: each pattern module owns its own `derive`, and
 * `derivedCommon.ts` builds the shared half. Nothing here generates satellites —
 * the panel re-renders on every keystroke, so this must stay cheap (the only
 * non-trivial cost is the RGT ratio search, which is a bounded integer scan).
 */

import { resolvePattern } from "./registry";
import type { PatternShellInput, ShellDerived } from "./types";

export function computeShellDerived(shell: PatternShellInput): ShellDerived {
  return resolvePattern(shell).derive(shell);
}
