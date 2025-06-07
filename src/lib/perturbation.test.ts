/**
 * Unit tests for perturbation calculations
 * Test data generated using Python calculations with the same formulas
 */

import { describe, it, expect } from 'vitest';
import { calculateDetailedPerturbationRates, formatJ2PerturbationRates, formatJ3PerturbationRates } from './perturbation';

// Test data generated using Python script
const testData = [
  {
    "name": "LEO circular orbit",
    "input": {
      "semiMajorAxisKm": 6778.137,
      "eccentricity": 0.001,
      "inclinationDeg": 51.6,
      "raanDeg": 0.0,
      "argPerigeeDeg": 0.0,
      "meanAnomalyDeg": 0.0
    },
    "expected": {
      "j2": {
        "dOmega_dt_deg_per_day": -5.002347679308267,
        "domega_dt_deg_per_day": 3.7412959955880063
      },
      "j3": {
        "de_dt_per_year": 2.9653152720074722e-06,
        "di_dt_deg_per_year": -0.670162969410144,
        "dOmega_dt_deg_per_year": 1.6910704703266126,
        "domega_dt_deg_per_year": -0.7856060860980618
      }
    }
  },
  {
    "name": "GEO orbit",
    "input": {
      "semiMajorAxisKm": 42164.0,
      "eccentricity": 0.0002,
      "inclinationDeg": 0.1,
      "raanDeg": 0.0,
      "argPerigeeDeg": 0.0,
      "meanAnomalyDeg": 0.0
    },
    "expected": {
      "j2": {
        "dOmega_dt_deg_per_day": -0.013414278636485342,
        "domega_dt_deg_per_day": 0.026828495979626492
      },
      "j3": {
        "de_dt_per_year": 2.016870591686647e-09,
        "di_dt_deg_per_year": -0.0002888963118478478,
        "dOmega_dt_deg_per_year": 1.0084393916835425e-06,
        "domega_dt_deg_per_year": -2.0168711036697456e-06
      }
    }
  },
  {
    "name": "Molniya orbit",
    "input": {
      "semiMajorAxisKm": 26600.0,
      "eccentricity": 0.72,
      "inclinationDeg": 63.4,
      "raanDeg": 90.0,
      "argPerigeeDeg": 270.0,
      "meanAnomalyDeg": 0.0
    },
    "expected": {
      "j2": {
        "dOmega_dt_deg_per_day": -0.12985240290080297,
        "domega_dt_deg_per_day": 0.00035395171865494905
      },
      "j3": {
        "de_dt_per_year": -0.00010295102943603602,
        "di_dt_deg_per_year": -0.009204460480768357,
        "dOmega_dt_deg_per_year": 0.03676176569156809,
        "domega_dt_deg_per_year": -4.4867803238677926e-05
      }
    }
  },
  {
    "name": "Sun-synchronous orbit",
    "input": {
      "semiMajorAxisKm": 7078.137,
      "eccentricity": 0.001,
      "inclinationDeg": 98.2,
      "raanDeg": 0.0,
      "argPerigeeDeg": 0.0,
      "meanAnomalyDeg": 0.0
    },
    "expected": {
      "j2": {
        "dOmega_dt_deg_per_day": 0.9870891882966879,
        "domega_dt_deg_per_day": -3.1083712317157355
      },
      "j3": {
        "de_dt_per_year": -1.4550443154478567e-05,
        "di_dt_deg_per_year": 0.12663516679979112,
        "dOmega_dt_deg_per_year": 1.75757435520438,
        "domega_dt_deg_per_year": 0.7894012838977063
      }
    }
  }
];

describe('Perturbation calculations', () => {
  testData.forEach((testCase) => {
    describe(testCase.name, () => {
      const result = calculateDetailedPerturbationRates(testCase.input);
      
      it('should calculate J2 perturbations correctly', () => {
        const DAYS_PER_YEAR = 365.25;
        
        // Convert our year-based results to day-based for comparison
        const actualJ2DegPerDay = {
          dOmega_dt: result.j2.dOmega_dt / DAYS_PER_YEAR,
          domega_dt: result.j2.domega_dt / DAYS_PER_YEAR,
        };
        
        expect(actualJ2DegPerDay.dOmega_dt).toBeCloseTo(
          testCase.expected.j2.dOmega_dt_deg_per_day, 
          6
        );
        expect(actualJ2DegPerDay.domega_dt).toBeCloseTo(
          testCase.expected.j2.domega_dt_deg_per_day, 
          6
        );
      });
      
      it('should calculate J3 perturbations correctly', () => {
        expect(result.j3.de_dt).toBeCloseTo(
          testCase.expected.j3.de_dt_per_year, 
          10
        );
        expect(result.j3.di_dt).toBeCloseTo(
          testCase.expected.j3.di_dt_deg_per_year, 
          6
        );
        expect(result.j3.dOmega_dt).toBeCloseTo(
          testCase.expected.j3.dOmega_dt_deg_per_year, 
          6
        );
        expect(result.j3.domega_dt).toBeCloseTo(
          testCase.expected.j3.domega_dt_deg_per_year, 
          6
        );
      });
      
      it('should have zero values for non-affected elements', () => {
        // J2 doesn't affect a, e, i (first order)
        expect(result.j2.da_dt).toBe(0);
        expect(result.j2.de_dt).toBe(0);
        expect(result.j2.di_dt).toBe(0);
        
        // J3 doesn't affect a (first order)
        expect(result.j3.da_dt).toBe(0);
        expect(result.j3.dM_dt).toBe(0);
      });
    });
  });
  
  describe('Formatting functions', () => {
    const sampleRates = {
      da_dt: 0,
      de_dt: 1.5e-6,
      di_dt: -0.67,
      dOmega_dt: -1827.857,  // deg/year
      domega_dt: 1365.730,   // deg/year
      dM_dt: 0,
    };
    
    it('should format J2 rates with correct units and precision', () => {
      const formatted = formatJ2PerturbationRates(sampleRates);
      expect(formatted).toHaveLength(2); // Should only include non-zero values
      expect(formatted[0].latex).toBe('d\\Omega/dt');
      expect(formatted[0].value).toBe('-5.00 deg/day');
      expect(formatted[1].latex).toBe('d\\omega/dt');
      expect(formatted[1].value).toBe('3.74 deg/day');
    });
    
    it('should format J3 rates with correct units and precision', () => {
      const formatted = formatJ3PerturbationRates(sampleRates);
      expect(formatted).toHaveLength(4);
      expect(formatted.find(f => f.latex === 'de/dt')?.value).toBe('1.50e-6 /year');
      expect(formatted.find(f => f.latex === 'di/dt')?.value).toBe('-0.67 deg/year');
      expect(formatted.find(f => f.latex === 'd\\Omega/dt')?.value).toBe('-1827.86 deg/year');
      expect(formatted.find(f => f.latex === 'd\\omega/dt')?.value).toBe('1365.73 deg/year');
    });
    
    it('should filter out zero values', () => {
      const zeroRates = {
        da_dt: 0,
        de_dt: 0,
        di_dt: 0,
        dOmega_dt: 0,
        domega_dt: 0,
        dM_dt: 0,
      };
      
      expect(formatJ2PerturbationRates(zeroRates)).toHaveLength(0);
      expect(formatJ3PerturbationRates(zeroRates)).toHaveLength(0);
    });
  });
  
  describe('Edge cases', () => {
    it('should handle zero eccentricity', () => {
      const result = calculateDetailedPerturbationRates({
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 45,
        raanDeg: 0,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
      });
      
      expect(result.j2.dOmega_dt).not.toBeNaN();
      expect(result.j2.domega_dt).not.toBeNaN();
      expect(result.j3.de_dt).not.toBeNaN();
    });
    
    it('should handle critical inclination (63.4 degrees)', () => {
      const result = calculateDetailedPerturbationRates({
        semiMajorAxisKm: 7000,
        eccentricity: 0.01,
        inclinationDeg: 63.4,
        raanDeg: 0,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
      });
      
      // At critical inclination, J2 omega perturbation should be very small
      expect(Math.abs(result.j2.domega_dt)).toBeLessThan(10); // deg/year
    });
    
    it('should handle polar orbit', () => {
      const result = calculateDetailedPerturbationRates({
        semiMajorAxisKm: 7000,
        eccentricity: 0.01,
        inclinationDeg: 90,
        raanDeg: 0,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
      });
      
      expect(result.j2.dOmega_dt).toBeCloseTo(0, 1); // Should be ~0 for polar orbit
      expect(result.j3.dOmega_dt).not.toBeNaN();
    });
  });
});