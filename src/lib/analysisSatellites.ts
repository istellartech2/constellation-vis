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
