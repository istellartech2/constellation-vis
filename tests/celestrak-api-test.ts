#!/usr/bin/env bun
import { getCelestrakUrl, celestrakEntryToSat } from '../src/utils/celestrakUtils';

async function testCelestrakAPI() {
  console.log('Testing CelesTrak API endpoints...\n');

  const testGroups = [
    'stations',     // Space stations - should be small dataset
    'starlink',     // Starlink - large dataset
    'geo',          // GEO satellites
    '1408-debris',  // COSMOS 1408 debris
    'invalid-group' // Should fail
  ];

  for (const group of testGroups) {
    console.log(`Testing group: ${group}`);
    const url = getCelestrakUrl(group);
    console.log(`URL: ${url}`);

    try {
      const startTime = Date.now();
      const response = await fetch(url);
      const duration = Date.now() - startTime;

      console.log(`Response status: ${response.status} ${response.statusText}`);
      console.log(`Response time: ${duration}ms`);

      if (response.ok) {
        const data = await response.json();
        console.log(`Data length: ${data.length} satellites`);

        if (data.length > 0) {
          const firstEntry = data[0];
          console.log('First entry sample:', {
            OBJECT_NAME: firstEntry.OBJECT_NAME,
            NORAD_CAT_ID: firstEntry.NORAD_CAT_ID,
            MEAN_MOTION: firstEntry.MEAN_MOTION,
            EPOCH: firstEntry.EPOCH
          });

          // Test conversion
          try {
            const converted = celestrakEntryToSat(firstEntry);
            console.log('Conversion successful:', {
              type: converted.type,
              satnum: converted.elements.satnum,
              semiMajorAxisKm: Math.round(converted.elements.semiMajorAxisKm),
              objectName: converted.meta?.objectName
            });
          } catch (conversionError) {
            console.error('Conversion failed:', conversionError);
          }
        }
      } else {
        console.error(`API call failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Network error:', error);
    }

    console.log('---\n');
  }
}

// Run the test
testCelestrakAPI().catch(console.error);