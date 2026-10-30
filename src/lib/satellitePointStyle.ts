import * as THREE from "three";

/**
 * How satellite dots are drawn, shared by the CPU point cloud and the GPU
 * (J2) layers.
 *
 * Real satellites are far below one pixel at any zoom, so a world-size dot
 * (the default S–LL sizes, 60–300 km across) makes a constellation read as a
 * debris cloud. The pixel mode instead keeps every dot a fixed 1–3 CSS px, so
 * satellites shrink against the Earth as the camera closes in. Two optional
 * cues add realism: dimming satellites in the Earth's shadow, and brief
 * sun-glint flashes.
 */
export interface SatellitePointStyle {
  /** Fixed dot size in CSS px; 0 keeps the world-size dots (`satRadius`). */
  pixelSize: number;
  /** Dim satellites inside the Earth's (cylindrical) shadow. */
  sunlitShading: boolean;
  /** Occasional sun-glint flashes on sunlit satellites. */
  glint: boolean;
}

export const DEFAULT_POINT_STYLE: SatellitePointStyle = { pixelSize: 0, sunlitShading: false, glint: false };

/** Pixel sizes offered in the UI (CSS px). */
export const PIXEL_SIZE_OPTIONS = [1, 2, 3] as const;
export const MAX_PIXEL_SIZE = 3;

export interface PointStyleUniforms {
  [name: string]: THREE.IUniform;
  uPixelSize: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunlitShading: THREE.IUniform<number>;
  uGlint: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
}

/** One uniform set shared (by reference) by every satellite material in a scene. */
export function createPointStyleUniforms(style: SatellitePointStyle = DEFAULT_POINT_STYLE): PointStyleUniforms {
  const uniforms: PointStyleUniforms = {
    uPixelSize: { value: 0 },
    uPixelRatio: { value: 1 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunlitShading: { value: 0 },
    uGlint: { value: 0 },
    uTime: { value: 0 },
  };
  applyPointStyle(uniforms, style);
  return uniforms;
}

export function applyPointStyle(uniforms: PointStyleUniforms, style: SatellitePointStyle) {
  uniforms.uPixelSize.value = Math.min(Math.max(style.pixelSize, 0), MAX_PIXEL_SIZE);
  uniforms.uSunlitShading.value = style.sunlitShading ? 1 : 0;
  uniforms.uGlint.value = style.glint ? 1 : 0;
}

/**
 * Vertex-shader declarations. `styleSatPoint` takes the scene position (Earth
 * radii, scene axes), a per-satellite id, the selection/filing flags and the
 * size the material computed, tints `color` and returns the final
 * gl_PointSize in drawing-buffer pixels.
 */
export const POINT_STYLE_VERTEX_PARS = /* glsl */ `
uniform float uPixelSize;
uniform float uPixelRatio;
uniform vec3 uSunDir;
uniform float uSunlitShading;
uniform float uGlint;
uniform float uTime;
varying float vPixelDot;
float satSunlit(vec3 p) {
  float along = dot(p, uSunDir);
  if (along >= 0.0) return 1.0;
  return smoothstep(0.97, 1.03, length(p - along * uSunDir));
}
float satGlint(float id) {
  // Each satellite flashes briefly every 4–15 s at its own phase.
  float h = fract(sin(id * 12.9898 + 78.233) * 43758.5453);
  float phase = uTime * (0.4 + 1.2 * h) + h * 43.98;
  return pow(max(sin(phase), 0.0), 80.0);
}
float styleSatPoint(vec3 p, float id, bool selected, bool filing, float materialSize, inout vec3 color) {
  bool cues = uSunlitShading > 0.5 || uGlint > 0.5;
  float lit = cues ? satSunlit(p) : 1.0;
  float glint = (uGlint > 0.5 && !selected && !filing) ? satGlint(id) * lit : 0.0;
  if (uSunlitShading > 0.5 && !selected) color *= mix(0.25, 1.0, lit);
  color = mix(color, vec3(1.0), glint * 0.85);
  if (uPixelSize <= 0.0) {
    vPixelDot = 0.0;
    return materialSize * (1.0 + glint);
  }
  // Selected satellites and filing rings keep a readable marker size.
  float px = selected ? uPixelSize + 5.0 : filing ? max(uPixelSize, 7.0) : uPixelSize;
  vPixelDot = (selected || filing) ? 0.0 : 1.0;
  return px * (1.0 + 1.5 * glint) * uPixelRatio;
}
`;

export const POINT_STYLE_FRAGMENT_PARS = /* glsl */ `
varying float vPixelDot;
`;

/** Alpha for a fixed-pixel dot: solid core, only the extreme corners fade. */
export const PIXEL_DOT_ALPHA = /* glsl */ `(1.0 - smoothstep(0.42, 0.5, length(gl_PointCoord - 0.5)))`;
