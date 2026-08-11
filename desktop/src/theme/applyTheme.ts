import { ensurePanelFont } from "./fontLoader";
import { COLOR_CSS_VARS, THEME_COLOR_KEYS } from "./presets";
import type { FontScale, PanelThemeConfig, ThemeMode } from "./types";

const FONT_STACKS: Record<PanelThemeConfig["fontSans"], string> = {
  Montserrat: '"Montserrat", system-ui, sans-serif',
  Inter: '"Inter", system-ui, sans-serif',
  "DM Sans": '"DM Sans", system-ui, sans-serif',
  Nunito: '"Nunito", system-ui, sans-serif',
  Outfit: '"Outfit", system-ui, sans-serif',
  "JetBrains Mono": '"JetBrains Mono", ui-monospace, monospace',
  "Share Tech Mono": '"Share Tech Mono", "JetBrains Mono", ui-monospace, monospace',
  "A Note": '"A Note", cursive',
  "system-ui": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const RADIUS_PX: Record<PanelThemeConfig["radius"], string> = {
  sm: "10px",
  md: "14px",
  lg: "22px",
};

const FONT_SCALE_PX: Record<FontScale, string> = {
  sm: "15px",
  md: "16px",
  lg: "18px",
  xl: "20px",
};

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Aplica variables CSS y clase .dark en html para todo el panel. */
export function applyPanelTheme(config: PanelThemeConfig): void {
  ensurePanelFont(config.fontSans);
  if (
    config.skin === "sakura" ||
    config.skin === "barbie" ||
    config.skin === "atelier"
  ) {
    ensurePanelFont("A Note");
  }
  const root = document.documentElement;
  const dark = resolveDark(config.mode);
  const skin =
    config.skin === "atelier" ||
    config.skin === "matrix" ||
    config.skin === "sakura" ||
    config.skin === "barbie"
      ? config.skin
      : "clasica";

  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark || skin === "matrix" ? "dark" : "light";
  try {
    localStorage.setItem("mck-theme-mode-hint", config.mode === "system" ? "system" : config.mode);
  } catch {
    /* ignore */
  }

  const baseAccent =
    skin === "sakura" && config.accentRgb === "12 96 105"
      ? "232 92 128"
      : skin === "barbie" && (config.accentRgb === "12 96 105" || config.accentRgb === "233 30 140")
        ? "255 126 182"
        : skin === "matrix" && config.accentRgb === "12 96 105"
          ? "0 255 65"
          : config.accentRgb;
  const accent = dark || skin === "matrix" ? liftAccentForDark(baseAccent) : baseAccent;
  root.style.setProperty("--mck-accent", accent);
  root.style.setProperty(
    "--mck-accent-hover",
    dark || skin === "matrix" ? baseAccent : darkenAccentRgb(baseAccent),
  );
  root.style.setProperty("--mck-font-sans", FONT_STACKS[config.fontSans]);
  root.style.setProperty("--mck-radius-paper", RADIUS_PX[config.radius]);
  root.style.fontSize = FONT_SCALE_PX[config.fontScale] ?? FONT_SCALE_PX.md;
  root.dataset.mckSkin = skin;
  root.dataset.mckMenu = config.menuScale === "sm" || config.menuScale === "lg" ? config.menuScale : "md";

  for (const key of THEME_COLOR_KEYS) {
    root.style.removeProperty(COLOR_CSS_VARS[key]);
  }
  for (const key of THEME_COLOR_KEYS) {
    const rgb = config.colors[key];
    if (rgb) root.style.setProperty(COLOR_CSS_VARS[key], rgb);
  }

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    const hex =
      skin === "matrix"
        ? "#030803"
        : skin === "sakura"
          ? "#e85c80"
          : skin === "barbie"
            ? "#ff7eb6"
            : dark
              ? "#2B454F"
              : rgbToHex(config.accentRgb);
    themeMeta.setAttribute("content", hex);
  }
}

/** Sube luminosidad HSL ~58% sin blanquear (evita acentos “sucios”). */
function liftAccentForDark(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "94 186 198";
  const [r, g, b] = parts.map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  const targetL = Math.max(l, 0.58);
  const targetS = Math.min(0.72, Math.max(s, 0.45));

  function hue2rgb(p: number, q: number, t: number) {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }

  let outR: number;
  let outG: number;
  let outB: number;
  if (targetS === 0) {
    outR = outG = outB = targetL;
  } else {
    const q = targetL < 0.5 ? targetL * (1 + targetS) : targetL + targetS - targetL * targetS;
    const p = 2 * targetL - q;
    outR = hue2rgb(p, q, h + 1 / 3);
    outG = hue2rgb(p, q, h);
    outB = hue2rgb(p, q, h - 1 / 3);
  }
  return [outR, outG, outB].map((n) => Math.round(Math.min(255, Math.max(0, n * 255)))).join(" ");
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

export function readCssColor(varName: string): string {
  if (typeof document === "undefined") return "12 96 105";
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || "12 96 105";
}
