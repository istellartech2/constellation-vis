import { describe, expect, it } from "bun:test";
import * as satellite from "satellite.js";
import { parseCatalogText, syntheticCatalog } from "../src/lib/catalogParsers";
import { j2AnglesAt, j2OrbitsFromCatalog, j2StateAt, writeKeplerState } from "../src/lib/j2Propagator";
import {
  catalogFromSpecs,
  catalogSatrecAt,
  catalogSpecAt,
  concatCatalogs,
  isFilingRow,
} from "../src/lib/satelliteCatalog";
import { toSatrec, type SatelliteSpec } from "../src/lib/satellites";
import { filingCatalog, filingSatellites } from "../src/lib/filings/geometry";
import type { FilingDataset } from "../src/lib/filings/types";

// ISS-like LEO and a Starlink-like shell, BSTAR zeroed so SGP4's only
// difference from the secular model is its periodic terms.
const LEO = [
  "ISS",
  "1 25544U 98067A   24001.50000000  .00000000  00000-0  00000-0 0  9991",
  "2 25544  51.6400 120.0000 0005000  90.0000  10.0000 15.50000000    04",
];
const STARLINK = [
  "STARLINK-X",
  "1 44713U 19074A   24001.00000000  .00000000  00000-0  00000-0 0  9990",
  "2 44713  53.0000 200.0000 0001500 100.0000 300.0000 15.06000000    01",
];

function distanceKm(a: ArrayLike<number>, b: { x: number; y: number; z: number }) {
  return Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z);
}

describe("catalog parsing", () => {
  it("parses 3LE text with names", () => {
    const { catalog, format, skipped } = parseCatalogText([...LEO, ...STARLINK].join("\n"));
    expect(format).toBe("tle");
    expect(skipped).toBe(0);
    expect(catalog.count).toBe(2);
    expect(catalog.names).toEqual(["ISS", "STARLINK-X"]);
    expect(catalog.satnum[1]).toBe(44713);
  });

  it("parses OMM JSON and CSV", () => {
    const omm = {
      OBJECT_NAME: "SAT A", NORAD_CAT_ID: 123456, EPOCH: "2024-01-01T00:00:00.000",
      MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 53, RA_OF_ASC_NODE: 10,
      ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30, BSTAR: 0.0001,
    };
    const json = parseCatalogText(JSON.stringify([omm, { bogus: true }]));
    expect(json.format).toBe("omm-json");
    expect(json.catalog.count).toBe(1);
    expect(json.skipped).toBe(1);
    expect(json.catalog.epochMs[0]).toBe(Date.UTC(2024, 0, 1));
    const header = Object.keys(omm).join(",");
    const csv = parseCatalogText(`${header}\n${Object.values(omm).map((v) => (typeof v === "string" ? `"${v}"` : v)).join(",")}\n`);
    expect(csv.format).toBe("omm-csv");
    expect(csv.catalog.names[0]).toBe("SAT A");
    expect(csv.catalog.inclination[0]).toBeCloseTo((53 * Math.PI) / 180, 12);
  });

  it("round-trips editor specs and keeps SGP4 identical", () => {
    const specs: SatelliteSpec[] = [
      { type: "tle", lines: [LEO[1], LEO[2]], meta: { objectName: "ISS" } },
      {
        type: "elements",
        elements: {
          satnum: 90001, epoch: new Date(Date.UTC(2024, 0, 1)), semiMajorAxisKm: 6928.137,
          eccentricity: 0.001, inclinationDeg: 97.6, raanDeg: 40, argPerigeeDeg: 0, meanAnomalyDeg: 15,
        },
      },
    ];
    const cat = catalogFromSpecs(specs);
    const t = new Date(Date.UTC(2024, 0, 1, 6));
    for (let i = 0; i < specs.length; i++) {
      const a = satellite.propagate(toSatrec(specs[i]), t);
      const b = satellite.propagate(catalogSatrecAt(cat, i), t);
      const c = satellite.propagate(toSatrec(catalogSpecAt(cat, i)), t);
      if (!a?.position || !b?.position || !c?.position) throw new Error("propagation failed");
      expect(distanceKm([b.position.x, b.position.y, b.position.z], a.position)).toBeLessThan(0.01);
      expect(distanceKm([c.position.x, c.position.y, c.position.z], a.position)).toBeLessThan(0.01);
    }
  });

  it("concatenates catalogs and rebases shared metadata", () => {
    const filing: SatelliteSpec = {
      type: "elements",
      elements: { satnum: 9, epoch: new Date(0), semiMajorAxisKm: 7000, eccentricity: 0, inclinationDeg: 0, raanDeg: 0, argPerigeeDeg: 0, meanAnomalyDeg: 0 },
      meta: { dataStatus: "filing", filingName: "F" },
    };
    const merged = concatCatalogs([catalogFromSpecs([filing]), catalogFromSpecs([filing]), syntheticCatalog(3, 0)]);
    expect(merged.count).toBe(5);
    expect(isFilingRow(merged, 0)).toBe(true);
    expect(isFilingRow(merged, 1)).toBe(true);
    expect(isFilingRow(merged, 2)).toBe(false);
    expect(merged.metaTable[merged.metaIndex[1]].filingName).toBe("F");
  });
});

describe("J2 secular propagator", () => {
  it("stays within ~10 km of SGP4 over a day in LEO", () => {
    const { catalog } = parseCatalogText([...LEO, ...STARLINK].join("\n"));
    const orbits = j2OrbitsFromCatalog(catalog);
    const pos = new Float64Array(3);
    for (let i = 0; i < catalog.count; i++) {
      const rec = catalogSatrecAt(catalog, i);
      let worst = 0;
      for (let h = 0; h <= 24; h += 1) {
        const t = catalog.epochMs[i] + h * 3600_000;
        const ref = satellite.propagate(rec, new Date(t));
        if (!ref?.position) throw new Error("sgp4 failed");
        j2StateAt(orbits, i, t, pos);
        worst = Math.max(worst, distanceKm(pos, ref.position));
      }
      expect(worst).toBeLessThan(15);
    }
  });

  it("gives the same position from rebased float32 angles (GPU path)", () => {
    const cat = syntheticCatalog(2000, Date.UTC(2024, 0, 1));
    const orbits = j2OrbitsFromCatalog(cat);
    const refMs = Date.UTC(2024, 5, 1);
    const angles = new Float32Array(cat.count * 3);
    j2AnglesAt(orbits, refMs, angles);
    const t = refMs + 3 * 3600_000;
    const dtMin = Math.fround((t - refMs) / 60000);
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    let worst = 0;
    for (let i = 0; i < cat.count; i++) {
      j2StateAt(orbits, i, t, a);
      // Mirror the shader: float32 angles + float32 rate × dt.
      const f = Math.fround;
      writeKeplerState(
        f(orbits.semiMajorAxisKm[i]), f(cat.eccentricity[i]), f(cat.inclination[i]),
        f(angles[i * 3] + f(orbits.raanDot[i]) * dtMin),
        f(angles[i * 3 + 1] + f(orbits.argPerigeeDot[i]) * dtMin),
        f(angles[i * 3 + 2] + f(orbits.meanAnomalyDot[i]) * dtMin),
        b,
      );
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    expect(worst).toBeLessThan(0.5);
  });
});

describe("filing catalogs", () => {
  const dataset: FilingDataset = {
    key: "k", name: "MEGA", filename: "f.mdb", sha256: "s", sourceUrl: "u", reference: "r",
    sourceDate: "d", note: "", warnings: [], preferredConfiguration: "default",
    configurations: [{
      id: "default", count: 6, hasSuppressedRows: false,
      planes: [1, 2].map((id) => ({
        id, satellites: 3, inclination: 53, apogee: 560, perigee: 540,
        ascendingLongitude: null, argumentOfPerigee: 0, phases: [], action: "",
      })),
    }],
  };

  it("matches the editor filing geometry row for row", () => {
    const epoch = new Date(Date.UTC(2024, 0, 1));
    const specs = filingSatellites(dataset, "default", epoch);
    const cat = filingCatalog(dataset, "default", epoch);
    expect(cat.count).toBe(specs.length);
    for (let i = 0; i < cat.count; i++) {
      const spec = catalogSpecAt(cat, i);
      const ref = specs[i];
      if (spec.type !== "elements" || ref.type !== "elements") throw new Error("expected elements");
      expect(spec.elements.semiMajorAxisKm).toBeCloseTo(ref.elements.semiMajorAxisKm, 6);
      expect(spec.elements.raanDeg).toBeCloseTo(ref.elements.raanDeg, 9);
      expect(spec.elements.meanAnomalyDeg).toBeCloseTo(ref.elements.meanAnomalyDeg, 9);
      expect(spec.meta?.objectName).toBe(ref.meta?.objectName);
      expect(spec.meta?.dataStatus).toBe("filing");
    }
  });
});
