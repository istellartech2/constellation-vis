import { describe, expect, it } from "bun:test";
import type { GroundStation } from "../src/lib/groundStations";
import { GROUND_STATION_PRESETS } from "../src/lib/groundStationPresets";
import {
  fromDraft,
  parseGroundStationsConfig,
  serializeGroundStations,
  toDraft,
  validateGroundStations,
  type GroundStationDraft,
} from "../src/lib/groundStationSerializer";

const TOKYO: GroundStation = { name: "Tokyo", latitudeDeg: 35.6895, longitudeDeg: 139.6917, heightKm: 0.04, minElevationDeg: 10 };

const draft = (s: Partial<GroundStation>, id = "a"): GroundStationDraft => ({ ...TOKYO, ...s, id });

describe("ground station TOML round trip", () => {
  it("returns what it wrote, including optional visibility fields", () => {
    const stations: GroundStation[] = [
      TOKYO,
      { name: "Svalbard", latitudeDeg: 78.2297, longitudeDeg: 15.4077, heightKm: 0.5, minElevationDeg: 5, visibilityMode: "and", maxOffNadirDeg: 45 },
      { name: "South Pole", latitudeDeg: -90, longitudeDeg: -180, heightKm: 2.835, minElevationDeg: 0 },
    ];
    expect(parseGroundStationsConfig(serializeGroundStations(stations))).toEqual(stations);
  });

  it("keeps quotes and backslashes in names", () => {
    const station = { ...TOKYO, name: 'Lab "B" \\ annex' };
    expect(parseGroundStationsConfig(serializeGroundStations([station]))).toEqual([station]);
  });

  it("keeps full numeric precision", () => {
    const station = { ...TOKYO, latitudeDeg: 35.123456789012, longitudeDeg: -0.000001 };
    expect(parseGroundStationsConfig(serializeGroundStations([station]))).toEqual([station]);
  });

  it("treats an empty list and empty text as each other", () => {
    expect(serializeGroundStations([])).toBe("");
    expect(parseGroundStationsConfig("  \n")).toEqual([]);
  });

  it("drops the editor id when leaving the draft form", () => {
    const d = toDraft(TOKYO);
    expect(typeof d.id).toBe("string");
    expect(fromDraft(d)).toEqual({ ...TOKYO, visibilityMode: undefined, maxOffNadirDeg: undefined });
  });
});

describe("validateGroundStations", () => {
  it("accepts every bundled preset", () => {
    const drafts = GROUND_STATION_PRESETS.flatMap((g) => g.presets).map((p, i) =>
      draft({ name: p.name, latitudeDeg: p.latitudeDeg, longitudeDeg: p.longitudeDeg, heightKm: p.heightKm }, String(i)),
    );
    expect(validateGroundStations(drafts)).toEqual([]);
  });

  it("flags blank and case-insensitively duplicated names", () => {
    const errors = validateGroundStations([draft({ name: "Tokyo" }, "a"), draft({ name: " tokyo " }, "b"), draft({ name: "  " }, "c")]);
    expect(errors.map((e) => [e.stationId, e.message])).toEqual([
      ["b", "名前が重複しています"],
      ["c", "名前は必須です"],
    ]);
  });

  it("flags out-of-range and non-finite numbers", () => {
    const errors = validateGroundStations([
      draft({ latitudeDeg: 91, longitudeDeg: Number.NaN, heightKm: -1, minElevationDeg: 90.5, maxOffNadirDeg: -1 }),
    ]);
    expect(errors.map((e) => e.field)).toEqual([
      "station.0.latitudeDeg",
      "station.0.longitudeDeg",
      "station.0.heightKm",
      "station.0.minElevationDeg",
      "station.0.maxOffNadirDeg",
    ]);
  });
});
