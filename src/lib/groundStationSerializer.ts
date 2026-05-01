import type { GroundStation, VisibilityMode } from "./groundStations";
import { parseGroundStationsToml } from "./tomlParsers";

export interface GroundStationDraft extends GroundStation {
  id: string;
}

export interface GroundStationValidationError {
  field: string;
  message: string;
  stationId?: string;
}

export function parseGroundStationsConfig(text: string): GroundStation[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return parseGroundStationsToml(text);
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // Strip trailing zeros while preserving precision
  const fixed = value.toString();
  return fixed;
}

export function serializeGroundStations(stations: GroundStation[]): string {
  if (stations.length === 0) return "";
  const blocks = stations.map((s) => {
    const lines = ["[[groundstations]]"];
    lines.push(`name = "${escapeTomlString(s.name)}"`);
    lines.push(`latitudeDeg = ${formatNumber(s.latitudeDeg)}`);
    lines.push(`longitudeDeg = ${formatNumber(s.longitudeDeg)}`);
    lines.push(`heightKm = ${formatNumber(s.heightKm)}`);
    lines.push(`minElevationDeg = ${formatNumber(s.minElevationDeg)}`);
    if (s.visibilityMode) {
      lines.push(`visibilityMode = "${s.visibilityMode}"`);
    }
    if (s.maxOffNadirDeg !== undefined) {
      lines.push(`maxOffNadirDeg = ${formatNumber(s.maxOffNadirDeg)}`);
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n") + "\n";
}

export function validateGroundStations(
  stations: GroundStationDraft[],
): GroundStationValidationError[] {
  const errors: GroundStationValidationError[] = [];
  const seenNames = new Map<string, number>();

  stations.forEach((s, index) => {
    const prefix = `station.${index}`;
    if (!s.name || !s.name.trim()) {
      errors.push({ field: `${prefix}.name`, message: "名前は必須です", stationId: s.id });
    } else {
      const lower = s.name.trim().toLowerCase();
      if (seenNames.has(lower)) {
        errors.push({
          field: `${prefix}.name`,
          message: "名前が重複しています",
          stationId: s.id,
        });
      } else {
        seenNames.set(lower, index);
      }
    }
    if (!Number.isFinite(s.latitudeDeg) || s.latitudeDeg < -90 || s.latitudeDeg > 90) {
      errors.push({
        field: `${prefix}.latitudeDeg`,
        message: "緯度は -90〜90 の範囲",
        stationId: s.id,
      });
    }
    if (!Number.isFinite(s.longitudeDeg) || s.longitudeDeg < -180 || s.longitudeDeg > 180) {
      errors.push({
        field: `${prefix}.longitudeDeg`,
        message: "経度は -180〜180 の範囲",
        stationId: s.id,
      });
    }
    if (!Number.isFinite(s.heightKm) || s.heightKm < 0) {
      errors.push({
        field: `${prefix}.heightKm`,
        message: "高度は 0 以上",
        stationId: s.id,
      });
    }
    if (
      !Number.isFinite(s.minElevationDeg) ||
      s.minElevationDeg < 0 ||
      s.minElevationDeg > 90
    ) {
      errors.push({
        field: `${prefix}.minElevationDeg`,
        message: "最低仰角は 0〜90",
        stationId: s.id,
      });
    }
    if (
      s.maxOffNadirDeg !== undefined &&
      (!Number.isFinite(s.maxOffNadirDeg) ||
        s.maxOffNadirDeg < 0 ||
        s.maxOffNadirDeg > 90)
    ) {
      errors.push({
        field: `${prefix}.maxOffNadirDeg`,
        message: "最大オフナディアは 0〜90",
        stationId: s.id,
      });
    }
  });

  return errors;
}

export function createNewStation(index: number): GroundStationDraft {
  return {
    id: crypto.randomUUID(),
    name: `Station ${index + 1}`,
    latitudeDeg: 0,
    longitudeDeg: 0,
    heightKm: 0,
    minElevationDeg: 10,
  };
}

export function toDraft(station: GroundStation): GroundStationDraft {
  return { ...station, id: crypto.randomUUID() };
}

export function fromDraft(draft: GroundStationDraft): GroundStation {
  return {
    name: draft.name,
    latitudeDeg: draft.latitudeDeg,
    longitudeDeg: draft.longitudeDeg,
    heightKm: draft.heightKm,
    minElevationDeg: draft.minElevationDeg,
    visibilityMode: draft.visibilityMode,
    maxOffNadirDeg: draft.maxOffNadirDeg,
  };
}

export const VISIBILITY_MODE_OPTIONS: { value: VisibilityMode | ""; label: string }[] = [
  { value: "", label: "(未指定: elevation_only)" },
  { value: "elevation_only", label: "elevation_only" },
  { value: "off_nadir_only", label: "off_nadir_only" },
  { value: "and", label: "and (両方満たす)" },
];
