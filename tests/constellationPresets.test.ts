import { describe, expect, it } from "bun:test";
import { parse } from "smol-toml";
import {
  CONSTELLATION_PRESETS,
  createShellFromPreset,
  findConstellationPreset,
} from "../src/lib/constellationPresets";
import { generateShell } from "../src/lib/constellationPatterns";
import { parseConstellationConfig, serializeConstellationConfig, validateConfig } from "../src/lib/constellationSerializer";

const items = CONSTELLATION_PRESETS.flatMap((g) => g.items);
const EPOCH = new Date("2026-01-01T00:00:00Z");

describe("constellation presets", () => {
  it("have unique ids that findConstellationPreset resolves", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const item of items) expect(findConstellationPreset(item.id)).toBe(item);
    expect(findConstellationPreset("no-such-preset")).toBeUndefined();
  });

  for (const item of items) {
    it(`${item.id} validates and survives a TOML round trip`, () => {
      const shell = createShellFromPreset(item);
      const result = validateConfig({ epoch: EPOCH, shells: [shell] });
      expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);

      // The serializer omits values equal to their defaults, so compare what
      // the shell generates rather than its fields.
      const parsed = parseConstellationConfig(serializeConstellationConfig({ epoch: EPOCH, shells: [shell] }));
      expect(generateShell(parsed.shells[0], EPOCH, 1)).toEqual(generateShell(shell, EPOCH, 1));
    });
  }

  it("keeps quotes and backslashes in shell names", () => {
    const shell = { ...createShellFromPreset(items[0]), name: 'Shell "A" \\ 1' };
    const toml = serializeConstellationConfig({ epoch: EPOCH, shells: [shell] });
    expect(parseConstellationConfig(toml).shells[0].name).toBe(shell.name);
    // Also valid TOML for a standard parser (the AI session API uses smol-toml).
    const strict = parse(toml) as { constellation: { shells: { name: string }[] } };
    expect(strict.constellation.shells[0].name).toBe(shell.name);
  });

  it("mints a fresh id for each shell", () => {
    const a = createShellFromPreset(items[0]);
    const b = createShellFromPreset(items[0]);
    expect(a.id).not.toBe(b.id);
  });
});
