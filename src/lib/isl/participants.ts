/** Shared satellite-participation resolution, used by both the main thread and the routing worker. */
import type { IslShellRange } from "./types";

/**
 * Find the shell (if any) a satellite index falls within. Previously
 * reimplemented identically in `graph.ts` for its cross-shell candidate pass
 * — a linear scan is fine here since
 * `shellRanges` is at most a handful of entries.
 */
export function shellOfIndex(idx: number, shellRanges: IslShellRange[]): IslShellRange | null {
  for (const shell of shellRanges) {
    if (idx >= shell.startIndex && idx < shell.startIndex + shell.count) return shell;
  }
  return null;
}

/**
 * Resolve participant satellite indices from stable exclusion state:
 * a satellite belonging to a shell in `excludedShellKeys`
 * is excluded; a satellite not covered by any shell range (a
 * satellites.toml-defined satellite) is included iff `includeBaseSatellites`.
 * Resolution is index-based (no satnum lookup), so it is immune to the
 * Alpha-5 catalog-number issue and always matches the actual satellite
 * array — there is no snapshot to go stale.
 */
export function resolveIslParticipantIndices(
  satCount: number,
  shellRanges: IslShellRange[],
  excludedShellKeys: string[],
  includeBaseSatellites: boolean,
): number[] {
  const excluded = new Set(excludedShellKeys);

  const indices: number[] = [];
  for (let i = 0; i < satCount; i++) {
    const shell = shellOfIndex(i, shellRanges);
    if (shell) {
      if (!excluded.has(shell.key)) indices.push(i);
    } else if (includeBaseSatellites) {
      indices.push(i);
    }
  }
  return indices;
}
