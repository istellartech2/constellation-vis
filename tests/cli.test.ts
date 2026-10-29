import { describe, expect, it } from "bun:test";
import { parseCliArguments } from "../src/cli/main";
import { version } from "../package.json";

describe("constelation-cli arguments", () => {
  it("reports the project version in help and --version", async () => {
    for (const arg of ["--help", "--version"]) {
      const process = Bun.spawn(["bun", "src/cli/main.ts", arg], { stdout: "pipe" });
      const output = await new Response(process.stdout).text();
      expect(await process.exited).toBe(0);
      expect(output).toContain(version);
    }
  });
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
