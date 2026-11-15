/**
 * Fetch the launch-site imagery patches (public/assets/launch-sites/).
 *
 * One WMS 1.1.1 GetMap request per site to EOX's EOxCloudless 2017 layer
 * (`s2cloudless-2017`, Sentinel-2, CC BY 4.0) in EPSG:4326, an ~80 km ×
 * 80 km box at 2048 × 2048 px JPEG. Requests run one at a time with a pause
 * in between. Raw responses are cached outside the repository (default:
 * $TMPDIR/launch-site-imagery) so re-running only re-encodes; an image over
 * the size budget is recompressed with Pillow (python3).
 *
 *   bun scripts/fetch-launch-site-imagery.ts               # every site
 *   bun scripts/fetch-launch-site-imagery.ts --only starbase
 *   bun scripts/fetch-launch-site-imagery.ts --cache /tmp/lsi --refetch
 *
 * See public/assets/launch-sites/README.md for the license and attribution.
 */

import { mkdirSync, existsSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launchSiteBounds, LAUNCH_SITE_PATCH_SIZE_KM, type LaunchSiteImageryEntry } from "../src/lib/launchSiteImagery";

const WMS_URL = "https://tiles.maps.eox.at/wms";
/**
 * The edition: WMS layer name, data year and the exact credit from the
 * layer's capabilities abstract. Swapping editions is this block plus a
 * re-run; the app reads the credit and year from index.json.
 */
const EDITION = {
  // The 2016 layer is global and CC BY 4.0. (2017 is CC BY too but only
  // covers Europe, North Africa and the Middle East; 2018+ are BY-NC-SA.)
  layer: "s2cloudless",
  year: 2016,
  attribution: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;
const LAYER = EDITION.layer;
const YEAR = EDITION.year;
/**
 * A 2048² Sentinel-2 JPEG is several hundred KB or more. Where a layer has
 * no imagery the service returns its flat land/sea fallback map (two
 * colours, tens of KB) with HTTP 200, so a tiny response is an error.
 */
const MIN_IMAGERY_BYTES = 200 * 1024;
const SIZE_PX = 2048;
const MAX_BYTES = 900 * 1024;
const DELAY_MS = 1500;
// Generic client name, no personal details.
const USER_AGENT = "constellation-vis-launch-site-imagery/1.0";

/** id, Japanese name, approximate pad-area centre (deg). */
export const LAUNCH_SITES: readonly { id: string; name: string; lat: number; lon: number }[] = [
  { id: "starbase", name: "スターベース", lat: 25.99, lon: -97.16 },
  { id: "cape-canaveral", name: "ケープカナベラル（KSC/CCSFS）", lat: 28.56, lon: -80.6 },
  { id: "vandenberg", name: "ヴァンデンバーグ", lat: 34.65, lon: -120.6 },
  { id: "tanegashima", name: "種子島宇宙センター", lat: 30.4, lon: 130.97 },
  { id: "uchinoura", name: "内之浦宇宙空間観測所", lat: 31.25, lon: 131.08 },
  { id: "hokkaido-spaceport", name: "北海道スペースポート（大樹町）", lat: 42.5, lon: 143.44 },
  { id: "kourou", name: "ギアナ宇宙センター（クールー）", lat: 5.24, lon: -52.77 },
  { id: "baikonur", name: "バイコヌール宇宙基地", lat: 45.96, lon: 63.31 },
  { id: "wenchang", name: "文昌航天発射場", lat: 19.61, lon: 110.95 },
  { id: "jiuquan", name: "酒泉衛星発射センター", lat: 40.96, lon: 100.29 },
  { id: "mahia", name: "ロケットラボ第1発射施設（マヒア）", lat: -39.26, lon: 177.86 },
  { id: "sriharikota", name: "サティシュ・ダワン宇宙センター", lat: 13.72, lon: 80.23 },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function getMapUrl(bounds: { west: number; south: number; east: number; north: number }): string {
  // WMS 1.1.1: SRS + BBOX in lon,lat order (1.3.0 would flip EPSG:4326 to lat,lon).
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: LAYER,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: [bounds.west, bounds.south, bounds.east, bounds.north].join(","),
    WIDTH: String(SIZE_PX),
    HEIGHT: String(SIZE_PX),
    FORMAT: "image/jpeg",
  });
  return `${WMS_URL}?${params}`;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

/** Re-encode with Pillow at falling quality until under the budget. */
function recompress(source: string, target: string): void {
  const script = `
import sys
from PIL import Image
src, dst, budget = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert("RGB")
for q in (88, 84, 80, 76, 72, 68, 64, 60):
    img.save(dst, "JPEG", quality=q, optimize=True, progressive=True, subsampling=2)
    import os
    if os.path.getsize(dst) <= budget:
        break
`;
  const result = spawnSync("python3", ["-I", "-c", script, source, target, String(MAX_BYTES)], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Pillow recompression failed (python3 with Pillow is required)");
}

async function main() {
  const root = resolve(import.meta.dir, "..");
  const outDir = join(root, "public/assets/launch-sites");
  const cacheDir = resolve(arg("--cache") ?? join(tmpdir(), "launch-site-imagery"));
  const only = arg("--only");
  const refetch = process.argv.includes("--refetch");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  const sites = only ? LAUNCH_SITES.filter((s) => s.id === only) : LAUNCH_SITES;
  if (sites.length === 0) throw new Error(`Unknown site: ${only}`);

  let requested = 0;
  const skipped: string[] = [];
  for (const site of sites) {
    const bounds = launchSiteBounds(site.lat, site.lon, LAUNCH_SITE_PATCH_SIZE_KM);
    const raw = join(cacheDir, `${site.id}-${LAYER}-${SIZE_PX}.jpg`);
    if (refetch || !existsSync(raw)) {
      if (requested > 0) await Bun.sleep(DELAY_MS);
      requested++;
      const url = getMapUrl(bounds);
      console.log(`GET ${site.id}: ${url}`);
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      const type = response.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      // No retries against the shared service: a bad response skips the site.
      const size = jpegSize(bytes);
      const problem = !response.ok || !type.startsWith("image/jpeg")
        ? `HTTP ${response.status} ${type}: ${new TextDecoder().decode(bytes.slice(0, 300))}`
        : !size || size.width !== SIZE_PX || size.height !== SIZE_PX
          ? `unexpected image size ${JSON.stringify(size)}`
          : bytes.length < MIN_IMAGERY_BYTES
            ? `only ${bytes.length} bytes; ${LAYER} has no imagery here (flat fallback map)`
            : null;
      if (problem) {
        console.warn(`SKIP ${site.id}: ${problem}`);
        skipped.push(site.id);
        continue;
      }
      writeFileSync(raw, bytes);
    }
    const target = join(outDir, `${site.id}.jpg`);
    if (statSync(raw).size <= MAX_BYTES) copyFileSync(raw, target);
    else recompress(raw, target);
    console.log(`${site.id}.jpg ${(statSync(target).size / 1024).toFixed(0)} KB`);
  }

  // index.json lists every site whose image exists (so --only keeps the others).
  const entries: LaunchSiteImageryEntry[] = LAUNCH_SITES.filter((s) => existsSync(join(outDir, `${s.id}.jpg`))).map((s) => ({
    id: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    bounds: launchSiteBounds(s.lat, s.lon, LAUNCH_SITE_PATCH_SIZE_KM),
    file: `${s.id}.jpg`,
    source: `EOxCloudless ${YEAR}`,
    year: YEAR,
  }));
  const index = {
    attribution: EDITION.attribution,
    license: EDITION.license,
    licenseUrl: EDITION.licenseUrl,
    year: YEAR,
    layer: LAYER,
    sizeKm: LAUNCH_SITE_PATCH_SIZE_KM,
    sizePx: SIZE_PX,
    sites: entries,
  };
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`index.json: ${entries.length} sites (${requested} requests)`);
  if (skipped.length > 0) console.warn(`Skipped: ${skipped.join(", ")}`);
}

await main();
