import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { MassSatelliteLayer } from "../src/lib/massSatelliteLayer";
import { catalogFromSpecs } from "../src/lib/satelliteCatalog";

function layer(radius: number) {
  const catalog = catalogFromSpecs([
    {
      type: "elements",
      elements: {
        satnum: 1,
        epoch: new Date("2026-11-15T00:00:00Z"),
        semiMajorAxisKm: 6928,
        eccentricity: 0,
        inclinationDeg: 53,
        raanDeg: 0,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
      },
    },
  ]);
  const colors = { visible: new THREE.Color(), hidden: new THREE.Color(), selected: new THREE.Color() };
  return new MassSatelliteLayer(catalog, Date.parse("2026-11-15T00:00:00Z"), radius, colors);
}

function selectedSize(l: MassSatelliteLayer): number {
  return (l.points.material as THREE.ShaderMaterial).uniforms.uSelectedSize.value as number;
}

describe("MassSatelliteLayer selected point", () => {
  it("hides the selected point and keeps it hidden across setSatRadius", () => {
    const l = layer(0.01);
    expect(selectedSize(l)).toBeCloseTo(0.036);
    l.setSelectedPointHidden(true);
    expect(selectedSize(l)).toBe(0);
    l.setSatRadius(0.02);
    expect(selectedSize(l)).toBe(0);
    l.setSelectedPointHidden(false);
    expect(selectedSize(l)).toBeCloseTo(0.072);
    l.dispose();
  });
});
