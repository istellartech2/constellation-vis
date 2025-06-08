#!/usr/bin/env bun
import { getCelestrakUrl } from '../src/utils/celestrakUtils';

async function testSelectedGroups() {
  console.log('Testing all groups from ImportDialog...\n');

  const allGroups = [
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

  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  };

  for (const group of allGroups) {
    try {
      const url = getCelestrakUrl(group);
      const response = await fetch(url);
      
      if (!response.ok) {
        results.failed++;
        results.errors.push(`${group}: HTTP ${response.status}`);
        continue;
      }
      
      const text = await response.text();
      
      if (text.startsWith('Invalid query:') || text.startsWith('Error:')) {
        results.failed++;
        results.errors.push(`${group}: ${text.substring(0, 50)}...`);
        continue;
      }
      
      try {
        const data = JSON.parse(text);
        console.log(`✅ ${group}: ${data.length} satellites`);
        results.success++;
      } catch (jsonError) {
        results.failed++;
        results.errors.push(`${group}: JSON parse error`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`${group}: ${error}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`✅ Successful: ${results.success}/${allGroups.length}`);
  console.log(`❌ Failed: ${results.failed}/${allGroups.length}`);

  if (results.errors.length > 0) {
    console.log('\n=== Errors ===');
    results.errors.forEach(error => console.log(`❌ ${error}`));
  }
}

testSelectedGroups().catch(console.error);