#!/usr/bin/env bun
import { getCelestrakUrl } from '../src/utils/celestrakUtils';

async function debugCelestrakResponse() {
  const problematicGroups = ['1408-debris', 'invalid-group'];

  for (const group of problematicGroups) {
    console.log(`\nDebugging group: ${group}`);
    const url = getCelestrakUrl(group);
    console.log(`URL: ${url}`);

    try {
      const response = await fetch(url);
      console.log(`Status: ${response.status} ${response.statusText}`);
      console.log(`Content-Type: ${response.headers.get('content-type')}`);

      const text = await response.text();
      console.log(`Response length: ${text.length} characters`);
      console.log(`First 500 characters:`, text.substring(0, 500));

      if (text.length > 0) {
        try {
          const json = JSON.parse(text);
          console.log(`Successfully parsed JSON. Length: ${json.length}`);
        } catch (jsonError) {
          console.error('JSON parse error:', jsonError);
          console.log('Response is not valid JSON');
        }
      } else {
        console.log('Empty response body');
      }
    } catch (error) {
      console.error('Fetch error:', error);
    }
  }
}

debugCelestrakResponse().catch(console.error);