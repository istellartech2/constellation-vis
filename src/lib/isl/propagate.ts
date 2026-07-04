/** Shared satellite propagation for one instant, used by the routing worker and the verification/bench scripts (D-3). */
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
 * so they were verifying different behavior than what ships (D-3).
 */
export function propagateAll(satRecs: satellite.SatRec[], simDate: Date): PropagateAllResult {
  const positions: Vec3[] = new Array(satRecs.length);
  const valid: boolean[] = new Array(satRecs.length);
  for (let i = 0; i < satRecs.length; i++) {
    const pv = satellite.propagate(satRecs[i], simDate);
    if (pv?.position) {
      positions[i] = { x: pv.position.x, y: pv.position.y, z: pv.position.z };
      valid[i] = true;
    } else {
      positions[i] = { x: 0, y: 0, z: 0 };
      valid[i] = false;
    }
  }
  return { positions, valid };
}
