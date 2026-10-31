import { describe, expect, it } from "bun:test";
import { parseTomlScalar, quoteTomlString, unquoteTomlString } from "../src/lib/constellationPatterns/tomlTable";

describe("TOML strings", () => {
  it("decodes basic-string escapes", () => {
    expect(unquoteTomlString(String.raw`"a \"b\" \\ c\tд\u00e9\U0001F680"`)).toBe('a "b" \\ c\tдé🚀');
  });

  it("takes literal strings verbatim", () => {
    expect(unquoteTomlString(String.raw`'C:\path\"x"'`)).toBe(String.raw`C:\path\"x"`);
  });

  it("returns null for anything that is not a quoted string", () => {
    for (const raw of ["42", '"', "abc", "[1, 2]"]) expect(unquoteTomlString(raw)).toBeNull();
  });

  it("round-trips through quoteTomlString", () => {
    for (const value of ["", "plain", 'q"uote', "back\\slash", "new\nline", "タブ\t🚀"]) {
      expect(parseTomlScalar(quoteTomlString(value))).toBe(value);
    }
  });
});
