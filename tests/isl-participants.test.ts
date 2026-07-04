import { describe, expect, it } from "bun:test";
import { resolveIslParticipantIndices } from "../src/lib/isl/participants";
import type { IslShellRange } from "../src/lib/isl/types";

const SHELL_A: IslShellRange = { key: "0", name: "A", startIndex: 3, count: 4, planes: 1 }; // indices 3-6
const SHELL_B: IslShellRange = { key: "1", name: "B", startIndex: 7, count: 3, planes: 1 }; // indices 7-9
const SAT_COUNT = 10; // indices 0-2 are "base" (satellites.toml) satellites

describe("resolveIslParticipantIndices (Phase 5, H-2/H-4/H-5)", () => {
  it("includes everything by default (no filter)", () => {
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_A, SHELL_B], [], true);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("excludes only the named shell's index range", () => {
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_A, SHELL_B], ["0"], true);
    expect(indices).toEqual([0, 1, 2, 7, 8, 9]);
  });

  it("excludes base satellites via includeBaseSatellites=false", () => {
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_A, SHELL_B], [], false);
    expect(indices).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  // H-2: excluding everything must yield an empty set, not "no filter" (which
  // would be the exact opposite of user intent).
  it("returns an empty array when every shell is excluded and base is excluded (H-2)", () => {
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_A, SHELL_B], ["0", "1"], false);
    expect(indices).toEqual([]);
  });

  // H-4/H-5: a stale exclusion key referring to a shell that no longer exists
  // (e.g. the constellation was edited and that shell removed) must not
  // silently exclude anything — it's simply not resolvable, so it's a no-op
  // and the satellites it used to refer to fall back to "included".
  it("falls back to full participation when an excluded key no longer matches any shell", () => {
    // SHELL_A ("0") is no longer in the range list (as if that shell had been
    // removed) — its index range (3-6) is now uncovered and therefore treated
    // as base satellites, not silently excluded by the stale key.
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_B], ["0", "does-not-exist"], true);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("treats satellites not covered by any shell range as base satellites", () => {
    const indices = resolveIslParticipantIndices(SAT_COUNT, [SHELL_B], [], false);
    expect(indices).toEqual([7, 8, 9]);
  });
});
