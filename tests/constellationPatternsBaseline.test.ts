/**
 * Byte-for-byte baseline of the constellation shell generator.
 *
 * These numbers were captured from `generateFromShellsDetailed` *before* the
 * multi-pattern refactor (`src/lib/constellationPatterns/`) and are hard-coded
 * (not regenerated) on purpose: they are the contract that says "existing TOML
 * files keep producing byte-identical satellites". Every element is compared
 * with `toBe` (exact IEEE-754 equality), so any constant folding or angle
 * normalization that shifts the least significant bit fails here.
 *
 * If a change makes this test fail, the change is wrong — do not re-capture.
 */
import { describe, expect, it } from "bun:test";
import { buildConstellation } from "../src/lib/tomlParsers";
import type { IslShellRange } from "../src/lib/isl/types";

/** [satnum, semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPerigeeDeg, meanAnomalyDeg] */
type ElementRow = [number, number, number, number, number, number, number];

interface Baseline {
  toml: string;
  baseOffset: number;
  ranges: IslShellRange[];
  elements: ElementRow[];
}

/** Copy of `public/constellation.toml` as of the refactor. */
const PUBLIC_CONSTELLATION_TOML = `[constellation]
name  = "ExampleConstellation"
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "LEO-500km-43deg"
count = 3
planes = 1
phasing = 1
apogee_altitude = 500
eccentricity = 0.0001
inclination = 43.0
raan_range = 360.0
# raan_start = 0.0
# argp = 0.0
# mean_anomaly_0 = 0.0
`;

const BASELINES: Record<string, Baseline> = {
  "public/constellation.toml": {
    toml: PUBLIC_CONSTELLATION_TOML,
    baseOffset: 0,
    ranges: [{ key: "0", name: "LEO-500km-43deg", startIndex: 0, count: 3, planes: 1 }],
    elements: [
      [1, 6877.449255074493, 0.0001, 43, 0, 0, 0],
      [2, 6877.449255074493, 0.0001, 43, 0, 0, 120],
      [3, 6877.449255074493, 0.0001, 43, 0, 0, 240],
    ],
  },

  // tests/constellationParser.test.ts — "uses defaults for fields omitted by
  // the constellation UI serializer"
  minimalDefaults: {
    toml: `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
count = 2
planes = 1
`,
    baseOffset: 0,
    ranges: [{ key: "0", name: undefined, startIndex: 0, count: 2, planes: 1 }],
    elements: [
      [1, 6378.137, 0, 0, 0, 0, 0],
      [2, 6378.137, 0, 0, 0, 0, 180],
    ],
  },

  // tests/constellationParser.test.ts — multi-shell full count
  multiShell: {
    toml: `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "shellA"
count = 12
planes = 3
apogee_altitude = 550

[[constellation.shells]]
name = "shellB"
count = 20
planes = 4
apogee_altitude = 780
`,
    baseOffset: 0,
    ranges: [
      { key: "0", name: "shellA", startIndex: 0, count: 12, planes: 3 },
      { key: "1", name: "shellB", startIndex: 12, count: 20, planes: 4 },
    ],
    elements: [
      [1, 6928.137, 0, 0, 0, 0, 0],
      [2, 6928.137, 0, 0, 0, 0, 90],
      [3, 6928.137, 0, 0, 0, 0, 180],
      [4, 6928.137, 0, 0, 0, 0, 270],
      [5, 6928.137, 0, 0, 120, 0, 0],
      [6, 6928.137, 0, 0, 120, 0, 90],
      [7, 6928.137, 0, 0, 120, 0, 180],
      [8, 6928.137, 0, 0, 120, 0, 270],
      [9, 6928.137, 0, 0, 240, 0, 0],
      [10, 6928.137, 0, 0, 240, 0, 90],
      [11, 6928.137, 0, 0, 240, 0, 180],
      [12, 6928.137, 0, 0, 240, 0, 270],
      [13, 7158.137, 0, 0, 0, 0, 0],
      [14, 7158.137, 0, 0, 0, 0, 72],
      [15, 7158.137, 0, 0, 0, 0, 144],
      [16, 7158.137, 0, 0, 0, 0, 216],
      [17, 7158.137, 0, 0, 0, 0, 288],
      [18, 7158.137, 0, 0, 90, 0, 0],
      [19, 7158.137, 0, 0, 90, 0, 72],
      [20, 7158.137, 0, 0, 90, 0, 144],
      [21, 7158.137, 0, 0, 90, 0, 216],
      [22, 7158.137, 0, 0, 90, 0, 288],
      [23, 7158.137, 0, 0, 180, 0, 0],
      [24, 7158.137, 0, 0, 180, 0, 72],
      [25, 7158.137, 0, 0, 180, 0, 144],
      [26, 7158.137, 0, 0, 180, 0, 216],
      [27, 7158.137, 0, 0, 180, 0, 288],
      [28, 7158.137, 0, 0, 270, 0, 0],
      [29, 7158.137, 0, 0, 270, 0, 72],
      [30, 7158.137, 0, 0, 270, 0, 144],
      [31, 7158.137, 0, 0, 270, 0, 216],
      [32, 7158.137, 0, 0, 270, 0, 288],
    ],
  },

  // tests/constellationParser.test.ts — non-zero baseOffset
  offsetShell: {
    toml: `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
count = 6
planes = 2
`,
    baseOffset: 5,
    ranges: [{ key: "0", name: undefined, startIndex: 5, count: 6, planes: 2 }],
    elements: [
      [1, 6378.137, 0, 0, 0, 0, 0],
      [2, 6378.137, 0, 0, 0, 0, 120],
      [3, 6378.137, 0, 0, 0, 0, 240],
      [4, 6378.137, 0, 0, 180, 0, 0],
      [5, 6378.137, 0, 0, 180, 0, 120],
      [6, 6378.137, 0, 0, 180, 0, 240],
    ],
  },

  // Multi-shell, fractional phasing, non-zero raan_start / argp / mean_anomaly_0.
  // `raan_start + raan_range*(P-1)/P` stays below 360 in both shells and every
  // mean anomaly is non-negative, so introducing [0,360) normalization must not
  // change a single value here.
  fractionalPhasing: {
    toml: `
[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "frac"
count = 14
planes = 4
phasing = 1.5
apogee_altitude = 617.25
eccentricity = 0.0012
inclination = 53.2
raan_range = 300
raan_start = 15
argp = 270
mean_anomaly_0 = 30

[[constellation.shells]]
name = "second"
count = 15
planes = 5
phasing = 2
apogee_altitude = 1200
inclination = 87.9
raan_start = 7.5
argp = 12.25
mean_anomaly_0 = 3.75
`,
    baseOffset: 0,
    ranges: [
      { key: "0", name: "frac", startIndex: 0, count: 14, planes: 4 },
      { key: "1", name: "second", startIndex: 14, count: 15, planes: 5 },
    ],
    elements: [
      [1, 6987.002596883739, 0.0012, 53.2, 15, 270, 30],
      [2, 6987.002596883739, 0.0012, 53.2, 15, 270, 132.85714285714286],
      [3, 6987.002596883739, 0.0012, 53.2, 15, 270, 235.71428571428572],
      [4, 6987.002596883739, 0.0012, 53.2, 15, 270, 338.57142857142856],
      [5, 6987.002596883739, 0.0012, 53.2, 90, 270, 68.57142857142857],
      [6, 6987.002596883739, 0.0012, 53.2, 90, 270, 171.42857142857144],
      [7, 6987.002596883739, 0.0012, 53.2, 90, 270, 274.28571428571433],
      [8, 6987.002596883739, 0.0012, 53.2, 90, 270, 17.142857142857167],
      [9, 6987.002596883739, 0.0012, 53.2, 165, 270, 107.14285714285714],
      [10, 6987.002596883739, 0.0012, 53.2, 165, 270, 210],
      [11, 6987.002596883739, 0.0012, 53.2, 165, 270, 312.8571428571429],
      [12, 6987.002596883739, 0.0012, 53.2, 165, 270, 55.71428571428572],
      [13, 6987.002596883739, 0.0012, 53.2, 240, 270, 145.71428571428572],
      [14, 6987.002596883739, 0.0012, 53.2, 240, 270, 248.57142857142858],
      [15, 7578.137, 0, 87.9, 7.5, 12.25, 3.75],
      [16, 7578.137, 0, 87.9, 7.5, 12.25, 123.75],
      [17, 7578.137, 0, 87.9, 7.5, 12.25, 243.75],
      [18, 7578.137, 0, 87.9, 79.5, 12.25, 51.75],
      [19, 7578.137, 0, 87.9, 79.5, 12.25, 171.75],
      [20, 7578.137, 0, 87.9, 79.5, 12.25, 291.75],
      [21, 7578.137, 0, 87.9, 151.5, 12.25, 99.75],
      [22, 7578.137, 0, 87.9, 151.5, 12.25, 219.75],
      [23, 7578.137, 0, 87.9, 151.5, 12.25, 339.75],
      [24, 7578.137, 0, 87.9, 223.5, 12.25, 147.75],
      [25, 7578.137, 0, 87.9, 223.5, 12.25, 267.75],
      [26, 7578.137, 0, 87.9, 223.5, 12.25, 27.75],
      [27, 7578.137, 0, 87.9, 295.5, 12.25, 195.75],
      [28, 7578.137, 0, 87.9, 295.5, 12.25, 315.75],
      [29, 7578.137, 0, 87.9, 295.5, 12.25, 75.75],
    ],
  },
};

describe("constellation generation baseline (pre-pattern-refactor)", () => {
  for (const [name, baseline] of Object.entries(BASELINES)) {
    it(`reproduces every orbital element exactly: ${name}`, () => {
      const built = buildConstellation(baseline.toml, baseline.baseOffset);

      expect(built.satellites).toHaveLength(baseline.elements.length);

      built.satellites.forEach((sat, i) => {
        const expected = baseline.elements[i];
        expect(sat.type).toBe("elements");
        if (sat.type !== "elements") return;
        const el = sat.elements;
        const actual: ElementRow = [
          el.satnum,
          el.semiMajorAxisKm,
          el.eccentricity,
          el.inclinationDeg,
          el.raanDeg,
          el.argPerigeeDeg,
          el.meanAnomalyDeg,
        ];
        // Exact equality, element by element, so a failure names the field.
        const labels = [
          "satnum",
          "semiMajorAxisKm",
          "eccentricity",
          "inclinationDeg",
          "raanDeg",
          "argPerigeeDeg",
          "meanAnomalyDeg",
        ];
        actual.forEach((value, f) => {
          if (value !== expected[f]) {
            throw new Error(
              `${name}[${i}].${labels[f]}: expected ${expected[f]}, got ${value}`,
            );
          }
        });
        expect(el.epoch.toISOString()).toBe("2025-05-20T00:00:00.000Z");
      });
    });

    it(`reproduces the ISL shell ranges: ${name}`, () => {
      const built = buildConstellation(baseline.toml, baseline.baseOffset);
      expect(built.ranges).toEqual(baseline.ranges);
    });
  }
});
