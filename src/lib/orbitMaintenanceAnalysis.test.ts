import { analyzeOrbitMaintenance, createDefaultMaintenanceInput } from "./orbitMaintenanceAnalysis";
import type { SatelliteSpec } from "./satellites";

const testSatellite: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 99999,
    epoch: new Date("2026-01-01T00:00:00Z"),
    semiMajorAxisKm: 6378.137 + 550,
    eccentricity: 0.001,
    inclinationDeg: 97.6,
    raanDeg: 0,
    argPerigeeDeg: 0,
    meanAnomalyDeg: 0,
  },
  meta: {
    objectName: "TEST-SAT",
  },
};

const ellipticalSatellite: SatelliteSpec = {
  type: "elements",
  elements: {
    satnum: 99998,
    epoch: new Date("2026-01-01T00:00:00Z"),
    semiMajorAxisKm: 6378.137 + 700,
    eccentricity: 0.08,
    inclinationDeg: 63.4,
    raanDeg: 0,
    argPerigeeDeg: 270,
    meanAnomalyDeg: 0,
  },
  meta: {
    objectName: "ELLIPTIC-TEST",
  },
};

describe("orbitMaintenanceAnalysis", () => {
  const startTime = new Date("2026-03-19T00:00:00Z");

  it("produces a valid nominal result", () => {
    const input = createDefaultMaintenanceInput(550);
    const result = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, input);

    expect(result.timeline.length).toBeGreaterThan(2);
    expect(result.annualBudget.length).toBeGreaterThan(0);
    expect(result.kpi.annualAltitudeLossKm).toBeGreaterThan(0);
    expect(result.kpi.annualDeltaV_mps).toBeGreaterThan(0);
  });

  it("worsens annual maintenance when ballistic coefficient increases", () => {
    const baseInput = createDefaultMaintenanceInput(550);
    const lowBc = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      ballisticCoefficient: 0.012,
    });
    const highBc = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      ballisticCoefficient: 0.05,
    });

    expect(highBc.kpi.annualDeltaV_mps).toBeGreaterThan(lowBc.kpi.annualDeltaV_mps);
    expect(highBc.kpi.requiredPropellantWithMarginKg).toBeGreaterThan(lowBc.kpi.requiredPropellantWithMarginKg);
  });

  it("makes storm preset harsher than quiet preset", () => {
    const baseInput = createDefaultMaintenanceInput(550);
    const quiet = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      atmospherePreset: "quiet",
      f107: 70,
      ap: 4,
    });
    const storm = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      atmospherePreset: "storm",
      f107: 280,
      ap: 80,
    });

    expect(storm.kpi.annualAltitudeLossKm).toBeGreaterThan(quiet.kpi.annualAltitudeLossKm);
    expect(storm.kpi.requiredPropellantWithMarginKg).toBeGreaterThan(quiet.kpi.requiredPropellantWithMarginKg);
  });

  it("increases drag when F10.7 and Ap increase", () => {
    const baseInput = createDefaultMaintenanceInput(550);
    const mild = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      atmospherePreset: "nominal",
      f107: 100,
      ap: 8,
    });
    const severe = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      atmospherePreset: "nominal",
      f107: 250,
      ap: 60,
    });

    expect(severe.kpi.meanDensityKgPerM3).toBeGreaterThan(mild.kpi.meanDensityKgPerM3);
    expect(severe.kpi.annualDeltaV_mps).toBeGreaterThan(mild.kpi.annualDeltaV_mps);
  });

  it("reduces required propellant when specific impulse improves", () => {
    const baseInput = createDefaultMaintenanceInput(550);
    const lowIsp = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      specificImpulseSec: 70,
    });
    const highIsp = analyzeOrbitMaintenance(testSatellite, "TEST-SAT", startTime, {
      ...baseInput,
      specificImpulseSec: 1500,
    });

    expect(highIsp.kpi.requiredPropellantWithMarginKg).toBeLessThan(lowIsp.kpi.requiredPropellantWithMarginKg);
  });

  it("tracks eccentric elliptical orbits with perigee-based density sampling", () => {
    const input = createDefaultMaintenanceInput(700);
    const result = analyzeOrbitMaintenance(ellipticalSatellite, "ELLIPTIC-TEST", startTime, input);

    expect(result.timeline[0]?.eccentricity).toBeGreaterThan(0.01);
    expect(result.timeline[0]?.perigeeAltitudeKm).toBeLessThan(result.timeline[0]?.apogeeAltitudeKm ?? 0);
    expect(result.timeline[0]?.densityReferenceAltitudeKm).toBeCloseTo(result.timeline[0]?.perigeeAltitudeKm ?? 0, 3);
  });
});
