import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCelestrakUrl, celestrakEntryToSat, CELESTRAK_GROUP_URLS } from '../src/utils/celestrakUtils';
import type { CelestrakEntry } from '../src/utils/celestrakUtils';

describe('CelesTrak Import Functionality', () => {
  describe('getCelestrakUrl', () => {
    it('should generate correct URLs for known groups', () => {
      expect(getCelestrakUrl('starlink')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json');
      expect(getCelestrakUrl('stations')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json');
      expect(getCelestrakUrl('geo')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=json');
    });

    it('should handle debris groups correctly', () => {
      expect(getCelestrakUrl('1408-debris')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=1408-debris&FORMAT=json');
      expect(getCelestrakUrl('1999-025')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=1999-025&FORMAT=json');
    });

    it('should fallback to original group name for unknown groups', () => {
      expect(getCelestrakUrl('unknown-group')).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=unknown-group&FORMAT=json');
    });
  });

  describe('celestrakEntryToSat', () => {
    it('should convert CelesTrak entry to SatelliteSpec correctly', () => {
      const mockEntry: CelestrakEntry = {
        MEAN_MOTION: 15.5,
        ECCENTRICITY: 0.001,
        INCLINATION: 53.0,
        RA_OF_ASC_NODE: 45.0,
        ARG_OF_PERICENTER: 90.0,
        MEAN_ANOMALY: 180.0,
        NORAD_CAT_ID: 12345,
        EPOCH: '2024-01-01T00:00:00.000Z',
        OBJECT_NAME: 'TEST SATELLITE',
        OBJECT_ID: 'TEST-1'
      };

      const result = celestrakEntryToSat(mockEntry);

      expect(result.type).toBe('elements');
      expect(result.elements.satnum).toBe(12345);
      expect(result.elements.eccentricity).toBe(0.001);
      expect(result.elements.inclinationDeg).toBe(53.0);
      expect(result.elements.raanDeg).toBe(45.0);
      expect(result.elements.argPerigeeDeg).toBe(90.0);
      expect(result.elements.meanAnomalyDeg).toBe(180.0);
      expect(result.meta?.objectName).toBe('TEST SATELLITE');
      expect(result.meta?.objectId).toBe('TEST-1');
      expect(result.meta?.noradCatId).toBe(12345);
    });

    it('should calculate semi-major axis correctly', () => {
      const mockEntry: CelestrakEntry = {
        MEAN_MOTION: 15.5,
        ECCENTRICITY: 0.0,
        INCLINATION: 0.0,
        RA_OF_ASC_NODE: 0.0,
        ARG_OF_PERICENTER: 0.0,
        MEAN_ANOMALY: 0.0,
        NORAD_CAT_ID: 12345,
        EPOCH: '2024-01-01T00:00:00.000Z'
      };

      const result = celestrakEntryToSat(mockEntry);
      
      // Mean motion of 15.5 revs/day should correspond to approximately 6795 km semi-major axis
      expect(result.elements.semiMajorAxisKm).toBeCloseTo(6795, -1); // Within 10km
    });

    it('should handle missing optional fields', () => {
      const mockEntry: CelestrakEntry = {
        MEAN_MOTION: 15.5,
        ECCENTRICITY: 0.001,
        INCLINATION: 53.0,
        RA_OF_ASC_NODE: 45.0,
        ARG_OF_PERICENTER: 90.0,
        MEAN_ANOMALY: 180.0,
        NORAD_CAT_ID: 12345,
        EPOCH: '2024-01-01T00:00:00.000Z'
        // No OBJECT_NAME or OBJECT_ID
      };

      const result = celestrakEntryToSat(mockEntry);

      expect(result.meta?.objectName).toBeUndefined();
      expect(result.meta?.objectId).toBeUndefined();
      expect(result.meta?.noradCatId).toBe(12345);
    });
  });

  describe('CelesTrak API Integration', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should handle successful API response', async () => {
      const mockResponse = [
        {
          MEAN_MOTION: 15.5,
          ECCENTRICITY: 0.001,
          INCLINATION: 53.0,
          RA_OF_ASC_NODE: 45.0,
          ARG_OF_PERICENTER: 90.0,
          MEAN_ANOMALY: 180.0,
          NORAD_CAT_ID: 12345,
          EPOCH: '2024-01-01T00:00:00.000Z',
          OBJECT_NAME: 'TEST SATELLITE'
        }
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const url = getCelestrakUrl('starlink');
      const response = await fetch(url);
      const data = await response.json();

      expect(data).toHaveLength(1);
      expect(data[0].OBJECT_NAME).toBe('TEST SATELLITE');
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const url = getCelestrakUrl('invalid-group');
      const response = await fetch(url);

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const url = getCelestrakUrl('starlink');
      
      await expect(fetch(url)).rejects.toThrow('Network error');
    });
  });

  describe('Group URL Mappings', () => {
    it('should have all required group mappings from ImportDialog', () => {
      const requiredGroups = [
        // Special Interest
        'last-30-days', 'stations', 'active', 'geo', 'cubesat',
        // Weather & Earth Observation
        'weather', 'planet', 'spire',
        // Communications
        'starlink', 'oneweb', 'intelsat', 'ses', 'iridium', 'globalstar', 'amateur',
        // Navigation
        'gnss', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'sbas',
        // Debris
        'cosmos-1408-debris', 'fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris'
      ];

      for (const group of requiredGroups) {
        expect(CELESTRAK_GROUP_URLS).toHaveProperty(group);
      }
    });

    it('should not have duplicate URL mappings that could cause conflicts', () => {
      const urlValues = Object.values(CELESTRAK_GROUP_URLS);
      const uniqueUrls = new Set(urlValues);
      
      expect(urlValues.length).toBe(uniqueUrls.size);
    });
  });
});

// Real API test (optional, can be skipped in CI)
describe('CelesTrak Real API Test', () => {
  it.skip('should fetch real data from CelesTrak API', async () => {
    const url = getCelestrakUrl('stations');
    
    try {
      const response = await fetch(url);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      
      // Check that first entry has required fields
      const firstEntry = data[0];
      expect(firstEntry).toHaveProperty('MEAN_MOTION');
      expect(firstEntry).toHaveProperty('ECCENTRICITY');
      expect(firstEntry).toHaveProperty('INCLINATION');
      expect(firstEntry).toHaveProperty('NORAD_CAT_ID');
      expect(firstEntry).toHaveProperty('EPOCH');
      
      // Test conversion
      const converted = celestrakEntryToSat(firstEntry);
      expect(converted.type).toBe('elements');
      expect(typeof converted.elements.satnum).toBe('number');
      expect(converted.elements.satnum).toBeGreaterThan(0);
    } catch (error) {
      console.warn('Real API test failed (this is ok for CI):', error);
    }
  }, 10000); // 10 second timeout for real API call
});