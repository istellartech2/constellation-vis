import type { SatelliteMetadata } from "../satellites";
export const FILING_METADATA_KEYS = ["dataStatus", "filingName", "filingKey", "filingConfiguration", "filingSource", "filingSha256"] as const;
export function serializeFilingMetadata(meta?: SatelliteMetadata): string[] {
  if (meta?.dataStatus !== "filing") return [];
  return FILING_METADATA_KEYS.flatMap(key => meta[key] ? [`${key} = ${JSON.stringify(meta[key])}`] : []);
}
