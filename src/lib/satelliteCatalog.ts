import * as satellite from "satellite.js";
import type { SatelliteMetadata, SatelliteSpec } from "./satellites";

/**
 * Columnar (structure-of-arrays) satellite store for catalogs too large to
 * hold as one `SatelliteSpec` object per satellite (10^5–10^6 entries).
 *
 * Elements are the SGP4 mean elements exactly as published in TLE/OMM
 * (Kozai mean motion), so a row can be turned back into a `SatelliteSpec` or
 * an SGP4 satrec on demand (selection, info card) without loss. Roughly
 * 70 bytes per satellite plus its name.
 */
export interface SatelliteCatalog {
  count: number;
  /** Catalog number (NORAD or a synthetic id), up to 9 digits. */
  satnum: Uint32Array;
  epochMs: Float64Array;
  /** Kozai mean motion as published in TLE/OMM, rad/min. */
  meanMotion: Float64Array;
  eccentricity: Float64Array;
  /** Angles in radians. */
  inclination: Float64Array;
  raan: Float64Array;
  argPerigee: Float64Array;
  meanAnomaly: Float64Array;
  /** SGP4 drag term (1/Earth radii); only used when a row is re-expanded to SGP4. */
  bstar: Float32Array;
  /** Index into `metaTable` per satellite (0 = no shared metadata). */
  metaIndex: Uint16Array;
  /** Shared metadata (e.g. one filing) referenced by `metaIndex`; entry 0 is always `{}`. */
  metaTable: SatelliteMetadata[];
  /** Object names; "" when the source had none. */
  names: string[];
}

/** μ used by `elementsToTle` in `satellites.ts`; kept identical so specs round-trip. */
const SPEC_MU_KM3_S2 = 398600.4418;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

export function createCatalog(count: number): SatelliteCatalog {
  return {
    count,
    satnum: new Uint32Array(count),
    epochMs: new Float64Array(count),
    meanMotion: new Float64Array(count),
    eccentricity: new Float64Array(count),
    inclination: new Float64Array(count),
    raan: new Float64Array(count),
    argPerigee: new Float64Array(count),
    meanAnomaly: new Float64Array(count),
    bstar: new Float32Array(count),
    metaIndex: new Uint16Array(count),
    metaTable: [{}],
    names: new Array<string>(count).fill(""),
  };
}

/** Shrink a catalog filled only up to `count` rows (parsers over-allocate). */
export function truncateCatalog(cat: SatelliteCatalog, count: number): SatelliteCatalog {
  if (count === cat.count) return cat;
  return {
    count,
    satnum: cat.satnum.slice(0, count),
    epochMs: cat.epochMs.slice(0, count),
    meanMotion: cat.meanMotion.slice(0, count),
    eccentricity: cat.eccentricity.slice(0, count),
    inclination: cat.inclination.slice(0, count),
    raan: cat.raan.slice(0, count),
    argPerigee: cat.argPerigee.slice(0, count),
    meanAnomaly: cat.meanAnomaly.slice(0, count),
    bstar: cat.bstar.slice(0, count),
    metaIndex: cat.metaIndex.slice(0, count),
    metaTable: cat.metaTable,
    names: cat.names.slice(0, count),
  };
}

export function isFilingRow(cat: SatelliteCatalog, i: number): boolean {
  return cat.metaTable[cat.metaIndex[i]]?.dataStatus === "filing";
}

/** Parse the orbital fields of a TLE pair. Throws on malformed lines. */
export function parseTleFields(line1: string, line2: string) {
  if (line1[0] !== "1" || line2[0] !== "2" || line1.length < 64 || line2.length < 63) {
    throw new Error("TLEの形式が不正です");
  }
  const yy = Number(line1.slice(18, 20));
  const doy = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  // BSTAR: implied decimal point and exponent, e.g. " 12345-3" = 0.12345e-3.
  const b = line1.slice(53, 61).trim();
  const bm = /^([+-]?)(\d+)([+-]\d)$/.exec(b);
  const bstar = bm ? Number(`${bm[1]}0.${bm[2]}e${bm[3]}`) : 0;
  const fields = {
    satnum: parseAlpha5(line2.slice(2, 7)),
    epochMs,
    inclinationDeg: Number(line2.slice(8, 16)),
    raanDeg: Number(line2.slice(17, 25)),
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argPerigeeDeg: Number(line2.slice(34, 42)),
    meanAnomalyDeg: Number(line2.slice(43, 51)),
    meanMotionRevDay: Number(line2.slice(52, 63)),
    bstar: Number.isFinite(bstar) ? bstar : 0,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!Number.isFinite(value)) throw new Error(`TLEの${key}が不正です`);
  }
  return fields;
}

/** Five-character catalog numbers, including Alpha-5 (A0000 = 100000). */
function parseAlpha5(text: string): number {
  const t = text.trim();
  if (/^[A-Z]/i.test(t)) {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const k = letters.indexOf(t[0].toUpperCase());
    return (k + 10) * 10000 + Number(t.slice(1));
  }
  return Number(t);
}

/** Write one row from elements in degrees / rev-per-day units. */
export function setCatalogRow(
  cat: SatelliteCatalog,
  i: number,
  row: {
    satnum: number;
    epochMs: number;
    meanMotionRevDay: number;
    eccentricity: number;
    inclinationDeg: number;
    raanDeg: number;
    argPerigeeDeg: number;
    meanAnomalyDeg: number;
    bstar?: number;
    name?: string;
    metaIndex?: number;
  },
) {
  cat.satnum[i] = row.satnum;
  cat.epochMs[i] = row.epochMs;
  cat.meanMotion[i] = (row.meanMotionRevDay * TWO_PI) / 1440;
  cat.eccentricity[i] = row.eccentricity;
  cat.inclination[i] = row.inclinationDeg * DEG;
  cat.raan[i] = row.raanDeg * DEG;
  cat.argPerigee[i] = row.argPerigeeDeg * DEG;
  cat.meanAnomaly[i] = row.meanAnomalyDeg * DEG;
  cat.bstar[i] = row.bstar ?? 0;
  cat.metaIndex[i] = row.metaIndex ?? 0;
  cat.names[i] = row.name ?? "";
}

/** Register shared metadata and return its `metaIndex`. */
export function addCatalogMeta(cat: SatelliteCatalog, meta: SatelliteMetadata): number {
  if (cat.metaTable.length >= 0xffff) throw new Error("カタログのメタデータ種別が多すぎます");
  cat.metaTable.push(meta);
  return cat.metaTable.length - 1;
}

/** Convert scenario specs (editor satellites) into catalog rows. */
export function catalogFromSpecs(specs: SatelliteSpec[]): SatelliteCatalog {
  const cat = createCatalog(specs.length);
  specs.forEach((spec, i) => {
    let metaIndex = 0;
    if (spec.meta?.dataStatus === "filing") metaIndex = addCatalogMeta(cat, { ...spec.meta, objectName: undefined });
    const name = spec.meta?.objectName ?? "";
    if (spec.type === "tle") {
      setCatalogRow(cat, i, { ...parseTleFields(spec.lines[0], spec.lines[1]), name, metaIndex });
      return;
    }
    const el = spec.elements;
    const nRadS = Math.sqrt(SPEC_MU_KM3_S2 / el.semiMajorAxisKm ** 3);
    setCatalogRow(cat, i, {
      satnum: el.satnum,
      epochMs: el.epoch.getTime(),
      meanMotionRevDay: (nRadS * 86400) / TWO_PI,
      eccentricity: el.eccentricity,
      inclinationDeg: el.inclinationDeg,
      raanDeg: el.raanDeg,
      argPerigeeDeg: el.argPerigeeDeg,
      meanAnomalyDeg: el.meanAnomalyDeg,
      name,
      metaIndex,
    });
  });
  return cat;
}

/** Concatenate catalogs, re-basing each one's metadata table. */
export function concatCatalogs(cats: SatelliteCatalog[]): SatelliteCatalog {
  if (cats.length === 1) return cats[0];
  const total = cats.reduce((sum, c) => sum + c.count, 0);
  const out = createCatalog(total);
  let offset = 0;
  for (const c of cats) {
    out.satnum.set(c.satnum, offset);
    out.epochMs.set(c.epochMs, offset);
    out.meanMotion.set(c.meanMotion, offset);
    out.eccentricity.set(c.eccentricity, offset);
    out.inclination.set(c.inclination, offset);
    out.raan.set(c.raan, offset);
    out.argPerigee.set(c.argPerigee, offset);
    out.meanAnomaly.set(c.meanAnomaly, offset);
    out.bstar.set(c.bstar, offset);
    const metaBase = out.metaTable.length - 1;
    out.metaTable.push(...c.metaTable.slice(1));
    if (out.metaTable.length > 0xffff) throw new Error("カタログのメタデータ種別が多すぎます");
    for (let i = 0; i < c.count; i++) {
      const m = c.metaIndex[i];
      out.metaIndex[offset + i] = m === 0 ? 0 : m + metaBase;
      out.names[offset + i] = c.names[i];
    }
    offset += c.count;
  }
  return out;
}

/** Expand one row into a `SatelliteSpec` (for the info card and analyses). */
export function catalogSpecAt(cat: SatelliteCatalog, i: number): SatelliteSpec {
  const nRadS = cat.meanMotion[i] / 60;
  const meta: SatelliteMetadata = { ...cat.metaTable[cat.metaIndex[i]] };
  // Filing rows keep only a short plane/slot label; rebuild the editor's
  // "<filing> / 仮配置 <config> / P1-1" name so both paths read the same.
  if (cat.names[i]) {
    meta.objectName = meta.filingName
      ? `${meta.filingName} / 仮配置 ${meta.filingConfiguration ?? ""} / ${cat.names[i]}`
      : cat.names[i];
  }
  return {
    type: "elements",
    elements: {
      satnum: cat.satnum[i],
      epoch: new Date(cat.epochMs[i]),
      semiMajorAxisKm: Math.cbrt(SPEC_MU_KM3_S2 / (nRadS * nRadS)),
      eccentricity: cat.eccentricity[i],
      inclinationDeg: cat.inclination[i] / DEG,
      raanDeg: cat.raan[i] / DEG,
      argPerigeeDeg: cat.argPerigee[i] / DEG,
      meanAnomalyDeg: cat.meanAnomaly[i] / DEG,
    },
    meta,
  };
}

/** Full SGP4 satrec for one row, including BSTAR drag. */
export function catalogSatrecAt(cat: SatelliteCatalog, i: number): satellite.SatRec {
  return satellite.json2satrec({
    OBJECT_NAME: cat.names[i],
    OBJECT_ID: "",
    NORAD_CAT_ID: cat.satnum[i],
    EPOCH: new Date(cat.epochMs[i]).toISOString(),
    MEAN_MOTION: (cat.meanMotion[i] * 1440) / TWO_PI,
    ECCENTRICITY: cat.eccentricity[i],
    INCLINATION: cat.inclination[i] / DEG,
    RA_OF_ASC_NODE: cat.raan[i] / DEG,
    ARG_OF_PERICENTER: cat.argPerigee[i] / DEG,
    MEAN_ANOMALY: cat.meanAnomaly[i] / DEG,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
    BSTAR: cat.bstar[i],
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: "U",
    ELEMENT_SET_NO: 0,
    REV_AT_EPOCH: 0,
  });
}

/** Typed arrays of a catalog, for zero-copy transfer to/from workers. */
export function catalogTransferables(cat: SatelliteCatalog): ArrayBuffer[] {
  return [
    cat.satnum, cat.epochMs, cat.meanMotion, cat.eccentricity, cat.inclination,
    cat.raan, cat.argPerigee, cat.meanAnomaly, cat.bstar, cat.metaIndex,
  ].map((a) => a.buffer as ArrayBuffer);
}
