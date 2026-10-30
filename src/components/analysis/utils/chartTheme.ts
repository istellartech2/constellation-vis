// Resolves semantic CSS design tokens into plain colour strings for ECharts / canvas / exports.
import { useEffect, useState } from "react";

export interface ChartTheme {
  isDark: boolean;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  line: string;
  lineStrong: string;
  surface: string;
  raised: string;
  brand: string;
  brandText: string;
  danger: string;
  success: string;
  warning: string;
  info: string;
  /**
   * Categorical series colours in a fixed order (blue, orange, aqua, yellow).
   * Assign by entity, never by rank, and never cycle past the end.
   */
  series: [string, string, string, string];
  /**
   * Sequential one-hue ramp for counts such as "satellites in view":
   * index 0 = 1 satellite … index 3 = 4 or more. 0 is drawn as empty.
   */
  seq: [string, string, string, string];
  /** Background band for context periods (eclipse, outages). */
  shade: string;
}

// Validated categorical palette (OKLab CVD-separated), one variant per surface.
const SERIES_DARK: ChartTheme["series"] = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const SERIES_LIGHT: ChartTheme["series"] = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
// Blue ramp; in dark mode more = lighter, in light mode more = darker.
const SEQ_DARK: ChartTheme["seq"] = ["#1d4f8f", "#2f74c9", "#5c9de8", "#a9cdf5"];
const SEQ_LIGHT: ChartTheme["seq"] = ["#b5d4f4", "#6fa8e8", "#2a78d6", "#0c447c"];

const FALLBACK: ChartTheme = {
  isDark: true,
  fg: "#f1f1f4",
  fgMuted: "#a8aab3",
  fgSubtle: "#6e717b",
  line: "rgba(255, 255, 255, 0.08)",
  lineStrong: "rgba(255, 255, 255, 0.15)",
  surface: "#1d1e22",
  raised: "#2a2b30",
  brand: "#f07214",
  brandText: "#ff9a4d",
  danger: "#e5484d",
  success: "#3dbd7d",
  warning: "#e5b800",
  info: "#4ea1d9",
  series: SERIES_DARK,
  seq: SEQ_DARK,
  shade: "rgba(255, 255, 255, 0.05)",
};

type TokenKey = Exclude<keyof ChartTheme, "isDark" | "series" | "seq" | "shade">;

const TOKEN_MAP: Record<TokenKey, string> = {
  fg: "--fg",
  fgMuted: "--fg-muted",
  fgSubtle: "--fg-subtle",
  line: "--line",
  lineStrong: "--line-strong",
  surface: "--surface-solid",
  raised: "--raised",
  brand: "--brand",
  brandText: "--brand-text",
  danger: "--danger",
  success: "--success",
  warning: "--warning",
  info: "--info",
};

/**
 * Convert any CSS colour (including oklch(), which getComputedStyle returns
 * unchanged in modern browsers and ECharts cannot parse) to rgba() by
 * painting one pixel on a canvas and reading it back.
 */
function toRgba(ctx: CanvasRenderingContext2D, color: string): string | null {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

function currentThemeIsDark(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.theme !== "light";
}

export function getChartTheme(): ChartTheme {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { ...FALLBACK };
  }
  const isDark = currentThemeIsDark();
  const style = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const result: ChartTheme = {
    ...FALLBACK,
    isDark,
    series: isDark ? SERIES_DARK : SERIES_LIGHT,
    seq: isDark ? SEQ_DARK : SEQ_LIGHT,
    shade: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(20, 30, 50, 0.06)",
  };
  if (!ctx) return result;
  (Object.keys(TOKEN_MAP) as TokenKey[]).forEach((key) => {
    const raw = style.getPropertyValue(TOKEN_MAP[key]).trim();
    if (!raw) return;
    result[key] = toRgba(ctx, raw) ?? raw;
  });
  return result;
}

/**
 * Chart theme that follows the app's light/dark switch (<html data-theme>).
 * Chart option builders should take the returned theme as an argument so the
 * charts repaint when the user toggles the theme.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(getChartTheme);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setTheme(getChartTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
