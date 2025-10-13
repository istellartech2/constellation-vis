import type { SatelliteSpec } from "../src/lib/satellites";
import { parseSatellitesToml, parseConstellationToml } from "../src/lib/tomlParsers";

const satText = await Bun.file("public/satellites.toml").text();
const baseSatellites = parseSatellitesToml(satText);

let constellationSatellites: SatelliteSpec[] = [];
try {
  const constRaw = await Bun.file("public/constellation.toml").text();
  if (constRaw.trim()) {
    constellationSatellites = parseConstellationToml(constRaw);
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

const content = `import type { SatelliteSpec } from "./satellites";

const SATELLITES: SatelliteSpec[] = ${serialize(normalized)};

export default SATELLITES;
`;

await Bun.write("src/lib/satellites.generated.ts", content);
