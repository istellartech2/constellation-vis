/** Shared satellite-participation resolution, used by both the main thread and the routing worker. */
import type * as satelliteNs from "satellite.js";

/** Resolve participant satellite indices from IslSettings.participantSatnums (empty = all). */
export function resolveIslParticipantIndices(
  satRecs: satelliteNs.SatRec[],
  participantSatnums: number[],
): number[] {
  if (participantSatnums.length === 0) {
    return satRecs.map((_, i) => i);
  }
  const wanted = new Set(participantSatnums);
  const indices: number[] = [];
  satRecs.forEach((rec, i) => {
    if (wanted.has(Number(rec.satnum))) indices.push(i);
  });
  return indices;
}
