import { describe, expect, it } from "bun:test";
import { jday, propagate } from "satellite.js";
import { propagateAtJulianDate } from "../src/lib/propagation";
import { toSatrec, type SatelliteSpec } from "../src/lib/satellites";
import { propagateAll } from "../src/lib/isl/propagate";

const epoch = new Date("2026-10-30T12:34:56.789Z");
const specs: SatelliteSpec[] = [6878, 42164, 26600].map((semiMajorAxisKm, i) => ({
  type: "elements",
  elements: {
    satnum: 90001 + i, epoch, semiMajorAxisKm,
    eccentricity: i === 2 ? 0.7 : 0.001,
    inclinationDeg: 63.4, raanDeg: 30, argPerigeeDeg: 270, meanAnomalyDeg: 10,
  },
}));

describe("shared Julian-date propagation", () => {
  it("matches propagate for LEO, GEO and eccentric deep-space orbits, including time reversal", () => {
    for (const spec of specs) {
      const reference = toSatrec(spec);
      const batched = toSatrec(spec);
      for (const seconds of [0, 0.123, 60, 86400, -86400, 3600]) {
        const date = new Date(epoch.getTime() + seconds * 1000);
        expect(propagateAtJulianDate(batched, jday(date))).toEqual(propagate(reference, date));
      }
    }
  });

  it("preserves invalid-position flags and overwrites a reused routing buffer", () => {
    const rec = toSatrec(specs[0]);
    const out = propagateAll([rec], epoch);
    expect(out.valid).toEqual([true]);
    rec.ecco = 1.5;
    expect(propagateAtJulianDate(rec, jday(epoch))).toBeNull();
    const reused = propagateAll([rec], epoch, out);
    expect(reused.positions).toBe(out.positions);
    expect(reused.valid).toEqual([false]);
    expect(reused.positions[0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});
