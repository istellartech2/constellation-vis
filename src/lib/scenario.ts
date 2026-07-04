import type { SatelliteSpec } from "./satellites";
import type { GroundStation } from "./groundStations";
import type { IslShellRange } from "./isl/types";

/**
 * The committed (post-"更新") scenario: satellites, ground stations, sim
 * start time and the ISL shell ranges derived from the same satellite array.
 * Previously threaded as 4 parallel state values / positional `onUpdate`
 * arguments across App.tsx and SatelliteEditor.tsx — the same multi-file
 * fan-out pattern flagged for `IslSettings.cost`/`linkModel` (S-4). Bundling
 * them means adding a 5th piece of committed scenario data in the future
 * touches this one type instead of every call site's signature
 * (isl-routing-review.md SP-11).
 */
export interface CommittedScenario {
  satellites: SatelliteSpec[];
  groundStations: GroundStation[];
  startTime: Date;
  islShellRanges: IslShellRange[];
}
