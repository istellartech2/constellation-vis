/* eslint-disable @typescript-eslint/no-explicit-any */
const satText = await Bun.file("public/satellites.toml").text();
const { satellites: rawSats } = Bun.TOML.parse(satText) as { satellites: any[] };

function preprocessToml(text: string): string {
  return text.replace(
    /(epoch\s*=\s*)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/,
    (_, p1, p2) => `${p1}"${p2}"`,
  );
}

const constellations: any[] = [];
try {
  const constRaw = await Bun.file("public/constellation.toml").text();
  const constText = preprocessToml(constRaw);
  const parsed = Bun.TOML.parse(constText) as any;
  if (parsed.constellation?.shells) {
    constellations.push(parsed.constellation);
  }
} catch {
  /* no constellation file */
}

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

const EARTH_RADIUS_KM = 6371;

function generateFromShells(con: any): any[] {
  const epoch = new Date(String(con.epoch));
  let nextSatnum = 10000;
  const sats: any[] = [];
  for (const shell of con.shells ?? []) {
    const count = Number(shell.count);
    const planes = Number(shell.planes);
    const perPlane = Math.ceil(count / planes);
    const phasing = Number(shell.phasing ?? 0);
    const ecc = Number(shell.eccentricity ?? 0);
    const inc = Number(shell.inclination ?? 0);
    const aAltitude = Number(shell.apogee_altitude ?? 0);
    const raanRange = Number(shell.raan_range ?? 360);
    const raanStart = Number(shell.raan_start ?? 0);
    const argp = Number(shell.argp ?? 0);
    const m0 = Number(shell.mean_anomaly_0 ?? 0);
    const semiMajorAxisKm = (EARTH_RADIUS_KM + aAltitude);

    for (let p = 0; p < planes; p++) {
      const raan = raanStart + (raanRange * p) / planes;
      for (let j = 0; j < perPlane && sats.length < count; j++) {
        const ma = (m0 + (360 / count) * (p * phasing + j * planes)) % 360;
        sats.push({
          type: "elements",
          elements: {
            satnum: nextSatnum++,
            epoch,
            semiMajorAxisKm,
            eccentricity: ecc,
            inclinationDeg: inc,
            raanDeg: raan,
            argPerigeeDeg: argp,
            meanAnomalyDeg: ma,
          },
        });
      }
    }
  }
  return sats;
}

const baseSatellites = rawSats.map((s) => {
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

const constellationSats = constellations.flatMap((c) => generateFromShells(c));

const normalized = [...baseSatellites, ...constellationSats];

const content = `import type { SatelliteSpec } from "./satellites";

const SATELLITES: SatelliteSpec[] = ${serialize(normalized)};

export default SATELLITES;
`;

await Bun.write("src/satellites.generated.ts", content);

