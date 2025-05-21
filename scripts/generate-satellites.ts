const text = await Bun.file("public/satellites.toml").text();
const { satellites } = Bun.TOML.parse(text) as { satellites: any[] };

function serialize(value: any): string {
  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([k, v]) => `${k}: ${serialize(v)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

const normalized = satellites.map((s) => {
  if (s.type === "tle") {
    return { type: "tle", lines: [s.line1, s.line2] };
  }
  if (s.type === "elements") {
    return {
      type: "elements",
      elements: {
        satnum: Number(s.satnum),
        epoch: new Date(String(s.epoch)),
        semiMajorAxisKm: Number(s.semiMajorAxisKm),
        eccentricity: Number(s.eccentricity),
        inclinationDeg: Number(s.inclinationDeg),
        raanDeg: Number(s.raanDeg),
        argPerigeeDeg: Number(s.argPerigeeDeg),
        meanAnomalyDeg: Number(s.meanAnomalyDeg),
      },
    };
  }
  throw new Error("Unknown satellite type");
});

const content = `import type { SatelliteSpec } from "./satellites";

const SATELLITES: SatelliteSpec[] = ${serialize(normalized)};

export default SATELLITES;
`;

await Bun.write("src/satellites.generated.ts", content);

