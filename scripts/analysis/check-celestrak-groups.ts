#!/usr/bin/env bun
/**
 * Live check of every CelesTrak group the import dialog offers: fetches each
 * group once, converts its first entry the way the app does, and exits
 * non-zero if any group fails. Not part of `bun test` because it needs the
 * network and hits celestrak.org; run it after editing CELESTRAK_GROUP_TREE.
 *
 *   bun scripts/analysis/check-celestrak-groups.ts            # every group
 *   bun scripts/analysis/check-celestrak-groups.ts starlink geo
 */
import { CELESTRAK_GROUP_URLS, celestrakEntryToSat, getCelestrakUrl, type CelestrakEntry } from "../../src/utils/celestrakUtils";

// CelesTrak rate-limits repeated downloads; keep requests spaced out.
const DELAY_MS = 500;

async function checkGroup(group: string): Promise<string> {
  const response = await fetch(getCelestrakUrl(group));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  let data: CelestrakEntry[];
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 80).trim() || "empty response");
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error("no satellites");
  celestrakEntryToSat(data[0]);
  return `${data.length} satellites`;
}

const groups = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(CELESTRAK_GROUP_URLS);
const failures: string[] = [];
for (const [i, group] of groups.entries()) {
  if (i > 0) await Bun.sleep(DELAY_MS);
  try {
    console.log(`ok   ${group}: ${await checkGroup(group)}`);
  } catch (error) {
    failures.push(group);
    console.log(`FAIL ${group}: ${(error as Error).message}`);
  }
}
console.log(`\n${groups.length - failures.length}/${groups.length} groups ok`);
if (failures.length > 0) process.exit(1);
