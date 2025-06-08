#!/usr/bin/env bun
import { getCelestrakUrl } from '../src/utils/celestrakUtils';

async function testFixedDebrisGroups() {
  console.log('Testing fixed debris group names...\n');

  const debrisGroups = [
    'cosmos-1408-debris',
    'fengyun-1c-debris', 
    'iridium-33-debris',
    'cosmos-2251-debris'
  ];

  for (const group of debrisGroups) {
    console.log(`Testing group: ${group}`);
    const url = getCelestrakUrl(group);
    console.log(`URL: ${url}`);

    try {
      const response = await fetch(url);
      console.log(`Status: ${response.status} ${response.statusText}`);

      const text = await response.text();
      
      if (text.startsWith('Invalid query:') || text.startsWith('Error:')) {
        console.error(`❌ Invalid group: ${text}`);
      } else {
        try {
          const data = JSON.parse(text);
          console.log(`✅ Success: ${data.length} satellites found`);
          
          if (data.length > 0) {
            console.log(`Sample: ${data[0].OBJECT_NAME || 'Unnamed'} (ID: ${data[0].NORAD_CAT_ID})`);
          }
        } catch (jsonError) {
          console.error(`❌ JSON parse error: ${jsonError}`);
        }
      }
    } catch (error) {
      console.error(`❌ Fetch error: ${error}`);
    }

    console.log('---\n');
  }
}

testFixedDebrisGroups().catch(console.error);