/**
 * Coverage contract for the editor's UI metadata
 * (`src/lib/constellationPatterns/uiMeta.ts`).
 *
 * The form renders straight from `PATTERN_FIELD_SPECS`, so a TOML key added to
 * `fields.ts` without a matching UI entry would become invisible — settable
 * only by hand-editing the TOML. These tests fail in that case, and also fail
 * if a spec points at a key the pattern does not actually read.
 */
import { describe, expect, it } from "bun:test";
import {
  HIDDEN_FIELDS,
  PATTERN_FIELD_SPECS,
  PATTERN_GROUPS,
  PATTERN_META,
  UI_EXEMPT_KEYS,
  fieldSpecsFor,
  resolveBound,
  unpresentedFields,
} from "../src/lib/constellationPatterns/uiMeta";
import { safeDerived } from "../src/lib/constellationPatterns/migrate";
import {
  PATTERN_IDS,
  computeShellDerived,
  fieldKeysForPattern,
  fieldSpec,
} from "../src/lib/constellationPatterns";
import type { ConstellationShell } from "../src/lib/constellationTypes";
import { createNewShell } from "../src/lib/constellationTypes";

describe("PATTERN_FIELD_SPECS coverage", () => {
  for (const pattern of PATTERN_IDS) {
    it(`${pattern}: every registry field is presented or explicitly hidden`, () => {
      expect(unpresentedFields(pattern)).toEqual([]);
    });

    it(`${pattern}: no spec references a key outside the registry`, () => {
      const allowed = new Set(fieldKeysForPattern(pattern));
      for (const spec of PATTERN_FIELD_SPECS[pattern]) {
        expect(fieldSpec(spec.key as string)).toBeDefined();
        expect(allowed.has(spec.key as string)).toBe(true);
      }
    });

    it(`${pattern}: hidden fields are real registry keys of this pattern`, () => {
      const allowed = new Set(fieldKeysForPattern(pattern));
      for (const key of HIDDEN_FIELDS[pattern]) {
        expect(allowed.has(key as string)).toBe(true);
      }
    });

    it(`${pattern}: no key is both presented and hidden`, () => {
      const hidden = new Set<string>(HIDDEN_FIELDS[pattern] as readonly string[]);
      for (const spec of PATTERN_FIELD_SPECS[pattern]) {
        expect(hidden.has(spec.key as string)).toBe(false);
      }
    });

    it(`${pattern}: has at least one basic field and a metadata entry`, () => {
      expect(fieldSpecsFor(pattern, "basic").length).toBeGreaterThan(0);
      expect(PATTERN_META[pattern].label.length).toBeGreaterThan(0);
      expect(PATTERN_META[pattern].summary.length).toBeGreaterThan(0);
      expect(PATTERN_META[pattern].help.length).toBeGreaterThan(0);
    });

    it(`${pattern}: every spec carries a HelpTip and read-only specs a reader`, () => {
      for (const spec of PATTERN_FIELD_SPECS[pattern]) {
        expect(spec.help.length).toBeGreaterThan(0);
        if (spec.kind === "readonly") expect(typeof spec.read).toBe("function");
      }
    });
  }

  it("raan_range is hidden for every pattern except walker_delta", () => {
    for (const pattern of PATTERN_IDS) {
      const hidden = (HIDDEN_FIELDS[pattern] as readonly string[]).includes("raan_range");
      expect(hidden).toBe(pattern !== "walker_delta");
    }
  });

  it("exempt keys are never presented as fields", () => {
    for (const pattern of PATTERN_IDS) {
      for (const spec of PATTERN_FIELD_SPECS[pattern]) {
        expect(UI_EXEMPT_KEYS).not.toContain(spec.key as string);
      }
    }
  });

  it("PATTERN_GROUPS lists every pattern exactly once", () => {
    const listed = PATTERN_GROUPS.flatMap((g) => g.patterns);
    expect(listed.slice().sort()).toEqual([...PATTERN_IDS].slice().sort());
    expect(new Set(listed).size).toBe(PATTERN_IDS.length);
  });
});

describe("dynamic bounds", () => {
  it("caps Walker F at P-1 and lattice Nc at No-1", () => {
    const walker: ConstellationShell = { ...createNewShell("walker_delta"), planes: 18 };
    const phasing = PATTERN_FIELD_SPECS.walker_delta.find((s) => s.key === "phasing");
    expect(resolveBound(phasing?.max, walker)).toBe(17);

    const lattice: ConstellationShell = { ...createNewShell("lattice_flower"), planes: 12 };
    const nc = PATTERN_FIELD_SPECS.lattice_flower.find((s) => s.key === "lfc_nc");
    expect(resolveBound(nc?.max, lattice)).toBe(11);
  });

  it("caps the flower's Fh at Nd-1", () => {
    const flower: ConstellationShell = { ...createNewShell("flower"), flower_nd: 5 };
    const fh = PATTERN_FIELD_SPECS.flower.find((s) => s.key === "flower_fh");
    expect(resolveBound(fh?.max, flower)).toBe(4);
  });

  it("disables argp only for circular orbits", () => {
    const argp = PATTERN_FIELD_SPECS.walker_delta.find((s) => s.key === "argp");
    const circular: ConstellationShell = { ...createNewShell("walker_delta"), eccentricity: 0 };
    const elliptic: ConstellationShell = { ...createNewShell("walker_delta"), eccentricity: 0.1 };
    expect(argp?.disabledWhen?.(circular)).toBe("離心率が0のため無効");
    expect(argp?.disabledWhen?.(elliptic)).toBeUndefined();
  });
});

describe("virtual and read-only readers", () => {
  it("the lattice Nso field reads count/planes and writes count = planes × Nso", () => {
    const shell: ConstellationShell = {
      ...createNewShell("lattice_flower"),
      planes: 18,
      count: 648,
    };
    const nso = PATTERN_FIELD_SPECS.lattice_flower.find(
      (s) => s.key === "count" && s.write !== undefined,
    );
    expect(nso).toBeDefined();
    expect(nso?.read?.(shell, null)).toBe(36);
    expect(nso?.write?.(20, shell)).toEqual({ count: 360 });
  });

  it("the streets-of-coverage read-only fields report the design result", () => {
    const shell = createNewShell("streets_of_coverage");
    const derived = computeShellDerived(shell);
    const byKey = (key: string) =>
      PATTERN_FIELD_SPECS.streets_of_coverage.find(
        (s) => s.key === key && s.kind === "readonly",
      );
    expect(byKey("planes")?.read?.(shell, derived)).toBe(6);
    expect(byKey("count")?.read?.(shell, derived)).toBe(66);
    expect(byKey("raan_spacing")?.read?.(shell, derived)).toBeCloseTo(31.389, 2);
  });
});

describe("robustness of the derived strip", () => {
  const CLEARED: Partial<ConstellationShell> = {
    count: Number.NaN,
    planes: Number.NaN,
    nec_pearls: Number.NaN,
    soc_sats_per_plane: Number.NaN,
    flower_fd: Number.NaN,
  };

  for (const pattern of PATTERN_IDS) {
    it(`${pattern}: safeDerived survives a cleared numeric field`, () => {
      const shell: ConstellationShell = { ...createNewShell(pattern), ...CLEARED };
      expect(() => safeDerived(shell)).not.toThrow();
    });
  }

  it("necklace_flower: raw derive survives a cleared 軌道面数 (NaN planes)", () => {
    const shell: ConstellationShell = { ...createNewShell("necklace_flower"), ...CLEARED };
    expect(() => computeShellDerived(shell)).not.toThrow();
    expect(safeDerived(shell)).not.toBeNull();
  });
});
