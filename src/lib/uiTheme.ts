import { useCallback, useState } from "react";

/** Colour theme of the UI chrome (panels, dialogs, HUD). The 3D scene background is separate. */
export type UiTheme = "dark" | "light";

const STORAGE_KEY = "cv-ui-theme";

/** Theme currently applied to <html data-theme> (set before first paint by index.html). */
export function getUiTheme(): UiTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setUiTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable (private mode etc.) — theme still applies for this session
  }
}

export function useUiTheme(): [UiTheme, (theme: UiTheme) => void] {
  const [theme, setTheme] = useState<UiTheme>(getUiTheme);
  const update = useCallback((next: UiTheme) => {
    setUiTheme(next);
    setTheme(next);
  }, []);
  return [theme, update];
}
