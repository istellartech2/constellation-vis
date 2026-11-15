import { describe, expect, it } from "bun:test";
import { satelliteDisplayName, satelliteIdentifiers, satellitePickerLabel } from "../src/lib/analysisSatellites";
import type { SatelliteSpec } from "../src/lib/satellites";

const elements = (satnum: number, meta?: SatelliteSpec["meta"]): SatelliteSpec => ({
  type: "elements",
  elements: {
    satnum,
    epoch: new Date("2024-01-01T00:00:00Z"),
    semiMajorAxisKm: 6928,
    eccentricity: 0.001,
    inclinationDeg: 53,
    raanDeg: 0,
    argPerigeeDeg: 0,
    meanAnomalyDeg: 0,
  },
  meta,
} as SatelliteSpec);

describe("one satellite name for the card and the analysis pickers", () => {
  it("uses the object name, else 衛星 #N by position in the editor list", () => {
    expect(satelliteDisplayName(elements(7), 4)).toBe("衛星 #5");
    expect(satelliteDisplayName(elements(7, { objectName: "ISS (ZARYA)" }), 0)).toBe("ISS (ZARYA)");
  });

  it("matches the card's identifier line", () => {
    expect(satelliteIdentifiers(elements(7))).toBe("satnum 7");
    expect(satelliteIdentifiers(elements(7, { noradCatId: 25544, objectId: "1998-067A" }))).toBe("NORAD 25544 · 1998-067A");
  });

  it("reads a TLE catalog number without leading zeros", () => {
    const tle: SatelliteSpec = {
      type: "tle",
      lines: [
        "1 00005U 58002B   24001.00000000  .00000023  00000-0  28098-4 0  9990",
        "2 00005  34.2500 100.0000 1846000 200.0000 150.0000 10.85000000    01",
      ],
    };
    expect(satelliteIdentifiers(tle)).toBe("satnum 5");
  });

  it("picker label = card title + first identifier", () => {
    expect(satellitePickerLabel(elements(7), 4)).toBe("衛星 #5（satnum 7）");
    expect(satellitePickerLabel(elements(1, { objectName: "ISS (ZARYA)", noradCatId: 25544 }), 0)).toBe("ISS (ZARYA)（NORAD 25544）");
  });
});
