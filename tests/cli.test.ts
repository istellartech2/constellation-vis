import { describe, expect, it } from "bun:test";
import { parseCliArguments } from "../src/cli/main";

describe("constelation-cli arguments", () => {
  it("uses JSON output by default", () => {
    expect(parseCliArguments(["analyze", "scenario.toml"])).toEqual({
      inputPath: "scenario.toml",
      format: "json",
      pretty: false,
      summaryOnly: false,
    });
  });

  it("requires an output directory for CSV", () => {
    expect(() => parseCliArguments(["analyze", "scenario.toml", "--format", "csv"]))
      .toThrow("requires --output");
  });
});
