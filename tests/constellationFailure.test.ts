/**
 * Failure (attrition) model — `src/lib/constellationPatterns/failure.ts`.
 *
 * The contract that matters is determinism: `constellation.toml` is re-parsed
 * independently by the editor, the analysis workers, the CLI and the prebuild
 * generator, so the same (count, k, seed) must always remove the same
 * satellites. These tests pin that, the plane-size bookkeeping the ISL layer
 * depends on, and the TOML round trip.
 */
import { describe, expect, it } from "bun:test";
import {
  generateShell,
  planShellFailures,
  selectFailedIndices,
  type PatternShellInput,
} from "../src/lib/constellationPatterns";
import {
  parseConstellationConfig,
  serializeConstellationConfig,
  validateConfig,
} from "../src/lib/constellationSerializer";
import { parseConstellationToml } from "../src/lib/tomlParsers";

const EPOCH = new Date("2025-05-20T00:00:00Z");

function walker(overrides: Partial<PatternShellInput> = {}): PatternShellInput {
  return {
    count: 24,
    planes: 3,
    phasing: 1,
    apogee_altitude: 550,
    inclination: 53,
    ...overrides,
  } as PatternShellInput;
}

describe("selectFailedIndices", () => {
  it("draws k distinct in-range indices, ascending", () => {
    const picked = selectFailedIndices(24, 5, 7);
    expect(picked.length).toBe(5);
    expect(new Set(picked).size).toBe(5);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    for (const i of picked) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(24);
    }
  });

  it("is a pure function of (count, k, seed)", () => {
    expect(selectFailedIndices(24, 5, 7)).toEqual(selectFailedIndices(24, 5, 7));
  });

  it("a different seed generally draws a different set", () => {
    expect(selectFailedIndices(24, 5, 7)).not.toEqual(selectFailedIndices(24, 5, 8));
  });

  it("clamps k to the population and 0", () => {
    expect(selectFailedIndices(6, 99, 1).length).toBe(6);
    expect(selectFailedIndices(6, 0, 1)).toEqual([]);
    expect(selectFailedIndices(6, -3, 1)).toEqual([]);
  });
});

describe("planShellFailures", () => {
  it("no failure keys means no failures", () => {
    const plan = planShellFailures(walker(), 24);
    expect(plan.failedCount).toBe(0);
    expect(plan.activeCount).toBe(24);
    expect(plan.mode).toBe("none");
  });

  it("failed_count removes exactly that many", () => {
    const plan = planShellFailures(walker({ failed_count: 4 }), 24);
    expect(plan.failedCount).toBe(4);
    expect(plan.activeCount).toBe(20);
    expect(plan.mode).toBe("count");
  });

  it("failure_percent rounds against the nominal count and wins over failed_count", () => {
    const plan = planShellFailures(walker({ failed_count: 4, failure_percent: 25 }), 24);
    expect(plan.failedCount).toBe(6);
    expect(plan.mode).toBe("percent");
  });

  it("clamps an over-100% or over-count request to the whole shell", () => {
    expect(planShellFailures(walker({ failure_percent: 150 }), 24).failedCount).toBe(24);
    expect(planShellFailures(walker({ failed_count: 99 }), 24).failedCount).toBe(24);
  });
});

describe("generateShell with failures", () => {
  it("emits count - failedCount satellites and reports both", () => {
    const generated = generateShell(walker({ failed_count: 4, failure_seed: 3 }), EPOCH, 1);
    expect(generated.nominalCount).toBe(24);
    expect(generated.failedCount).toBe(4);
    expect(generated.specs.length).toBe(20);
    expect(generated.satellites.length).toBe(20);
  });

  it("keeps planeSizes consistent with the survivors (the ISL layer reads it)", () => {
    const generated = generateShell(walker({ failure_percent: 25, failure_seed: 11 }), EPOCH, 1);
    const total = generated.planeSizes.reduce((a, b) => a + b, 0);
    expect(total).toBe(generated.specs.length);
    expect(generated.planeSizes.length).toBe(generated.planes);
  });

  it("survivors keep their nominal satellite numbers (gaps mark the failures)", () => {
    const healthy = generateShell(walker(), EPOCH, 1);
    const damaged = generateShell(walker({ failed_count: 4, failure_seed: 3 }), EPOCH, 1);

    const nominal = new Map(
      healthy.specs.map((spec) => {
        if (spec.type !== "elements") throw new Error("expected element specs");
        return [spec.elements.satnum, spec.elements.meanAnomalyDeg];
      }),
    );
    for (const spec of damaged.specs) {
      if (spec.type !== "elements") throw new Error("expected element specs");
      expect(nominal.get(spec.elements.satnum)).toBe(spec.elements.meanAnomalyDeg);
    }
    // `nextSatnum` is the nominal one, so a following shell is unaffected.
    expect(damaged.nextSatnum).toBe(healthy.nextSatnum);
  });

  it("is reproducible across independent generations (the editor/worker/CLI contract)", () => {
    const a = generateShell(walker({ failure_percent: 30, failure_seed: 42 }), EPOCH, 1);
    const b = generateShell(walker({ failure_percent: 30, failure_seed: 42 }), EPOCH, 1);
    expect(JSON.stringify(a.specs)).toBe(JSON.stringify(b.specs));
  });
});

describe("TOML round trip", () => {
  const toml = `[constellation]
epoch = 2025-05-20T00:00:00Z

[[constellation.shells]]
name = "failing shell"
count = 24
planes = 3
phasing = 1
apogee_altitude = 550
inclination = 53
failed_count = 4
failure_seed = 3
`;

  it("parses the failure keys and regenerates them on save", () => {
    const config = parseConstellationConfig(toml);
    expect(config.shells[0].failed_count).toBe(4);
    expect(config.shells[0].failure_seed).toBe(3);

    const round = parseConstellationConfig(serializeConstellationConfig(config));
    expect(round.shells[0].failed_count).toBe(4);
    expect(round.shells[0].failure_seed).toBe(3);
  });

  it("omits the keys entirely for a healthy shell", () => {
    const healthy = parseConstellationConfig(toml);
    healthy.shells[0].failed_count = 0;
    healthy.shells[0].failure_seed = 0;
    const text = serializeConstellationConfig(healthy);
    expect(text).not.toContain("failed_count");
    expect(text).not.toContain("failure_seed");
    expect(text).not.toContain("failure_percent");
  });

  it("the runtime generation path (tomlParsers) applies the failures too", () => {
    expect(parseConstellationToml(toml).length).toBe(20);
  });

  it("rejects a failure count larger than the shell", () => {
    const config = parseConstellationConfig(toml);
    config.shells[0].failed_count = 99;
    const result = validateConfig(config);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "shell.0.failed_count")).toBe(true);
  });

  it("rejects an out-of-range failure percentage", () => {
    const config = parseConstellationConfig(toml);
    config.shells[0].failure_percent = 120;
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.field === "shell.0.failure_percent")).toBe(true);
  });
});
