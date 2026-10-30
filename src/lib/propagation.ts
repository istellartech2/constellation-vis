import { constants, sgp4, type SatRec } from "satellite.js";

/** Same SGP4 and default decay policy as propagate(), with JD shared by a batch. */
export function propagateAtJulianDate(rec: SatRec, julianDate: number) {
  return sgp4(rec, (julianDate - rec.jdsatepoch) * constants.minutesPerDay);
}
