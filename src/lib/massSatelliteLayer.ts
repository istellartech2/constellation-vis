import * as THREE from "three";
import { j2AnglesAt, j2OrbitsFromCatalog, j2PeriodMinutes, j2StateAt, type J2Orbits } from "./j2Propagator";
import { isFilingRow, type SatelliteCatalog } from "./satelliteCatalog";
import { POINT_STYLE_FRAGMENT_PARS, POINT_STYLE_VERTEX_PARS, PIXEL_DOT_ALPHA, createPointStyleUniforms, type PointStyleUniforms } from "./satellitePointStyle";
import { LAYER_PALETTE, MAX_CATALOG_LAYERS, type CatalogLayerStyle, type LayerColorMode } from "./catalogLayers";

/**
 * GPU-propagated point layer for 10^4–10^6 satellites.
 *
 * Every satellite's J2 secular orbit is evaluated in the vertex shader each
 * frame (see `j2Propagator.ts` for the model and its CPU twin), together with
 * the per-ground-station elevation test that colours it. The CPU never touches
 * all satellites per frame; it only
 *   - re-bases the float32 angles once per simulated day (precision),
 *   - propagates the selected satellite and a small capped "focus" subset
 *     (link lines, FOV cones), found by an incremental time-sliced scan,
 *   - runs a full CPU pass on click for picking.
 *
 * The scene uses two independent instances: one for the editor satellites
 * when they alone exceed `MASS_MODE_THRESHOLD`, and one for the catalog layers
 * (always, at any count). Each vertex carries a layer index, so per-layer
 * colour and visibility are uniform updates; the editor instance has a
 * single always-visible layer coloured by ground-station visibility.
 */

/** Total satellite count above which the scene switches to this layer. */
export const MASS_MODE_THRESHOLD = 20_000;
/** Max ground stations the shader tests for visibility colouring. */
export const MASS_MAX_STATIONS = 32;
/** Max satellite–station link lines / FOV cones drawn in mass mode. */
export const MASS_FOCUS_LIMIT = 500;

export function isMassMode(satelliteCount: number): boolean {
  return satelliteCount > MASS_MODE_THRESHOLD;
}

const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;
/** Re-base angles when sim time drifts this far from the reference (float32 precision). */
const REBASE_MS = 24 * 3600_000;
/**
 * Point size / opacity factors for dense catalogs: at 10^6 full-size dots
 * would paint the whole globe (and cost far more fill rate than the orbit
 * math), so dots shrink toward ~1 px and fade as the count grows.
 */
export function massDensityScale(count: number): { size: number; alpha: number } {
  return {
    size: Math.min(1, Math.max(0.25, Math.sqrt(MASS_MODE_THRESHOLD / count))),
    alpha: Math.min(1, Math.max(0.35, Math.sqrt(100_000 / count))),
  };
}
/** Main-thread time per frame spent scanning for the focus subset. */
const SCAN_BUDGET_MS = 3;

/**
 * Per-row layer index (0..MAX_CATALOG_LAYERS-1) from the layer counts, in
 * merged order. When the counts do not add up to `count` (or there are no
 * styles) every row falls back to layer 0.
 */
export function buildLayerIndexes(styles: readonly CatalogLayerStyle[], count: number, out: Uint8Array = new Uint8Array(count)): Uint8Array {
  out.fill(0);
  if (!layerCountsMatch(styles, count)) return out;
  let start = 0;
  for (let k = 0; k < styles.length; k++) {
    const end = start + styles[k].count;
    out.fill(Math.min(k, MAX_CATALOG_LAYERS - 1), start, end);
    start = end;
  }
  return out;
}

function layerCountsMatch(styles: readonly CatalogLayerStyle[], count: number): boolean {
  if (styles.length === 0) return false;
  let sum = 0;
  for (const s of styles) sum += s.count;
  return sum === count;
}

const vertexShader = /* glsl */ `
#define MAX_STATIONS ${MASS_MAX_STATIONS}
#define MAX_LAYERS ${MAX_CATALOG_LAYERS}
// position = (raan, argp, M) at the reference epoch; aRates = their rates (rad/min).
attribute vec4 aShape; // semi-major axis km, eccentricity, inclination, filing flag
attribute vec3 aRates;
attribute float aLayer; // layer index (unsigned byte, read as float)
uniform float uDt;
uniform float uSize;
uniform float uSelectedSize;
uniform float uScale;
uniform float uSelected;
uniform bool uGround;
uniform int uStationCount;
uniform vec3 uStationPos[MAX_STATIONS];
uniform vec3 uStationUp[MAX_STATIONS];
uniform float uStationSinEl[MAX_STATIONS];
uniform vec3 uVisibleColor;
uniform vec3 uHiddenColor;
uniform vec3 uSelectedColor;
uniform vec3 uGroundColor;
uniform vec3 uLayerColor[MAX_LAYERS];
uniform float uLayerVisible[MAX_LAYERS];
uniform float uColorMode; // 1 = per-layer colour, 0 = ground-station visibility
varying vec3 vColor;
varying float vFiling;
${POINT_STYLE_VERTEX_PARS}
const float PI = 3.141592653589793;
void main() {
  int layer = int(clamp(aLayer, 0.0, float(MAX_LAYERS - 1)) + 0.5);
  if (uLayerVisible[layer] < 0.5) {
    // Hidden layer: park the vertex outside the clip volume with no size.
    vColor = vec3(0.0);
    vFiling = 0.0;
    vPixelDot = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float a = aShape.x;
  float e = aShape.y;
  float inc = aShape.z;
  float raan = position.x + aRates.x * uDt;
  float argp = position.y + aRates.y * uDt;
  float M = mod(position.z + aRates.z * uDt + PI, 2.0 * PI) - PI;
  float E = M + e * sin(M);
  for (int k = 0; k < 6; k++) {
    E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  }
  float xp = a * (cos(E) - e);
  float yp = a * sqrt(1.0 - e * e) * sin(E);
  float cO = cos(raan), sO = sin(raan), cw = cos(argp), sw = sin(argp), ci = cos(inc), si = sin(inc);
  vec3 eci = vec3(
    (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp,
    (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp,
    (sw * si) * xp + (cw * si) * yp
  );
  vec3 p = vec3(eci.x / ${EARTH_RADIUS_EQUATOR_KM.toFixed(3)}, eci.z / ${EARTH_RADIUS_POLAR_KM.toFixed(7)}, -eci.y / ${EARTH_RADIUS_EQUATOR_KM.toFixed(3)});
  bool selected = abs(float(gl_VertexID) - uSelected) < 0.5;
  float size = uSize;
  vFiling = aShape.w;
  if (uGround) {
    p = normalize(p) * 1.001;
    vColor = uGroundColor;
    vFiling = 0.0;
  } else {
    vec3 base;
    if (uColorMode > 0.5) {
      base = uLayerColor[layer];
    } else {
      bool visible = false;
      for (int s = 0; s < MAX_STATIONS; s++) {
        if (s >= uStationCount) break;
        vec3 rho = eci - uStationPos[s];
        if (dot(rho, uStationUp[s]) > uStationSinEl[s] * length(rho)) { visible = true; break; }
      }
      base = visible ? uVisibleColor : uHiddenColor;
    }
    vColor = selected ? uSelectedColor : base;
    if (vFiling > 0.5) size *= 1.35;
    if (selected) size = uSelectedSize;
  }
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float pointSize = max(size * uScale / -mvPosition.z, 1.0);
  if (uGround) {
    // Sub-satellite points follow the pixel mode too, one step smaller than the satellite.
    vPixelDot = uPixelSize > 0.0 ? 1.0 : 0.0;
    gl_PointSize = uPixelSize > 0.0 ? max(uPixelSize - 1.0, 1.0) * uPixelRatio : pointSize;
  } else {
    gl_PointSize = styleSatPoint(p, float(gl_VertexID), selected, vFiling > 0.5, pointSize, vColor);
  }
}
`;

const fragmentShader = /* glsl */ `
uniform float uAlpha;
varying vec3 vColor;
varying float vFiling;
${POINT_STYLE_FRAGMENT_PARS}
void main() {
  float d = length(gl_PointCoord - 0.5);
  float alpha;
  if (vPixelDot > 0.5) {
    alpha = ${PIXEL_DOT_ALPHA};
  } else if (vFiling > 0.5) {
    // Declared filings draw as a hollow ring, never as a tracked satellite.
    alpha = smoothstep(0.5, 0.42, d) * smoothstep(0.24, 0.32, d);
  } else {
    alpha = smoothstep(0.5, 0.4, d);
  }
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha * uAlpha);
}
`;

export interface MassStation {
  /** ECI position, km. */
  eci: { x: number; y: number; z: number };
  /** Geodetic up unit vector in ECI. */
  up: { x: number; y: number; z: number };
  sinMinElevation: number;
}

export interface MassLayerColors {
  visible: THREE.Color;
  hidden: THREE.Color;
  selected: THREE.Color;
}

/** A screen-space pick hit: row index and distance from the pointer in CSS px. */
export interface MassPickHit {
  index: number;
  distance: number;
}

export class MassSatelliteLayer {
  readonly count: number;
  readonly points: THREE.Points;
  readonly groundPoints: THREE.Points;
  private readonly orbits: J2Orbits;
  private readonly geometry: THREE.BufferGeometry;
  private readonly angleAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly groundMaterial: THREE.ShaderMaterial;
  private refMs: number;
  private readonly stationPos: THREE.Vector3[];
  private readonly stationUp: THREE.Vector3[];
  private readonly stationSinEl: number[];
  private readonly scratch = new Float64Array(3);
  private readonly scratchVel = new Float64Array(3);
  private readonly density: { size: number; alpha: number };
  /** Per-row layer index; kept on the CPU for pick filtering and in-place regrouping. */
  private readonly layerIndexes: Uint8Array;
  private readonly layerAttr: THREE.BufferAttribute;
  private layerCounts: number[] = [];
  private readonly layerColors = Array.from({ length: MAX_CATALOG_LAYERS }, () => new THREE.Color());
  private readonly layerVisible: number[] = new Array(MAX_CATALOG_LAYERS).fill(1);

  // Incremental focus scan state: (satellite, station) pairs.
  private scanCursor = 0;
  private scanPairs: number[] = [];
  private focusPairs: number[] = [];

  /**
   * `style` is shared by reference with the scene's other satellite
   * materials, so pixel size, shading and glint follow one set of uniforms.
   */
  constructor(catalog: SatelliteCatalog, startMs: number, satRadius: number, colors: MassLayerColors, style: PointStyleUniforms = createPointStyleUniforms()) {
    this.count = catalog.count;
    this.orbits = j2OrbitsFromCatalog(catalog);
    this.refMs = startMs;
    this.density = massDensityScale(catalog.count);

    const n = catalog.count;
    const angles = new Float32Array(n * 3);
    j2AnglesAt(this.orbits, this.refMs, angles);
    const shape = new Float32Array(n * 4);
    const rates = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      shape[i * 4] = this.orbits.semiMajorAxisKm[i];
      shape[i * 4 + 1] = catalog.eccentricity[i];
      shape[i * 4 + 2] = catalog.inclination[i];
      shape[i * 4 + 3] = isFilingRow(catalog, i) ? 1 : 0;
      rates[i * 3] = this.orbits.raanDot[i];
      rates[i * 3 + 1] = this.orbits.argPerigeeDot[i];
      rates[i * 3 + 2] = this.orbits.meanAnomalyDot[i];
    }
    this.geometry = new THREE.BufferGeometry();
    this.angleAttr = new THREE.BufferAttribute(angles, 3);
    this.angleAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.angleAttr);
    // Shape and rates never change: free the CPU copies once on the GPU.
    const freeAfterUpload = function (this: THREE.BufferAttribute) {
      (this as { array: unknown }).array = new Float32Array(0);
    };
    this.geometry.setAttribute("aShape", new THREE.BufferAttribute(shape, 4).onUpload(freeAfterUpload));
    this.geometry.setAttribute("aRates", new THREE.BufferAttribute(rates, 3).onUpload(freeAfterUpload));
    this.layerIndexes = new Uint8Array(n);
    this.layerAttr = new THREE.BufferAttribute(this.layerIndexes, 1);
    this.geometry.setAttribute("aLayer", this.layerAttr);
    // "position" holds angles, not coordinates; give three a bounding sphere
    // that covers GEO so it never computes one from them.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    this.stationPos = Array.from({ length: MASS_MAX_STATIONS }, () => new THREE.Vector3());
    this.stationUp = Array.from({ length: MASS_MAX_STATIONS }, () => new THREE.Vector3());
    this.stationSinEl = new Array(MASS_MAX_STATIONS).fill(1);

    const uniforms = () => ({
      uDt: { value: 0 },
      uSize: { value: satRadius * 2 * this.density.size },
      uSelectedSize: { value: satRadius * 2 * 1.8 },
      uAlpha: { value: this.density.alpha },
      uScale: { value: 1 },
      uSelected: { value: -1 },
      uGround: { value: false },
      uStationCount: { value: 0 },
      uStationPos: { value: this.stationPos },
      uStationUp: { value: this.stationUp },
      uStationSinEl: { value: this.stationSinEl },
      uVisibleColor: { value: colors.visible },
      uHiddenColor: { value: colors.hidden },
      uSelectedColor: { value: colors.selected },
      uGroundColor: { value: new THREE.Color(0xa9a9a9) },
      uLayerColor: { value: this.layerColors },
      uLayerVisible: { value: this.layerVisible },
      uColorMode: { value: 0 },
      ...style,
    });
    this.material = new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader, fragmentShader, transparent: true });
    this.groundMaterial = new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader, fragmentShader, transparent: true });
    this.groundMaterial.uniforms.uGround.value = true;
    this.groundMaterial.uniforms.uSize.value = 0.01 * this.density.size;
    this.points = new THREE.Points(this.geometry, this.material);
    this.groundPoints = new THREE.Points(this.geometry, this.groundMaterial);
    this.points.frustumCulled = false;
    this.groundPoints.frustumCulled = false;
  }

  setSatRadius(radius: number) {
    this.material.uniforms.uSize.value = radius * 2 * this.density.size;
    this.material.uniforms.uSelectedSize.value = radius * 2 * 1.8;
  }

  setSelected(index: number | null) {
    this.material.uniforms.uSelected.value = index ?? -1;
  }

  /**
   * Per-layer colour and visibility (merged order, counts summing to
   * `count`). Uniform-only unless the layer counts changed, in which case the
   * small per-row index buffer is rewritten in place. Empty styles mean one
   * visible layer in the first palette colour.
   */
  setLayerStyles(styles: readonly CatalogLayerStyle[]) {
    const counts = styles.map((s) => s.count);
    if (counts.length !== this.layerCounts.length || counts.some((c, k) => c !== this.layerCounts[k])) {
      buildLayerIndexes(styles, this.count, this.layerIndexes);
      this.layerAttr.needsUpdate = true;
      this.layerCounts = counts;
    }
    const grouped = layerCountsMatch(styles, this.count);
    for (let k = 0; k < MAX_CATALOG_LAYERS; k++) {
      // Without matching counts every row is layer 0: first entry's colour, always shown.
      const style = grouped || k === 0 ? styles[k] : undefined;
      this.layerColors[k].set(style?.color ?? LAYER_PALETTE[k % LAYER_PALETTE.length]);
      this.layerVisible[k] = grouped && style && !style.visible ? 0 : 1;
    }
  }

  /** Colour dots per layer, or by ground-station visibility (the default). */
  setColorMode(mode: LayerColorMode) {
    this.material.uniforms.uColorMode.value = mode === "layer" ? 1 : 0;
  }

  /** Whether row `i` belongs to a visible layer (hidden rows are neither drawn nor pickable). */
  isRowVisible(i: number): boolean {
    return this.layerVisible[this.layerIndexes[i]] > 0.5;
  }

  /**
   * Per-frame update: time uniform (re-basing when needed), stations and the
   * point-size scale (drawing-buffer height / 2, as PointsMaterial uses).
   */
  update(simMs: number, stations: MassStation[], pointScale: number) {
    if (Math.abs(simMs - this.refMs) > REBASE_MS) {
      this.refMs = simMs;
      j2AnglesAt(this.orbits, this.refMs, this.angleAttr.array as Float32Array);
      this.angleAttr.needsUpdate = true;
    }
    const dt = (simMs - this.refMs) / 60000;
    const stationCount = Math.min(stations.length, MASS_MAX_STATIONS);
    for (let s = 0; s < stationCount; s++) {
      const st = stations[s];
      this.stationPos[s].set(st.eci.x, st.eci.y, st.eci.z);
      this.stationUp[s].set(st.up.x, st.up.y, st.up.z);
      this.stationSinEl[s] = st.sinMinElevation;
    }
    for (const m of [this.material, this.groundMaterial]) {
      m.uniforms.uDt.value = dt;
      m.uniforms.uScale.value = pointScale;
      m.uniforms.uStationCount.value = stationCount;
    }
  }

  /** ECI position (km) and velocity (km/s) of satellite `i` at `ms` — the same orbit the shader draws. */
  stateAt(i: number, ms: number): { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } {
    j2StateAt(this.orbits, i, ms, this.scratch, 0, this.scratchVel);
    return {
      position: { x: this.scratch[0], y: this.scratch[1], z: this.scratch[2] },
      velocity: { x: this.scratchVel[0], y: this.scratchVel[1], z: this.scratchVel[2] },
    };
  }

  periodMinutes(i: number): number {
    return j2PeriodMinutes(this.orbits, i);
  }

  /**
   * Satellites within `radiusPx` of the pointer, nearest first, skipping
   * ones behind the camera, hidden by the Earth (unit sphere) or rejected by
   * `include` (e.g. rows of hidden layers). A single allocation-free CPU pass
   * (~10^6 Kepler solves) run only on click.
   */
  pick(
    camera: THREE.Camera,
    rect: { left: number; top: number; width: number; height: number },
    x: number,
    y: number,
    radiusPx: number,
    simMs: number,
    include?: (i: number) => boolean,
  ): MassPickHit[] {
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    const cam = camera.getWorldPosition(new THREE.Vector3());
    const camLenSq = cam.lengthSq() - 1;
    const p = this.scratch;
    const hits: MassPickHit[] = [];
    for (let i = 0; i < this.count; i++) {
      if (include && !include(i)) continue;
      j2StateAt(this.orbits, i, simMs, p);
      const wx = p[0] / EARTH_RADIUS_EQUATOR_KM;
      const wy = p[2] / EARTH_RADIUS_POLAR_KM;
      const wz = -p[1] / EARTH_RADIUS_EQUATOR_KM;
      const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      if (cw <= 0) continue;
      const nx = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
      const ny = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
      const sx = rect.left + ((nx + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - ny) / 2) * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d > radiusPx) continue;
      // Ray–sphere test: does the line of sight hit the Earth first?
      const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
      const dist = Math.hypot(dx, dy, dz);
      const b = (cam.x * dx + cam.y * dy + cam.z * dz) / dist;
      const disc = b * b - camLenSq;
      const tHit = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
      if (tHit > 0 && tHit < dist) continue;
      hits.push({ index: i, distance: d });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Advance the time-sliced scan for (satellite, station) pairs in view, and
   * return the latest completed set (flat [sat, station, ...], at most
   * `MASS_FOCUS_LIMIT` pairs). Pairs may be a few frames stale; callers
   * re-check visibility with fresh positions before drawing.
   */
  advanceFocusScan(simMs: number, stations: MassStation[]): readonly number[] {
    const stationCount = Math.min(stations.length, MASS_MAX_STATIONS);
    if (stationCount === 0) {
      this.focusPairs = [];
      return this.focusPairs;
    }
    const p = this.scratch;
    const deadline = performance.now() + SCAN_BUDGET_MS;
    let i = this.scanCursor;
    for (; i < this.count && this.scanPairs.length < MASS_FOCUS_LIMIT * 2; i++) {
      if ((i & 1023) === 0 && performance.now() > deadline) break;
      j2StateAt(this.orbits, i, simMs, p);
      for (let s = 0; s < stationCount; s++) {
        if (stationSeesPoint(stations[s], p[0], p[1], p[2])) {
          this.scanPairs.push(i, s);
          if (this.scanPairs.length >= MASS_FOCUS_LIMIT * 2) break;
        }
      }
    }
    this.scanCursor = i;
    if (this.scanCursor >= this.count || this.scanPairs.length >= MASS_FOCUS_LIMIT * 2) {
      this.focusPairs = this.scanPairs;
      this.scanPairs = [];
      // Restart from a rotating offset when capped, so a full catalog is not
      // always represented by its first few hundred visible satellites.
      this.scanCursor = this.scanCursor >= this.count ? 0 : this.scanCursor;
    }
    return this.focusPairs;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.groundMaterial.dispose();
  }
}

/** Elevation test against a station: sin(el) = (ρ · up) / |ρ|. */
export function stationSeesPoint(st: MassStation, x: number, y: number, z: number): boolean {
  const rx = x - st.eci.x, ry = y - st.eci.y, rz = z - st.eci.z;
  return rx * st.up.x + ry * st.up.y + rz * st.up.z > st.sinMinElevation * Math.hypot(rx, ry, rz);
}
