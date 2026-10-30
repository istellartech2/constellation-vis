import type { SatelliteSpec } from "./satellites";

/**
 * Satellite numbers for objects that exist only in this app: manual entries,
 * formation deputies and filing placeholders.
 *
 * The USSF catalog ran past 99999 on 2026-07-11, so the old 90000–99999
 * placeholder band now holds real objects. New local numbers come from an
 * upper nine-digit band instead, kept apart from the filing catalog layers
 * (`FILING_CATALOG_SATNUM_BASE = 900_000_000`). Numbers above 99999 are
 * propagated through OMM in `toSatrec`.
 */
export const LOCAL_SATNUM_MIN = 910_000_000;
export const LOCAL_SATNUM_MAX = 999_999_999;
/** Band that older scenarios used for local numbers; still read, never allocated. */
export const LEGACY_LOCAL_SATNUM_MIN = 90000;
export const LEGACY_LOCAL_SATNUM_MAX = 99999;

export function isLocalSatnum(satnum: number): boolean {
  return (satnum >= LOCAL_SATNUM_MIN && satnum <= LOCAL_SATNUM_MAX) ||
    (satnum >= LEGACY_LOCAL_SATNUM_MIN && satnum <= LEGACY_LOCAL_SATNUM_MAX);
}

/** Lowest local number not in `used`. */
export function nextLocalSatnum(used: ReadonlySet<number>, from = LOCAL_SATNUM_MIN): number {
  let satnum = Math.max(from, LOCAL_SATNUM_MIN);
  while (used.has(satnum) && satnum <= LOCAL_SATNUM_MAX) satnum++;
  if (satnum > LOCAL_SATNUM_MAX) throw new Error("ローカル衛星番号を割り当てられません。衛星数を減らしてください。");
  return satnum;
}

/**
 * Whether a spec is a local object rather than a catalog one: a filing
 * placeholder, or elements in a local band with no international designator
 * (manual entries and formation deputies; catalog imports carry `objectId`).
 */
export function isLocalSatellite(sat: SatelliteSpec): boolean {
  if (sat.meta?.dataStatus === "filing") return true;
  return sat.type === "elements" && !sat.meta?.objectId && isLocalSatnum(sat.elements.satnum);
}
