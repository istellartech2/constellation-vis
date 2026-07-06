/** Shared satellite propagation for one instant, used by the routing worker and the verification/bench scripts. */
import * as satellite from "satellite.js";
import type { Vec3 } from "./geometry";

export interface PropagateAllResult {
  positions: Vec3[];
  valid: boolean[];
}

/**
 * Propagate every satrec at `simDate`. A satellite whose propagation fails is
 * marked `valid[i] = false` rather than silently substituted with `{0,0,0}`
 * — a stale/zeroed position must never be treated as a real, current
 * satellite location for routing. Callers must filter their participant
 * indices by `valid` before building a graph (as the routing worker does).
 *
 * Previously reimplemented independently in the routing worker and in
 * `scripts/verify-isl-routing.ts`/`scripts/bench-isl.ts` — the scripts'
 * copies used the `{0,0,0}` fallback the worker had already moved away from,
 * so they were verifying different behavior than what ships.
 *
 * `out`, if given, is reused and mutated in place (both arrays and each
 * `Vec3`/boolean slot) instead of allocating a fresh result — the routing
 * worker calls this on every compute (up to 5/s) with a satellite count fixed
 * since the last "init", so allocating N objects + 2 arrays every call was
 * pure GC churn. One-shot callers (scripts) can
 * simply omit it.
 */
export function propagateAll(
  satRecs: satellite.SatRec[],
  simDate: Date,
  out?: PropagateAllResult,
): PropagateAllResult {
  const positions: Vec3[] = out?.positions ?? new Array(satRecs.length);
  const valid: boolean[] = out?.valid ?? new Array(satRecs.length);
  for (let i = 0; i < satRecs.length; i++) {
    const pv = satellite.propagate(satRecs[i], simDate);
    const p = positions[i];
    if (pv?.position) {
      if (p) {
        p.x = pv.position.x;
        p.y = pv.position.y;
        p.z = pv.position.z;
      } else {
        positions[i] = { x: pv.position.x, y: pv.position.y, z: pv.position.z };
      }
      valid[i] = true;
    } else {
      if (p) {
        p.x = 0;
        p.y = 0;
        p.z = 0;
      } else {
        positions[i] = { x: 0, y: 0, z: 0 };
      }
      valid[i] = false;
    }
  }
  return { positions, valid };
}
