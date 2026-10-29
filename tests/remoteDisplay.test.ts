import { describe, it, expect } from "bun:test";
import { validateRemoteDisplay } from "../src/lib/remoteDisplay";

describe("validateRemoteDisplay", () => {
  it("accepts and drops the retired showDerivedSatelliteInfo flag", () => {
    expect(validateRemoteDisplay({ showDerivedSatelliteInfo: true, showGraticule: false })).toEqual({
      showGraticule: false,
    });
  });

  it("still type-checks the retired flag", () => {
    expect(() => validateRemoteDisplay({ showDerivedSatelliteInfo: "yes" })).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => validateRemoteDisplay({ nope: true })).toThrow("Unknown display field");
  });
});
