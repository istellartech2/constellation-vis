import { describe, it, expect } from "bun:test";
import { computeFovConeQuaternion, computeSensorDirectionEci } from "../src/lib/orbitalCoordinates";
import { computeFovBoresightEcf } from "../src/lib/visibility";
import { DEFAULT_SATELLITE_ATTITUDE } from "../src/lib/attitude/types";

/**
 * Outputs of the FOV pointing functions captured *before* satellite attitude
 * was introduced. The default attitude (地球指向 / LVLH) must keep reproducing
 * them bit for bit, with and without the new optional attitude argument.
 */
const GOLDEN: Record<string, { q: number[]; d: number[]; b: number[] }> & {
  noVel: { x: number; y: number; z: number };
  zeroVel: { x: number; y: number; z: number };
} = {"circular_0_0":{"q":[0.2870362738662618,0,-0.3280414558471563,0.8999994337390723],"d":[-0.5904742490107631,0.5166649678844177,-0.6199979614613013],"b":[0.2925066683223584,0.7280400928319709,-0.6199979614613013]},"circular_15_-20":{"q":[0.3000974179281029,0,-0.10678608482420902,0.9479125866032176],"d":[-0.20244774775789326,0.5689322393223495,-0.797076543681605],"b":[0.47006669053102995,0.3790861247339338,-0.797076543681605]},"circular_-30_45":{"q":[0.08355831564455149,0,-0.720726544192532,0.6881651374364555],"d":[-0.991957762676711,0.11500383953898309,0.05285748723412858],"b":[-0.21926471134065995,0.9742325556067151,0.05285748723412858]},"eccentric_0_0":{"q":[-0.5071911244844306,0,0.3803933433633229,0.7733421413379024],"d":[0.5883484054145521,-0.7844645405527362,-0.19611613513818404],"b":[-0.5459632986032282,-0.8145320976589836,-0.19611613513818404]},"eccentric_15_-20":{"q":[-0.5664868154438517,0,0.12472600035301515,0.8145772601565938],"d":[0.20319792727569888,-0.9228945560781735,-0.3270722255284463],"b":[-0.8038948623621839,-0.49676635308317185,-0.3270722255284463]},"eccentric_-30_45":{"q":[-0.05927792647626549,0,0.7546683052116719,0.6534231986558305],"d":[0.9862355558311708,-0.07746714465561311,0.14607624691676568],"b":[0.252801537787704,-0.9564272646567977,0.14607624691676568]},"noVel":{"x":-0.5459632986032281,"y":-0.8145320976589835,"z":-0.19611613513818402},"zeroVel":{"x":-0.5459632986032281,"y":-0.8145320976589835,"z":-0.19611613513818402}};

const STATES = {
  circular: { pos: { x: 4000, y: -3500, z: 4200 }, vel: { x: 3.1, y: 6.2, z: -0.4 } },
  eccentric: { pos: { x: -9000, y: 12000, z: 3000 }, vel: { x: -3.9, y: -1.2, z: 2.6 } },
};
const TILTS = [[0, 0], [15, -20], [-30, 45]] as const;
const GMST = 1.234;
const DATE = new Date("2026-03-20T12:00:00Z");
const LVLH = { settings: DEFAULT_SATELLITE_ATTITUDE, stations: [], date: DATE };

describe("FOV pointing golden values (地球指向 must not change)", () => {
  for (const [name, s] of Object.entries(STATES)) {
    for (const [a, c] of TILTS) {
      const g = GOLDEN[`${name}_${a}_${c}`];
      it(`${name} orbit, tilt ${a}/${c}`, () => {
        const q = computeFovConeQuaternion(s.pos, s.vel, a, c)!;
        expect([q.x, q.y, q.z, q.w]).toEqual(g.q);
        const d = computeSensorDirectionEci(s.pos, s.vel, a, c)!;
        expect([d.x, d.y, d.z]).toEqual(g.d);
        const fov = { halfAngleDeg: 30, alongTrackDeg: a, crossTrackDeg: c };
        const b = computeFovBoresightEcf(s.pos, s.vel, GMST, fov)!;
        expect([b.x, b.y, b.z]).toEqual(g.b);
        const bl = computeFovBoresightEcf(s.pos, s.vel, GMST, fov, LVLH)!;
        expect([bl.x, bl.y, bl.z]).toEqual(g.b);
      });
    }
  }

  it("falls back to pure nadir (tilts dropped) without a usable velocity", () => {
    const fov = { halfAngleDeg: 30, alongTrackDeg: 15, crossTrackDeg: -20 };
    expect(computeFovBoresightEcf(STATES.eccentric.pos, undefined, GMST, fov)).toEqual(GOLDEN.noVel);
    expect(computeFovBoresightEcf(STATES.eccentric.pos, { x: 0, y: 0, z: 0 }, GMST, fov)).toEqual(GOLDEN.zeroVel);
    expect(computeFovBoresightEcf(STATES.eccentric.pos, undefined, GMST, fov, LVLH)).toEqual(GOLDEN.noVel);
  });
});
