import type { SatelliteSpec } from "../src/lib/satellites";
import type { IslShellRange } from "../src/lib/isl/types";
import { parseSatellitesToml, buildConstellation } from "../src/lib/tomlParsers";

function extractSatnum(sat: SatelliteSpec): number | null {
  if (sat.type === "elements") {
    return sat.elements.satnum;
  }
  if (sat.type === "tle" && sat.lines[0]) {
    // TLE line 1: columns 3-7 contain the satellite number
    const match = sat.lines[0].match(/^1\s+(\d+)/);
    return match ? Number(match[1]) : null;
  }
  return null;
}

function validateUniqueSatnums(satellites: SatelliteSpec[]): void {
  const seen = new Map<number, number>(); // satnum -> first index
  const duplicates: { satnum: number; indices: number[] }[] = [];

  satellites.forEach((sat, index) => {
    const satnum = extractSatnum(sat);
    if (satnum === null) return;

    if (seen.has(satnum)) {
      const existing = duplicates.find((d) => d.satnum === satnum);
      if (existing) {
        existing.indices.push(index);
      } else {
        duplicates.push({ satnum, indices: [seen.get(satnum)!, index] });
      }
    } else {
      seen.set(satnum, index);
    }
  });

  if (duplicates.length > 0) {
    const messages = duplicates.map(
      (d) => `  satnum ${d.satnum}: found at indices ${d.indices.join(", ")}`
    );
    console.warn(`⚠️  Duplicate satellite IDs detected:\n${messages.join("\n")}`);
  }
}

const satText = await Bun.file("public/satellites.toml").text();
const baseSatellites = parseSatellitesToml(satText);

let constellationSatellites: SatelliteSpec[] = [];
let shellRanges: IslShellRange[] = [];
try {
  const constRaw = await Bun.file("public/constellation.toml").text();
  if (constRaw.trim()) {
    const built = buildConstellation(constRaw, baseSatellites.length);
    constellationSatellites = built.satellites;
    shellRanges = built.ranges;
  }
} catch {
  /* optional constellation file */
}

function serialize(value: unknown): string {
  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${serialize(v)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

const normalized: SatelliteSpec[] = [...baseSatellites, ...constellationSatellites];

// Validate that there are no duplicate satellite IDs
validateUniqueSatnums(normalized);

const content = `import type { SatelliteSpec } from "./satellites";
import type { IslShellRange } from "./isl/types";

const SATELLITES: SatelliteSpec[] = ${serialize(normalized)};

/** Shell ranges for the satellites generated from public/constellation.toml at build time — seeds the ISL tab's shell UI before the user ever clicks "更新" (isl-routing-review.md SP-10). */
export const SHELL_RANGES: IslShellRange[] = ${serialize(shellRanges)};

export default SATELLITES;
`;

await Bun.write("src/lib/satellites.generated.ts", content);
