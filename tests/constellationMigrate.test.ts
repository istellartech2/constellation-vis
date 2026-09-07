/**
 * Pattern-switch migration (`src/lib/constellationPatterns/migrate.ts`).
 *
 * The contract the editor relies on: switching a design method never destroys
 * what the user typed, and the handful of exact correspondences between
 * patterns (Walker F ↔ lattice Nc, the streets-of-coverage design size ↔ Walker
 * T/P) survive a round trip.
 */
import { describe, expect, it } from "bun:test";
import {
  migrateShellPattern,
  syncDerivedFields,
} from "../src/lib/constellationPatterns/migrate";
import { latticeWalkerF, lfcNcFromWalker } from "../src/lib/constellationPatterns";
import type { ConstellationShell } from "../src/lib/constellationTypes";
import { createNewShell } from "../src/lib/constellationTypes";

function shellOf(overrides: Partial<ConstellationShell> = {}): ConstellationShell {
  return { ...createNewShell("walker_delta"), ...overrides };
}

function apply(shell: ConstellationShell, next: Parameters<typeof migrateShellPattern>[1]) {
  const { updates, note } = migrateShellPattern(shell, next);
  return { merged: { ...shell, ...updates, pattern: next } as ConstellationShell, updates, note };
}

describe("migrateShellPattern — non-destructive", () => {
  it("never removes a key and never rewrites unrelated orbital elements", () => {
    const shell = shellOf({
      count: 60,
      planes: 6,
      phasing: 2,
      apogee_altitude: 700,
      inclination: 87,
      eccentricity: 0,
      raan_start: 17,
      argp: 42,
      mean_anomaly_0: 33,
    });

    for (const next of [
      "walker_star",
      "streets_of_coverage",
      "flower",
      "lattice_flower",
      "necklace_flower",
    ] as const) {
      const { merged, updates } = apply(shell, next);
      // Nothing is deleted.
      for (const key of Object.keys(shell)) {
        expect(merged[key as keyof ConstellationShell]).not.toBeUndefined();
      }
      // Untouched user inputs stay exactly as typed.
      expect(merged.raan_start).toBe(17);
      expect(merged.argp).toBe(42);
      expect(merged.mean_anomaly_0).toBe(33);
      expect(merged.inclination).toBe(87);
      expect(updates).not.toHaveProperty("raan_start");
      expect(updates).not.toHaveProperty("argp");
      expect(updates).not.toHaveProperty("mean_anomaly_0");
      expect(updates).not.toHaveProperty("inclination");
    }
  });

  it("keeps the shell's own altitude when switching between walker patterns", () => {
    const { merged } = apply(shellOf({ apogee_altitude: 640 }), "walker_star");
    expect(merged.apogee_altitude).toBe(640);
  });

  it("returns a non-empty note for every transition, including a no-op", () => {
    const shell = shellOf();
    for (const next of [
      "walker_delta",
      "walker_star",
      "streets_of_coverage",
      "flower",
      "lattice_flower",
      "necklace_flower",
    ] as const) {
      const { note } = migrateShellPattern(shell, next);
      expect(typeof note).toBe("string");
      expect(note.length).toBeGreaterThan(0);
    }
  });
});

describe("migrateShellPattern — raan_range", () => {
  it("delta → star sets 180 when the value is the delta default", () => {
    const { merged, updates } = apply(shellOf({ raan_range: 360 }), "walker_star");
    expect(updates.raan_range).toBe(180);
    expect(merged.raan_range).toBe(180);
  });

  it("delta → star sets 180 when the value is unset", () => {
    const shell = shellOf();
    delete shell.raan_range;
    expect(apply(shell, "walker_star").updates.raan_range).toBe(180);
  });

  it("delta → star normalizes a custom span to 180° (the star form hides raan_range)", () => {
    const { merged, updates } = apply(shellOf({ raan_range: 200 }), "walker_star");
    expect(updates.raan_range).toBe(180);
    expect(merged.raan_range).toBe(180);
  });

  it("star → delta restores the 360° span", () => {
    const star = { ...createNewShell("walker_star"), raan_range: 180 };
    expect(apply(star, "walker_delta").updates.raan_range).toBe(360);
  });

  it("does not leak the 180° span through a flower-family hop", () => {
    const star = { ...createNewShell("walker_star"), raan_range: 180 };
    const lattice = apply(star, "lattice_flower").merged;
    expect(lattice.raan_range).toBe(180); // the flower family ignores it
    expect(apply(lattice, "walker_delta").merged.raan_range).toBe(360);
  });
});

describe("migrateShellPattern — Walker F ↔ lattice Nc", () => {
  it("walker → lattice converts F to Nc via lfcNcFromWalker", () => {
    const shell = shellOf({ count: 36, planes: 6, phasing: 1 });
    const { merged } = apply(shell, "lattice_flower");
    expect(merged.lfc_nc).toBe(lfcNcFromWalker(36, 6, 1));
    expect(merged.lfc_nc).toBe(5);
  });

  it("round-trips F → Nc → F for every valid F", () => {
    const planes = 6;
    const count = 36;
    for (let f = 0; f < planes; f++) {
      const walker = shellOf({ count, planes, phasing: f });
      const lattice = apply(walker, "lattice_flower").merged;
      const nc = lattice.lfc_nc ?? -1;
      expect(nc).toBe(lfcNcFromWalker(count, planes, f));
      const back = apply(lattice, "walker_delta").merged;
      expect(back.phasing).toBe(latticeWalkerF(planes, nc));
      expect(back.phasing).toBe(f);
      expect(back.count).toBe(count);
      expect(back.planes).toBe(planes);
    }
  });

  it("recomputes Nc from the current F even when a stale Nc is present", () => {
    // Symmetric with lattice → walker (which overwrites F), so a round trip
    // walker → lattice → walker preserves the user's F.
    const shell = shellOf({ count: 36, planes: 6, phasing: 1, lfc_nc: 2 });
    const lattice = apply(shell, "lattice_flower").merged;
    expect(lattice.lfc_nc).toBe(5);
    expect(apply(lattice, "walker_delta").merged.phasing).toBe(1);
  });
});

describe("migrateShellPattern — streets of coverage", () => {
  it("walker → soc seeds S from count/planes plus ε and N defaults", () => {
    const { merged } = apply(shellOf({ count: 66, planes: 6 }), "streets_of_coverage");
    expect(merged.soc_sats_per_plane).toBe(11);
    expect(merged.soc_min_elevation).toBe(25);
    expect(merged.soc_coverage_fold).toBe(1);
  });

  it("soc → walker writes the designed count and plane count", () => {
    // Iridium design inputs: 780 km, ε = 8.2°, S = 11 → P = 6, T = 66.
    const soc = createNewShell("streets_of_coverage");
    const dirty = { ...soc, count: 1, planes: 1 };
    const { merged } = apply(dirty, "walker_delta");
    expect(merged.planes).toBe(6);
    expect(merged.count).toBe(66);
    expect(merged.count).toBe(merged.planes * (soc.soc_sats_per_plane ?? 0));
  });
});

describe("migrateShellPattern — necklace", () => {
  it("fills pearls, a fully occupied necklace and shift 1 from any source", () => {
    const { merged } = apply(shellOf({ count: 18, planes: 6 }), "necklace_flower");
    expect(merged.nec_pearls).toBe(3);
    expect(merged.nec_necklace).toEqual([1, 2, 3]);
    expect(merged.nec_shift).toBe(1);
  });

  it("keeps an existing necklace when coming from the lattice", () => {
    const lattice = { ...createNewShell("lattice_flower"), count: 54, planes: 6, lfc_nc: 1 };
    const withNecklace = { ...lattice, nec_pearls: 9, nec_necklace: [1, 4, 6], nec_shift: 2 };
    const { merged } = apply(withNecklace, "necklace_flower");
    expect(merged.nec_pearls).toBe(9);
    expect(merged.nec_necklace).toEqual([1, 4, 6]);
    expect(merged.nec_shift).toBe(2);
  });
});

describe("migrateShellPattern — flower", () => {
  it("carries the plane count into Fd and suggests a repeat ratio", () => {
    const { merged } = apply(shellOf({ planes: 8, apogee_altitude: 550, inclination: 53 }), "flower");
    expect(merged.flower_fd).toBe(8);
    expect(merged.flower_np).toBeGreaterThan(0);
    expect(merged.flower_nd).toBeGreaterThan(0);
    expect(merged.flower_fn).toBe(1);
    expect(merged.flower_fh).toBe(0);
  });

  it("stores the solved altitude when leaving the flower pattern", () => {
    const flower = createNewShell("flower");
    const { merged } = apply(flower, "walker_delta");
    expect(merged.apogee_altitude).toBeGreaterThan(0);
    // The flower template is already consistent, so the value barely moves.
    expect(Math.abs((merged.apogee_altitude ?? 0) - (flower.apogee_altitude ?? 0))).toBeLessThan(1);
  });
});

describe("syncDerivedFields", () => {
  it("writes back the designed size for streets of coverage", () => {
    const soc = { ...createNewShell("streets_of_coverage"), count: 1, planes: 1 };
    expect(syncDerivedFields(soc)).toEqual({ count: 66, planes: 6 });
  });

  it("writes back No × occupied for a necklace", () => {
    const nec = { ...createNewShell("necklace_flower"), count: 1 };
    expect(syncDerivedFields(nec)).toEqual({ count: 18 });
  });

  it("writes back Fd as the plane count for a flower", () => {
    const flower = { ...createNewShell("flower"), planes: 1 };
    expect(syncDerivedFields(flower).planes).toBe(8);
  });

  it("is a fixed point once the record is in sync", () => {
    for (const pattern of ["streets_of_coverage", "necklace_flower", "flower"] as const) {
      const shell = createNewShell(pattern);
      const synced = { ...shell, ...syncDerivedFields(shell) };
      expect(syncDerivedFields(synced)).toEqual({});
    }
  });

  it("returns nothing for the user-sized walker patterns", () => {
    expect(syncDerivedFields(createNewShell("walker_delta"))).toEqual({});
    expect(syncDerivedFields(createNewShell("walker_star"))).toEqual({});
    expect(syncDerivedFields(createNewShell("lattice_flower"))).toEqual({});
  });

  it("returns nothing rather than throwing on half-typed input", () => {
    const broken = { ...createNewShell("necklace_flower"), planes: Number.NaN };
    expect(syncDerivedFields(broken)).toEqual({});
  });
});
