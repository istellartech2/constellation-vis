/** Shared satellite-participation resolution, used by both the main thread and the routing worker. */
import type { IslShellRange } from "./types";

/**
 * Resolve participant satellite indices from stable exclusion state (§2.4,
 * Phase 5 H-4/H-5): a satellite belonging to a shell in `excludedShellKeys`
 * is excluded; a satellite not covered by any shell range (a
 * satellites.toml-defined satellite) is included iff `includeBaseSatellites`.
 * Resolution is index-based (no satnum lookup), so it is immune to the
 * Alpha-5 catalog-number issue (L-2) and always matches the actual satellite
 * array — there is no snapshot to go stale.
 */
export function resolveIslParticipantIndices(
  satCount: number,
  shellRanges: IslShellRange[],
  excludedShellKeys: string[],
  includeBaseSatellites: boolean,
): number[] {
  const excluded = new Set(excludedShellKeys);
  const shellOfIndex = (idx: number): IslShellRange | null => {
    for (const shell of shellRanges) {
      if (idx >= shell.startIndex && idx < shell.startIndex + shell.count) return shell;
    }
    return null;
  };

  const indices: number[] = [];
  for (let i = 0; i < satCount; i++) {
    const shell = shellOfIndex(i);
    if (shell) {
      if (!excluded.has(shell.key)) indices.push(i);
    } else if (includeBaseSatellites) {
      indices.push(i);
    }
  }
  return indices;
}
