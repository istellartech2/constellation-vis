import { useEffect, useState } from "react";

/** Viewport width (px) below which analysis charts switch to their compact layout. */
export const COMPACT_CHART_MAX_WIDTH = 639;

const QUERY = `(max-width: ${COMPACT_CHART_MAX_WIDTH}px)`;

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

/**
 * True on phone-width viewports. Chart option builders use it to shrink
 * axis gutters so the plot area is not squeezed; it re-renders on rotation.
 */
export function useCompactChart(): boolean {
  const [compact, setCompact] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return compact;
}
