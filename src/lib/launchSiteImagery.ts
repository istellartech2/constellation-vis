/**
 * High-resolution imagery patches around major launch sites (EOxCloudless
 * 2016, Sentinel-2, CC BY 4.0; see public/assets/launch-sites/README.md).
 *
 * The base globe texture is 4k/8k (2.5–5 km per pixel at the equator), which
 * is a blur under a close ride. Each site gets an ~80 km × 80 km
 * equirectangular image draped on the WGS84 ellipsoid as a curved patch
 * inside the Earth-rotating group, faded at its edges into the base map.
 * Images load only when the camera comes down close to a site and are
 * released again once it has been away for a while, so the default
 * whole-globe views never request them.
 *
 * The top half of this file is pure (no DOM, no renderer) so the geometry
 * and load decisions can be unit-tested; {@link LaunchSiteImageryLayer} at
 * the bottom owns the THREE objects.
 */

import * as THREE from "three";

export const EARTH_RADIUS_EQUATOR_KM = 6378.137;
export const EARTH_RADIUS_POLAR_KM = 6356.7523142;
const WGS84_E2 = 1 - (EARTH_RADIUS_POLAR_KM / EARTH_RADIUS_EQUATOR_KM) ** 2;
/** Mean Earth radius used to convert the patch size from km to degrees. */
const MEAN_EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEG = (Math.PI / 180) * MEAN_EARTH_RADIUS_KM;

/** Side of each square patch (km). */
export const LAUNCH_SITE_PATCH_SIZE_KM = 80;

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** One entry of public/assets/launch-sites/index.json. */
export interface LaunchSiteImageryEntry {
  id: string;
  /** Japanese display name. */
  name: string;
  lat: number;
  lon: number;
  bounds: GeoBounds;
  /** File name next to index.json. */
  file: string;
  /** Short source label, e.g. "EOxCloudless 2017". */
  source: string;
  year: number;
}

/**
 * Lat/lon box of a square patch `sizeKm` on a side centred on a site: the
 * half-size in degrees of latitude, and the same distance in degrees of
 * longitude widened by 1/cos(lat).
 */
export function launchSiteBounds(lat: number, lon: number, sizeKm = LAUNCH_SITE_PATCH_SIZE_KM): GeoBounds {
  const half = sizeKm / 2;
  const dLat = half / KM_PER_DEG;
  const dLon = half / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    west: round(lon - dLon),
    south: round(lat - dLat),
    east: round(lon + dLon),
    north: round(lat + dLat),
  };
}

/** WGS84 geodetic (deg, km above the ellipsoid) → ECEF (km). */
export function geodeticToEcefKm(latDeg: number, lonDeg: number, heightKm = 0): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = EARTH_RADIUS_EQUATOR_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (n + heightKm) * cosLat * Math.cos(lon),
    (n + heightKm) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + heightKm) * sinLat,
  ];
}

/**
 * ECEF (km) → the Earth group's local frame, the same mapping as the
 * trajectory layer: (x/Re, z/Rp, −y/Re). The group's (1, Rp/Re, 1) scale
 * turns it back into true proportions.
 */
export function ecefToEarthLocal(x: number, y: number, z: number): [number, number, number] {
  return [x / EARTH_RADIUS_EQUATOR_KM, z / EARTH_RADIUS_POLAR_KM, -y / EARTH_RADIUS_EQUATOR_KM];
}

/** Inverse of {@link ecefToEarthLocal}. */
export function earthLocalToEcef(lx: number, ly: number, lz: number): [number, number, number] {
  return [lx * EARTH_RADIUS_EQUATOR_KM, -lz * EARTH_RADIUS_EQUATOR_KM, ly * EARTH_RADIUS_POLAR_KM];
}

/**
 * Image UV for a point inside the patch. The image is equirectangular
 * (EPSG:4326) over `bounds`, so UV is linear in lon/lat; v = 0 is the south
 * edge (WebGL convention with flipY).
 */
export function patchUv(bounds: GeoBounds, lat: number, lon: number): [number, number] {
  return [(lon - bounds.west) / (bounds.east - bounds.west), (lat - bounds.south) / (bounds.north - bounds.south)];
}

/**
 * Share of each side faded into the base map (also used by the shader).
 */
export const PATCH_EDGE_FADE = 0.2;

/**
 * Edge fade (0 at the border, 1 inside) for a UV coordinate: a smoothstep
 * over the outer `width` of the patch on each side, so the patch blends into
 * the base map instead of ending in a hard square.
 */
export function patchEdgeAlpha(u: number, v: number, width = PATCH_EDGE_FADE): number {
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const t = Math.min(Math.max(edge / width, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Camera distance (ECEF km) to a site's centre and its height above the ellipsoid. */
export interface CameraSiteRange {
  distanceKm: number;
  altitudeKm: number;
}

/** Approximate geodetic height (km) of an ECEF point; exact enough for load decisions. */
export function ecefAltitudeKm(x: number, y: number, z: number): number {
  const p = Math.hypot(x, y);
  const r = Math.hypot(p, z);
  if (r === 0) return -EARTH_RADIUS_EQUATOR_KM;
  // Ellipsoid radius along the same geocentric direction.
  const cosT = p / r;
  const sinT = z / r;
  const surface = 1 / Math.sqrt((cosT / EARTH_RADIUS_EQUATOR_KM) ** 2 + (sinT / EARTH_RADIUS_POLAR_KM) ** 2);
  return r - surface;
}

export interface LoadThresholds {
  /** Load a site when the camera is closer than this to its centre (km)… */
  loadDistanceKm: number;
  /** …and lower than this above the ellipsoid (km). */
  loadAltitudeKm: number;
  /** Keep a loaded site while within these (hysteresis, so it does not flicker). */
  keepDistanceKm: number;
  keepAltitudeKm: number;
  /** Release a site only after it has been out of range this long (ms). */
  unloadDelayMs: number;
}

export const LAUNCH_SITE_LOAD_THRESHOLDS: LoadThresholds = {
  loadDistanceKm: 1500,
  loadAltitudeKm: 1500,
  keepDistanceKm: 2000,
  keepAltitudeKm: 2000,
  unloadDelayMs: 20_000,
};

/** True while the camera is low enough that any site might be wanted (gate before fetching index.json). */
export function cameraLowEnough(altitudeKm: number, thresholds = LAUNCH_SITE_LOAD_THRESHOLDS): boolean {
  return altitudeKm < thresholds.loadAltitudeKm;
}

/** Whether a site should be (or stay) resident for this camera position. */
export function siteWanted(range: CameraSiteRange, loaded: boolean, thresholds = LAUNCH_SITE_LOAD_THRESHOLDS): boolean {
  return loaded
    ? range.distanceKm < thresholds.keepDistanceKm && range.altitudeKm < thresholds.keepAltitudeKm
    : range.distanceKm < thresholds.loadDistanceKm && range.altitudeKm < thresholds.loadAltitudeKm;
}

export type SiteLoadAction = "load" | "keep" | "unload" | "idle";

/**
 * Per-site state machine step. `outSinceMs` is when a resident site last
 * left range (null while in range); the caller stores the returned value.
 */
export function siteLoadStep(
  range: CameraSiteRange,
  loaded: boolean,
  outSinceMs: number | null,
  nowMs: number,
  thresholds = LAUNCH_SITE_LOAD_THRESHOLDS,
): { action: SiteLoadAction; outSinceMs: number | null } {
  const wanted = siteWanted(range, loaded, thresholds);
  if (!loaded) return { action: wanted ? "load" : "idle", outSinceMs: null };
  if (wanted) return { action: "keep", outSinceMs: null };
  const since = outSinceMs ?? nowMs;
  return nowMs - since >= thresholds.unloadDelayMs
    ? { action: "unload", outSinceMs: null }
    : { action: "keep", outSinceMs: since };
}

/** Credit for the drawn imagery, read from index.json (shown while any patch is visible). */
export interface LaunchSiteImageryCredit {
  /** Data year of the edition, e.g. 2017. */
  year: number;
  /** Exact credit string required by the source. */
  attribution: string;
  license: string;
  licenseUrl: string;
}

export interface LaunchSiteImageryIndex {
  credit: LaunchSiteImageryCredit;
  sites: LaunchSiteImageryEntry[];
}

/** Parse index.json ({attribution, license, licenseUrl, year, sites: [...]}); malformed entries are dropped. */
export function parseLaunchSiteIndex(data: unknown): LaunchSiteImageryIndex {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(d.sites) ? d.sites : [];
  const sites = list.map(parseLaunchSiteEntry).filter((e): e is LaunchSiteImageryEntry => e !== null);
  const year = typeof d.year === "number" ? d.year : sites[0]?.year ?? 0;
  return {
    credit: {
      year,
      attribution: typeof d.attribution === "string" ? d.attribution : "",
      license: typeof d.license === "string" ? d.license : "",
      licenseUrl: typeof d.licenseUrl === "string" ? d.licenseUrl : "",
    },
    sites,
  };
}

/** Validate one index.json entry; returns null for anything malformed. */
export function parseLaunchSiteEntry(value: unknown): LaunchSiteImageryEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const b = v.bounds as Record<string, unknown> | undefined;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.file !== "string") return null;
  if (!/^[a-z0-9-]+\.(jpg|jpeg|webp|png)$/.test(v.file)) return null;
  if (!num(v.lat) || !num(v.lon) || !b || !num(b.west) || !num(b.south) || !num(b.east) || !num(b.north)) return null;
  if (!(b.west < b.east && b.south < b.north)) return null;
  return {
    id: v.id,
    name: v.name,
    lat: v.lat,
    lon: v.lon,
    bounds: { west: b.west, south: b.south, east: b.east, north: b.north },
    file: v.file,
    source: typeof v.source === "string" ? v.source : "",
    year: num(v.year) ? v.year : 0,
  };
}

/**
 * Vertex positions (Earth-group local), UVs and normals (ECEF-local in the
 * same frame) of a `segments` × `segments` lat/lon grid over `bounds` on the
 * ellipsoid, `liftKm` above it.
 */
export function buildPatchArrays(bounds: GeoBounds, segments: number, liftKm = 0) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const normals = new Float32Array(n * n * 3);
  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    const v = j / segments;
    const lat = bounds.south + (bounds.north - bounds.south) * v;
    for (let i = 0; i < n; i++) {
      const u = i / segments;
      const lon = bounds.west + (bounds.east - bounds.west) * u;
      const [x, y, z] = geodeticToEcefKm(lat, lon, liftKm);
      const [lx, ly, lz] = ecefToEarthLocal(x, y, z);
      const k = j * n + i;
      positions.set([lx, ly, lz], k * 3);
      uvs.set([u, v], k * 2);
      // Geodetic up in scene axes (ECEF (x, y, z) → (x, z, −y)); the shader
      // takes it to world space with the group's rotation only.
      const latR = (lat * Math.PI) / 180;
      const lonR = (lon * Math.PI) / 180;
      normals.set([Math.cos(latR) * Math.cos(lonR), Math.sin(latR), -Math.cos(latR) * Math.sin(lonR)], k * 3);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from outside (east = +u, north = +v).
      indices.push(a, b, d, a, d, c);
    }
  }
  return { positions, uvs, normals, indices };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PATCH_SEGMENTS = 64;
/** A couple of metres above the ellipsoid, on top of the polygon offset, so the patch never ties with the globe's vertices. */
const PATCH_LIFT_KM = 0.002;
/**
 * After the opaque globe (renderOrder 0), before the thin shells drawn over
 * it (night lights, borders, clouds, atmosphere), which keep their default
 * order but are transparent and so draw in the later transparent pass
 * sorted by distance; a negative order puts the patches first in that pass.
 */
const PATCH_RENDER_ORDER = -1;
const INDEX_URL = "./assets/launch-sites/index.json";
/**
 * The photo differs in colour from the base maps (especially 地図（彩色）), so
 * from afar a patch would read as a square: it fades in only as the camera
 * comes within this range of the surface point being drawn (km).
 */
const PATCH_FADE_FULL_KM = 400;
const PATCH_FADE_ZERO_KM = 1100;

export interface LaunchSiteImageryOptions {
  /** 地球を明るく表示: flat light, no day/night. */
  brightEarth: boolean;
  /** Same night lift as the globe (so the patch reads alike on the night side). */
  nightLift: number;
  /** Max anisotropy to use for the patch textures. */
  anisotropy: number;
  /** Load at half resolution (memory-constrained devices / save-data). */
  halfResolution: boolean;
  /** Upload a texture to the GPU right away (renderer.initTexture). */
  initTexture: (texture: THREE.Texture) => void;
  /** Fired with the credit when the first patch is drawn, and with null when none is left. */
  onCreditChange?: (credit: LaunchSiteImageryCredit | null) => void;
  /** Override for tests. */
  fetchJson?: (url: string) => Promise<unknown>;
  loadImage?: (url: string, halfResolution: boolean) => Promise<{ image: TexImageSource; flipY: boolean; release: () => void }>;
}

interface SiteState {
  entry: LaunchSiteImageryEntry;
  ecef: [number, number, number];
  mesh: THREE.Mesh | null;
  loading: AbortController | null;
  /** The image failed to load: counted as resident (no retry) until the camera leaves. */
  failed: boolean;
  outSinceMs: number | null;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function defaultLoadImage(url: string, halfResolution: boolean) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const blob = await response.blob();
  if (typeof createImageBitmap === "function") {
    try {
      const image = await createImageBitmap(blob, {
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
        ...(halfResolution ? { resizeWidth: 1024, resizeHeight: 1024, resizeQuality: "high" as const } : {}),
      });
      return { image: image as TexImageSource, flipY: false, release: () => image.close() };
    } catch {
      // Older Safari rejects some options; fall through to <img>.
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = objectUrl;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { image: image as TexImageSource, flipY: true, release: () => {} };
}

/**
 * The patch shader copies the layered globe's look: Lambert daylight from
 * the sun direction, the warm dusk band at the terminator, a flat "night
 * lift" share of the map on the night side, and the same filmic curve.
 * Under 地球を明るく表示 the patch is lit flat.
 */
function createPatchMaterial(texture: THREE.Texture, sunDirection: THREE.Vector3, options: LaunchSiteImageryOptions) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      sunDirection: { value: sunDirection },
      brightEarth: { value: options.brightEarth },
      nightLift: { value: options.nightLift },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        // The group's flattening scale would skew a normal; rotation only.
        vWorldNormal = normalize(mat3(modelMatrix) * vec3(normal.x, normal.y * ${(EARTH_RADIUS_EQUATOR_KM / EARTH_RADIUS_POLAR_KM).toFixed(9)}, normal.z));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform bool brightEarth;
      uniform float nightLift;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      vec3 earthFilmic(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      void main() {
        vec4 texel = texture2D(map, vUv);
        // sRGB → linear (the texture is uploaded without conversion).
        vec3 albedo = pow(texel.rgb, vec3(2.2));
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float alpha = smoothstep(0.0, ${PATCH_EDGE_FADE.toFixed(3)}, edge);
        // Fade with camera distance (cameraPosition is world space, Earth radii).
        alpha *= 1.0 - smoothstep(${(PATCH_FADE_FULL_KM / EARTH_RADIUS_EQUATOR_KM).toFixed(6)}, ${(PATCH_FADE_ZERO_KM / EARTH_RADIUS_EQUATOR_KM).toFixed(6)},
          distance(vWorldPosition, cameraPosition));
        if (alpha <= 0.0) discard;
        vec3 color;
        if (brightEarth) {
          color = albedo * 1.05;
        } else {
          float sunCos = dot(normalize(vWorldNormal), normalize(sunDirection));
          // Matches the globe's Phong terms: 2.0 sun + 0.2 ambient, /π.
          vec3 lit = albedo * (0.064 + 0.64 * max(sunCos, 0.0));
          float dusk = smoothstep(-0.06, 0.06, sunCos) * (1.0 - smoothstep(0.06, 0.32, sunCos));
          lit *= mix(vec3(1.0), vec3(1.0, 0.66, 0.42), dusk * 0.6);
          lit += albedo * nightLift * (1.0 - smoothstep(-0.15, 0.1, sunCos));
          color = earthFilmic(lit * 1.1);
        }
        gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), alpha);
      }
    `,
  });
}

/**
 * Lazily loaded launch-site patches. Call {@link update} once per frame with
 * the camera position in the Earth group's local frame.
 */
export class LaunchSiteImageryLayer {
  readonly group = new THREE.Group();
  /** Shared with the globe's animation bindings (world-space sun direction). */
  readonly sunDirection = new THREE.Vector3(1, 0, 0);
  private sites: SiteState[] | null = null;
  private credit: LaunchSiteImageryCredit | null = null;
  private indexRequested = false;
  private disposed = false;
  private visible = false;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly loadImage: NonNullable<LaunchSiteImageryOptions["loadImage"]>;

  private readonly options: LaunchSiteImageryOptions;

  constructor(options: LaunchSiteImageryOptions) {
    this.options = options;
    this.group.name = "launch-site-imagery";
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.loadImage = options.loadImage ?? defaultLoadImage;
  }

  /** `cameraLocal`: camera position in the Earth group's local frame (unit ≈ Earth radius). */
  update(cameraLocal: THREE.Vector3, nowMs: number) {
    if (this.disposed) return;
    const [cx, cy, cz] = earthLocalToEcef(cameraLocal.x, cameraLocal.y, cameraLocal.z);
    const altitudeKm = ecefAltitudeKm(cx, cy, cz);
    if (!this.sites) {
      // Nothing is requested until the camera first comes down low.
      if (!this.indexRequested && cameraLowEnough(altitudeKm)) this.requestIndex();
      return;
    }
    for (const site of this.sites) {
      const distanceKm = Math.hypot(cx - site.ecef[0], cy - site.ecef[1], cz - site.ecef[2]);
      const resident = site.mesh !== null || site.loading !== null || site.failed;
      const step = siteLoadStep({ distanceKm, altitudeKm }, resident, site.outSinceMs, nowMs);
      site.outSinceMs = step.outSinceMs;
      if (step.action === "load") this.loadSite(site);
      else if (step.action === "unload") this.unloadSite(site);
    }
    this.refreshVisible();
  }

  /** Whether any patch is currently drawn. */
  isVisible() {
    return this.visible;
  }

  /** Drop every patch (e.g. after a WebGL context loss); they reload while the camera stays close. */
  releaseAll() {
    for (const site of this.sites ?? []) this.unloadSite(site);
    this.refreshVisible();
  }

  dispose() {
    this.disposed = true;
    for (const site of this.sites ?? []) this.unloadSite(site);
    this.group.removeFromParent();
    if (this.visible) {
      this.visible = false;
      this.options.onCreditChange?.(null);
    }
  }

  private requestIndex() {
    this.indexRequested = true;
    this.fetchJson(INDEX_URL).then((data) => {
      if (this.disposed) return;
      const index = parseLaunchSiteIndex(data);
      this.credit = index.credit;
      this.sites = index.sites.map((entry) => ({
        entry,
        ecef: geodeticToEcefKm(entry.lat, entry.lon),
        mesh: null,
        loading: null,
        failed: false,
        outSinceMs: null,
      }));
    }, (error: unknown) => {
      console.warn("Launch-site imagery index failed to load", error);
    });
  }

  private loadSite(site: SiteState) {
    const controller = new AbortController();
    site.loading = controller;
    const url = `./assets/launch-sites/${site.entry.file}`;
    this.loadImage(url, this.options.halfResolution).then((decoded) => {
      if (controller.signal.aborted || this.disposed) {
        decoded.release();
        return;
      }
      site.loading = null;
      const texture = new THREE.Texture(decoded.image as THREE.Texture["image"]);
      texture.flipY = decoded.flipY;
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = this.options.anisotropy;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      this.options.initTexture(texture);
      decoded.release();
      const arrays = buildPatchArrays(site.entry.bounds, PATCH_SEGMENTS, PATCH_LIFT_KM);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(arrays.positions, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(arrays.uvs, 2));
      geometry.setAttribute("normal", new THREE.BufferAttribute(arrays.normals, 3));
      geometry.setIndex(arrays.indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, createPatchMaterial(texture, this.sunDirection, this.options));
      mesh.name = `launch-site-${site.entry.id}`;
      mesh.renderOrder = PATCH_RENDER_ORDER;
      mesh.frustumCulled = true;
      site.mesh = mesh;
      this.group.add(mesh);
      this.refreshVisible();
    }, (error: unknown) => {
      site.loading = null;
      if (controller.signal.aborted || this.disposed) return;
      console.warn(`Launch-site imagery failed to load: ${url}`, error);
      // Do not retry every frame: treat it as resident until the camera leaves.
      site.failed = true;
    });
  }

  private unloadSite(site: SiteState) {
    site.loading?.abort();
    site.loading = null;
    site.failed = false;
    site.outSinceMs = null;
    const mesh = site.mesh;
    if (!mesh) return;
    site.mesh = null;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    const material = mesh.material as THREE.ShaderMaterial;
    (material.uniforms.map.value as THREE.Texture).dispose();
    material.dispose();
  }

  private refreshVisible() {
    const visible = this.sites?.some((s) => s.mesh !== null) ?? false;
    if (visible === this.visible) return;
    this.visible = visible;
    this.options.onCreditChange?.(visible ? this.credit : null);
  }
}
