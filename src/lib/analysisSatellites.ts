import * as satellite from "satellite.js";
import { parseConstellationToml, parseSatellitesToml } from "./config";
import type { SatelliteSpec } from "./satellites";

export interface SelectableSatellite {
  id: string;
  label: string;
  source: "satellites" | "constellation";
  spec: SatelliteSpec;
}

function getSatelliteLabel(spec: SatelliteSpec, index: number, source: SelectableSatellite["source"]): string {
  const metaName = spec.meta?.objectName;
  if (metaName) return metaName;
  if (spec.type === "elements") return `${source}:${spec.elements.satnum}`;
  const rec = satellite.twoline2satrec(spec.lines[0], spec.lines[1]);
  return `${source}:${rec.satnum ?? index + 1}`;
}

export function buildSelectableSatellites(satText: string, constText: string): SelectableSatellite[] {
  const baseSats = satText ? parseSatellitesToml(satText) : [];
  const constSats = constText ? parseConstellationToml(constText) : [];

  return [
    ...baseSats.map((spec, index) => ({
      id: `sat-${index}`,
      label: getSatelliteLabel(spec, index, "satellites"),
      source: "satellites" as const,
      spec,
    })),
    ...constSats.map((spec, index) => ({
      id: `const-${index}`,
      label: getSatelliteLabel(spec, index, "constellation"),
      source: "constellation" as const,
      spec,
    })),
  ];
}

/**
 * The one name an editor satellite goes by in the UI (衛星カードの見出し and
 * the analysis pickers): its object name, else 「衛星 #N」 with N its 1-based
 * position in the editor list (satellites.toml first, then the constellation —
 * the order of buildSelectableSatellites and of App's satellite array).
 */
export function satelliteDisplayName(spec: SatelliteSpec, index: number): string {
  return spec.meta?.objectName ?? `衛星 #${index + 1}`;
}

function specSatnum(spec: SatelliteSpec): string {
  if (spec.type === "elements") return String(spec.elements.satnum);
  // Catalog number, columns 3–7 of line 1 (Alpha-5 letters fall back to SGP4's parse).
  const field = spec.lines[0].substring(2, 7).trim();
  const n = Number(field);
  return Number.isFinite(n) && field !== "" ? String(n) : String(Number(satellite.twoline2satrec(spec.lines[0], spec.lines[1]).satnum) || field);
}

/**
 * Identifier line of the satellite card: 「NORAD 25544 · 1998-067A」, or
 * 「satnum 5」 without a NORAD catalog number.
 */
export function satelliteIdentifiers(spec: SatelliteSpec): string {
  const meta = spec.meta;
  return [
    meta?.noradCatId !== undefined ? `NORAD ${meta.noradCatId}` : null,
    meta?.objectId ?? null,
    meta?.noradCatId === undefined ? `satnum ${specSatnum(spec)}` : null,
  ].filter(Boolean).join(" · ");
}

/** Picker label: the card title plus its first identifier, 「衛星 #5（satnum 5）」 / 「ISS (ZARYA)（NORAD 25544）」. */
export function satellitePickerLabel(spec: SatelliteSpec, index: number): string {
  const name = satelliteDisplayName(spec, index);
  const id = satelliteIdentifiers(spec).split(" · ")[0];
  return id ? `${name}（${id}）` : name;
}
