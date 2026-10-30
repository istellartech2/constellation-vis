import {
  createCatalog,
  parseTleFields,
  setCatalogRow,
  truncateCatalog,
  type SatelliteCatalog,
} from "./satelliteCatalog";

/**
 * Parsers for large satellite catalogs (TLE / 3LE text, OMM JSON, OMM CSV)
 * straight into a columnar {@link SatelliteCatalog}. They scan the text with
 * `indexOf` instead of `split`, so a 1M-satellite TLE file does not
 * materialise millions of intermediate line strings at once.
 */

export type CatalogFormat = "tle" | "omm-json" | "omm-csv";

export interface CatalogParseResult {
  catalog: SatelliteCatalog;
  format: CatalogFormat;
  /** Rows that could not be parsed and were skipped. */
  skipped: number;
}

export function detectCatalogFormat(text: string): CatalogFormat {
  const head = text.slice(0, 4096).trimStart();
  if (head.startsWith("[") || head.startsWith("{")) return "omm-json";
  const firstLine = head.slice(0, head.indexOf("\n") === -1 ? head.length : head.indexOf("\n"));
  if (/MEAN_MOTION/i.test(firstLine) && firstLine.includes(",")) return "omm-csv";
  return "tle";
}

export function parseCatalogText(text: string): CatalogParseResult {
  const format = detectCatalogFormat(text);
  const result = format === "omm-json" ? parseOmmJson(text)
    : format === "omm-csv" ? parseOmmCsv(text)
    : parseTleText(text);
  if (result.catalog.count === 0) throw new Error("衛星データが見つかりませんでした（TLE/3LE、OMM JSON、OMM CSVに対応）");
  return { ...result, format };
}

function* lines(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    yield line;
    start = end + 1;
  }
}

function countLines(text: string): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

export function parseTleText(text: string): Omit<CatalogParseResult, "format"> {
  const cat = createCatalog(Math.ceil(countLines(text) / 2));
  let row = 0;
  let skipped = 0;
  let name = "";
  let line1: string | null = null;
  for (const raw of lines(text)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line1 === null && line.startsWith("1 ")) {
      line1 = line;
      continue;
    }
    if (line1 !== null && line.startsWith("2 ")) {
      try {
        setCatalogRow(cat, row, { ...parseTleFields(line1, line), name });
        row++;
      } catch {
        skipped++;
      }
      line1 = null;
      name = "";
      continue;
    }
    if (line1 !== null) skipped++;
    line1 = null;
    // 3LE title line; "0 NAME" is the Space-Track variant.
    name = line.startsWith("0 ") ? line.slice(2).trim() : line.trim();
  }
  return { catalog: truncateCatalog(cat, row), skipped };
}

type OmmRecord = Record<string, unknown>;

function ommEpochMs(value: unknown): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return NaN;
  // OMM epochs are UTC even when the zone suffix is omitted (CelesTrak).
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`).getTime();
}

function writeOmmRow(cat: SatelliteCatalog, row: number, rec: OmmRecord): boolean {
  const num = (k: string) => {
    const v = rec[k] ?? rec[k.toLowerCase()];
    return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  };
  const fields = {
    satnum: num("NORAD_CAT_ID"),
    epochMs: ommEpochMs(rec.EPOCH ?? rec.epoch),
    meanMotionRevDay: num("MEAN_MOTION"),
    eccentricity: num("ECCENTRICITY"),
    inclinationDeg: num("INCLINATION"),
    raanDeg: num("RA_OF_ASC_NODE"),
    argPerigeeDeg: num("ARG_OF_PERICENTER"),
    meanAnomalyDeg: num("MEAN_ANOMALY"),
  };
  if (Object.values(fields).some((v) => !Number.isFinite(v))) return false;
  if (fields.meanMotionRevDay <= 0 || fields.eccentricity < 0 || fields.eccentricity >= 1) return false;
  if (!Number.isInteger(fields.satnum) || fields.satnum < 0 || fields.satnum > 999999999) return false;
  const bstar = num("BSTAR");
  const name = rec.OBJECT_NAME ?? rec.object_name;
  setCatalogRow(cat, row, {
    ...fields,
    bstar: Number.isFinite(bstar) ? bstar : 0,
    name: typeof name === "string" ? name : "",
  });
  return true;
}

export function parseOmmJson(text: string): Omit<CatalogParseResult, "format"> {
  const parsed: unknown = JSON.parse(text);
  const records = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : [parsed];
  return catalogFromOmmRecords(records);
}

/** OMM records already parsed (e.g. a CelesTrak JSON response) into a catalog. */
export function catalogFromOmmRecords(records: readonly unknown[]): Omit<CatalogParseResult, "format"> {
  const cat = createCatalog(records.length);
  let row = 0;
  for (const rec of records) {
    if (rec && typeof rec === "object" && writeOmmRow(cat, row, rec as OmmRecord)) row++;
  }
  return { catalog: truncateCatalog(cat, row), skipped: records.length - row };
}

/** Split one CSV line, honouring double-quoted fields. */
function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseOmmCsv(text: string): Omit<CatalogParseResult, "format"> {
  const cat = createCatalog(Math.max(countLines(text) - 1, 0));
  let header: string[] | null = null;
  let row = 0;
  let skipped = 0;
  const rec: OmmRecord = {};
  for (const line of lines(text)) {
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    if (!header) {
      header = cells.map((h) => h.trim().toUpperCase());
      continue;
    }
    for (let k = 0; k < header.length; k++) rec[header[k]] = cells[k];
    if (writeOmmRow(cat, row, rec)) row++;
    else skipped++;
  }
  return { catalog: truncateCatalog(cat, row), skipped };
}
