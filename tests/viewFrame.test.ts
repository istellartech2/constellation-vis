import { describe, expect, it } from "bun:test";
import { nextViewFrame } from "../src/lib/viewState";
import { validateRemoteDisplay } from "../src/lib/remoteDisplay";

describe("nextViewFrame", () => {
  it("reads saved views, including ones saved before GSE existed", () => {
    expect(nextViewFrame("eci", {})).toBe("eci");
    expect(nextViewFrame("eci", { ecef: true })).toBe("ecef");
    expect(nextViewFrame("eci", { ecef: false, gse: true })).toBe("gse");
  });

  it("lets GSE win when both flags are set", () => {
    expect(nextViewFrame("eci", { ecef: true, gse: true })).toBe("gse");
  });

  it("applies partial updates relative to the current frame", () => {
    expect(nextViewFrame("gse", { ecef: true })).toBe("ecef");
    expect(nextViewFrame("gse", { ecef: false })).toBe("gse");
    expect(nextViewFrame("gse", { gse: false })).toBe("eci");
    expect(nextViewFrame("ecef", { gse: false })).toBe("ecef");
    expect(nextViewFrame("ecef", { ecef: false })).toBe("eci");
  });
});

describe("remote gse display field", () => {
  it("accepts a boolean and rejects other types", () => {
    expect(validateRemoteDisplay({ gse: true })).toEqual({ gse: true });
    expect(() => validateRemoteDisplay({ gse: "yes" })).toThrow();
  });
});
