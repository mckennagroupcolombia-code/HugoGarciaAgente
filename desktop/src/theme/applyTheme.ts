import { ensurePanelFont } from "./fontLoader";
import type { PanelThemeConfig, ThemeMode } from "./types";

const FONT_STACKS: Record<PanelThemeConfig["fontSans"], string> = {
  Montserrat: '"Montserrat", system-ui, sans-serif',
  Inter: '"Inter", system-ui, sans-serif',
  "DM Sans": '"DM Sans", system-ui, sans-serif',
  Nunito: '"Nunito", system-ui, sans-serif',
  "system-ui": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const RADIUS_PX: Record<PanelThemeConfig["radius"], string> = {
  sm: "10px",
  md: "14px",
  lg: "22px",
};

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Aplica variables CSS y clase .dark en html para todo el panel. */
export function applyPanelTheme(config: PanelThemeConfig): void {
  ensurePanelFont(config.fontSans);
  const root = document.documentElement;
  const dark = resolveDark(config.mode);

  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem("mck-theme-mode-hint", config.mode === "system" ? "system" : config.mode);
  } catch {
    /* ignore */
  }
  // Mismos acentos que en claro: saturación limpia (sin aclarar → no se ensucian).
  root.style.setProperty("--mck-accent", config.accentRgb);
  root.style.setProperty("--mck-accent-hover", darkenAccentRgb(config.accentRgb));
  root.style.setProperty("--mck-font-sans", FONT_STACKS[config.fontSans]);
  root.style.setProperty("--mck-radius-paper", RADIUS_PX[config.radius]);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", dark ? "#2B454F" : rgbToHex(config.accentRgb));
  }
}

function darkenAccentRgb(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return rgb;
  const [r, g, b] = parts;
  return `${Math.max(0, r - 8)} ${Math.max(0, g - 15)} ${Math.max(0, b - 16)}`;
}

export function rgbToHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map((n) => Math.min(255, Math.max(0, Number(n))));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "#0c6069";
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): string {
  const h = hex.replace(/^#/, "");
  if (h.length !== 6) return "12 96 105";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "12 96 105";
  return `${r} ${g} ${b}`;
}
