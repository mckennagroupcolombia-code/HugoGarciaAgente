import type { PanelThemeConfig } from "./types";

export const MCKENNA_THEME_DEFAULT: PanelThemeConfig = {
  mode: "light",
  fontSans: "Montserrat",
  accentRgb: "12 96 105",
  radius: "md",
};

/** Presets de color de acento para el selector rápido del sidebar. */
export const ACCENT_PRESETS: { id: string; label: string; rgb: string; hex: string }[] = [
  { id: "mckenna", label: "McKenna", rgb: "12 96 105", hex: "#0c6069" },
  { id: "ocean", label: "Océano", rgb: "2 72 115", hex: "#024873" },
  { id: "forest", label: "Bosque", rgb: "42 125 78", hex: "#2a7d4e" },
  { id: "sky", label: "Cielo", rgb: "61 138 147", hex: "#3d8a93" },
  { id: "violet", label: "Violeta", rgb: "109 76 154", hex: "#6d4c9a" },
  { id: "rose", label: "Rosa", rgb: "190 75 99", hex: "#be4b63" },
  { id: "amber", label: "Ámbar", rgb: "180 120 30", hex: "#b4781e" },
  { id: "slate", label: "Pizarra", rgb: "71 85 105", hex: "#475569" },
];
