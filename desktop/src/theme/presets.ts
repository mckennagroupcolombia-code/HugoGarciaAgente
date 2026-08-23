import type {
  FontChoice,
  FontScale,
  MenuScale,
  PanelThemeConfig,
  ThemeColorKey,
  ThemeColorMap,
  ThemePackId,
  ThemeMode,
  RadiusScale,
  UiSkin,
  UserThemePreset,
} from "./types";

export const THEME_COLOR_KEYS: ThemeColorKey[] = [
  "surface",
  "surfacePanel",
  "surfaceInput",
  "surfaceHover",
  "ink",
  "inkSecondary",
  "muted",
  "border",
  "borderStrong",
  "menuBg",
  "menuText",
  "menuActiveBg",
  "menuActiveText",
  "submenuBg",
  "submenuText",
  "title",
  "subtitle",
  "cardBg",
  "sectionBg",
];

export const COLOR_CSS_VARS: Record<ThemeColorKey, string> = {
  surface: "--mck-surface",
  surfacePanel: "--mck-surface-panel",
  surfaceInput: "--mck-surface-input",
  surfaceHover: "--mck-surface-hover",
  ink: "--mck-ink",
  inkSecondary: "--mck-ink-secondary",
  muted: "--mck-muted",
  border: "--mck-border",
  borderStrong: "--mck-border-strong",
  menuBg: "--mck-menu-bg",
  menuText: "--mck-menu-text",
  menuActiveBg: "--mck-menu-active-bg",
  menuActiveText: "--mck-menu-active-text",
  submenuBg: "--mck-submenu-bg",
  submenuText: "--mck-submenu-text",
  title: "--mck-title",
  subtitle: "--mck-subtitle",
  cardBg: "--mck-card-bg",
  sectionBg: "--mck-section-bg",
};

export const COLOR_LABELS: Record<ThemeColorKey, string> = {
  surface: "Fondo general",
  surfacePanel: "Paneles",
  surfaceInput: "Campos",
  surfaceHover: "Hover",
  ink: "Texto",
  inkSecondary: "Texto secundario",
  muted: "Texto suave",
  border: "Bordes",
  borderStrong: "Bordes fuertes",
  menuBg: "Fondo del menú",
  menuText: "Texto del menú",
  menuActiveBg: "Menú activo (fondo)",
  menuActiveText: "Menú activo (texto)",
  submenuBg: "Fondo submenús / pestañas",
  submenuText: "Texto submenús",
  title: "Títulos",
  subtitle: "Subtítulos",
  cardBg: "Cajas / tarjetas",
  sectionBg: "Apartados",
};

export const FONT_CHOICES: { id: FontChoice; label: string }[] = [
  { id: "Montserrat", label: "Montserrat" },
  { id: "Inter", label: "Inter" },
  { id: "DM Sans", label: "DM Sans" },
  { id: "Nunito", label: "Nunito" },
  { id: "Outfit", label: "Outfit" },
  { id: "A Note", label: "A Note" },
  { id: "JetBrains Mono", label: "JetBrains Mono" },
  { id: "Share Tech Mono", label: "Share Tech Mono" },
  { id: "system-ui", label: "Sistema" },
];

export const FONT_SCALES: { id: FontScale; label: string }[] = [
  { id: "sm", label: "Chica" },
  { id: "md", label: "Media" },
  { id: "lg", label: "Grande" },
  { id: "xl", label: "Muy grande" },
];

export const MENU_SCALES: { id: MenuScale; label: string }[] = [
  { id: "sm", label: "Compacto" },
  { id: "md", label: "Normal" },
  { id: "lg", label: "Amplio" },
];

export const MCKENNA_THEME_DEFAULT: PanelThemeConfig = {
  mode: "light",
  fontSans: "Nunito",
  accentRgb: "232 92 128",
  radius: "lg",
  skin: "sakura",
  fontScale: "md",
  menuScale: "md",
  colors: {},
  customThemes: [],
  activeCustomId: null,
};

export const ACCENT_PRESETS: { id: string; label: string; rgb: string; hex: string }[] = [
  { id: "mckenna", label: "McKenna", rgb: "12 96 105", hex: "#0c6069" },
  { id: "matrix", label: "Matrix", rgb: "0 255 65", hex: "#00ff41" },
  { id: "ocean", label: "Océano", rgb: "2 72 115", hex: "#024873" },
  { id: "forest", label: "Bosque", rgb: "42 125 78", hex: "#2a7d4e" },
  { id: "sky", label: "Cielo", rgb: "61 138 147", hex: "#3d8a93" },
  { id: "violet", label: "Violeta", rgb: "109 76 154", hex: "#6d4c9a" },
  { id: "sakura", label: "Sakura", rgb: "232 92 128", hex: "#e85c80" },
  { id: "barbie", label: "Barbie", rgb: "255 126 182", hex: "#ff7eb6" },
  { id: "rose", label: "Rosa", rgb: "190 75 99", hex: "#be4b63" },
  { id: "amber", label: "Ámbar", rgb: "180 120 30", hex: "#b4781e" },
  { id: "slate", label: "Pizarra", rgb: "71 85 105", hex: "#475569" },
];

export interface ThemePack {
  id: ThemePackId;
  label: string;
  tagline: string;
  skin: UiSkin;
  fontSans: FontChoice;
  radius: RadiusScale;
  fontScale: FontScale;
  menuScale: MenuScale;
  accentRgb: string;
  mode: ThemeMode;
}

export const THEME_PACKS: ThemePack[] = [
  {
    id: "matrix",
    label: "Matrix",
    tagline: "Lluvia de números, terminal verde.",
    skin: "matrix",
    fontSans: "Share Tech Mono",
    radius: "sm",
    fontScale: "md",
    menuScale: "md",
    accentRgb: "0 255 65",
    mode: "dark",
  },
  {
    id: "sakura",
    label: "Sakura",
    tagline: "Anime shoujo, pasteles cálidos y UI arcade retro.",
    skin: "sakura",
    fontSans: "Nunito",
    radius: "lg",
    fontScale: "md",
    menuScale: "md",
    accentRgb: "232 92 128",
    mode: "light",
  },
  {
    id: "barbie",
    label: "Barbie Agenda",
    tagline: "Planner glam: rosa chicle, stickers y brillos.",
    skin: "barbie",
    fontSans: "Nunito",
    radius: "lg",
    fontScale: "md",
    menuScale: "md",
    accentRgb: "255 126 182",
    mode: "light",
  },
];

export const MAX_CUSTOM_THEMES = 12;

export function matchingThemePack(config: Pick<PanelThemeConfig, "skin" | "activeCustomId">): ThemePackId | null {
  if (config.activeCustomId) return null;
  const hit = THEME_PACKS.find((p) => p.skin === config.skin);
  return hit?.id ?? null;
}

export function isRgbTriple(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length === 3 && parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function sanitizeColors(raw: unknown): ThemeColorMap {
  if (!raw || typeof raw !== "object") return {};
  const out: ThemeColorMap = {};
  for (const key of THEME_COLOR_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && isRgbTriple(v)) {
      out[key] = v.trim().split(/\s+/).map((n) => String(Number(n))).join(" ");
    }
  }
  return out;
}

const FONTS = new Set<FontChoice>(FONT_CHOICES.map((f) => f.id));
const SKINS = new Set<UiSkin>(["clasica", "atelier", "matrix", "sakura", "barbie"]);

/** Variantes visibles: Matrix, Sakura y Barbie Agenda. McKenna/Atelier pasan a Sakura. */
function featuredSkin(raw: unknown): UiSkin {
  if (raw === "matrix") return "matrix";
  if (raw === "barbie" || raw === "cherry") return "barbie";
  if (raw === "sakura" || raw === "clasica" || raw === "atelier") return "sakura";
  return "sakura";
}
const MODES = new Set<ThemeMode>(["light", "dark", "system"]);
const RADII = new Set<RadiusScale>(["sm", "md", "lg"]);
const FONT_SCALES_SET = new Set<FontScale>(["sm", "md", "lg", "xl"]);
const MENU_SCALES_SET = new Set<MenuScale>(["sm", "md", "lg"]);

export function sanitizeCustomTheme(raw: unknown): UserThemePreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^u_[a-z0-9]+$/i.test(r.id) ? r.id : null;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
  if (!id || !name) return null;
  const mode = MODES.has(r.mode as ThemeMode) ? (r.mode as ThemeMode) : "light";
  const fontSansRaw = r.fontSans === "Milky Matcha" ? "A Note" : r.fontSans;
  const fontSans = FONTS.has(fontSansRaw as FontChoice) ? (fontSansRaw as FontChoice) : "Montserrat";
  const accentRgb = typeof r.accentRgb === "string" && isRgbTriple(r.accentRgb) ? r.accentRgb.trim() : "12 96 105";
  const radius = RADII.has(r.radius as RadiusScale) ? (r.radius as RadiusScale) : "md";
  const skin = SKINS.has(r.skin as UiSkin) ? (r.skin as UiSkin) : "sakura";
  const fontScale = FONT_SCALES_SET.has(r.fontScale as FontScale) ? (r.fontScale as FontScale) : "md";
  const menuScale = MENU_SCALES_SET.has(r.menuScale as MenuScale) ? (r.menuScale as MenuScale) : "md";
  return {
    id,
    name,
    mode,
    fontSans,
    accentRgb,
    radius,
    skin,
    fontScale,
    menuScale,
    colors: sanitizeColors(r.colors),
  };
}

export function sanitizePanelTheme(raw: Partial<PanelThemeConfig> | null | undefined): PanelThemeConfig {
  const r = raw ?? {};
  const customThemes = Array.isArray(r.customThemes)
    ? r.customThemes.map(sanitizeCustomTheme).filter((t): t is UserThemePreset => Boolean(t)).slice(0, MAX_CUSTOM_THEMES)
    : [];
  const activeCustomId =
    typeof r.activeCustomId === "string" && customThemes.some((t) => t.id === r.activeCustomId)
      ? r.activeCustomId
      : null;
  const customSkin = activeCustomId ? customThemes.find((t) => t.id === activeCustomId)?.skin : undefined;
  const rawSkin = r.skin;
  const skin = customSkin && SKINS.has(customSkin) ? customSkin : featuredSkin(rawSkin);
  let accentRgb =
    typeof r.accentRgb === "string" && isRgbTriple(r.accentRgb)
      ? r.accentRgb.trim()
      : MCKENNA_THEME_DEFAULT.accentRgb;
  // Legacy clasica/atelier → sakura: el acento teal McKenna dejaba la Agenda desvinculada del menú rosa.
  const LEGACY_TEAL = "12 96 105";
  if (
    !activeCustomId &&
    skin === "sakura" &&
    accentRgb === LEGACY_TEAL &&
    (rawSkin === "clasica" || rawSkin === "atelier" || rawSkin == null)
  ) {
    accentRgb = "232 92 128";
  }
  if (!activeCustomId && skin === "matrix" && accentRgb === LEGACY_TEAL) {
    accentRgb = "0 255 65";
  }
  if (!activeCustomId && skin === "barbie" && (accentRgb === LEGACY_TEAL || accentRgb === "233 30 140")) {
    accentRgb = "255 126 182";
  }
  return {
    mode: MODES.has(r.mode as ThemeMode) ? (r.mode as ThemeMode) : MCKENNA_THEME_DEFAULT.mode,
    fontSans: (() => {
      const rawFont = r.fontSans as string | undefined;
      const raw = rawFont === "Milky Matcha" ? "A Note" : rawFont;
      return FONTS.has(raw as FontChoice) ? (raw as FontChoice) : MCKENNA_THEME_DEFAULT.fontSans;
    })(),
    accentRgb,
    radius: RADII.has(r.radius as RadiusScale) ? (r.radius as RadiusScale) : MCKENNA_THEME_DEFAULT.radius,
    skin,
    fontScale: FONT_SCALES_SET.has(r.fontScale as FontScale)
      ? (r.fontScale as FontScale)
      : r.skin === "atelier" || r.skin === "sakura" || r.skin === "barbie"
        ? "lg"
        : "md",
    menuScale: MENU_SCALES_SET.has(r.menuScale as MenuScale)
      ? (r.menuScale as MenuScale)
      : r.skin === "atelier"
        ? "lg"
        : "md",
    colors: sanitizeColors(r.colors),
    customThemes,
    activeCustomId,
  };
}

export function snapshotAsCustomTheme(name: string, config: PanelThemeConfig): UserThemePreset {
  const id = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name: name.trim().slice(0, 40) || "Mi tema",
    mode: config.mode,
    fontSans: config.fontSans,
    accentRgb: config.accentRgb,
    radius: config.radius,
    skin: config.skin,
    fontScale: config.fontScale,
    menuScale: config.menuScale,
    colors: { ...config.colors },
  };
}
