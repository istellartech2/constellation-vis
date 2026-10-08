// Resolves semantic CSS design tokens into plain colour strings for ECharts / canvas / exports.

export interface ChartTheme {
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
}

const FALLBACK: ChartTheme = {
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
};

const TOKEN_MAP: Record<keyof ChartTheme, string> = {
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

export function getChartTheme(): ChartTheme {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { ...FALLBACK };
  }
  const style = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ...FALLBACK };
  const result = { ...FALLBACK };
  (Object.keys(TOKEN_MAP) as Array<keyof ChartTheme>).forEach((key) => {
    const raw = style.getPropertyValue(TOKEN_MAP[key]).trim();
    if (!raw) return;
    result[key] = toRgba(ctx, raw) ?? raw;
  });
  return result;
}
