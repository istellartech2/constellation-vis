import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { noticesForModules } from "../scripts/third-party-notices";

describe("third-party notices", () => {
  it("includes the pinned upstream notice for react-remove-scroll-bar 2.3.8", () => {
    const module = resolve("node_modules/react-remove-scroll-bar/dist/es2015/index.js");
    const notice = readFileSync("scripts/license-overrides/react-remove-scroll-bar-LICENSE", "utf8").trim();
    const output = noticesForModules([module]);
    expect(output).toContain("react-remove-scroll-bar@2.3.8 (MIT)");
    expect(output).toContain(notice);
  });
});
