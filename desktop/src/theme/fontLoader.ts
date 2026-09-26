import type { FontChoice } from "./types";
import aNoteUrl from "../assets/fonts/ANote.ttf";

const GOOGLE_FONTS: Partial<Record<FontChoice, string>> = {
  Inter: "Inter:wght@400;500;600;700;800",
  "DM Sans": "DM+Sans:wght@400;500;600;700",
  Nunito: "Nunito:wght@400;500;600;700;800",
  Outfit: "Outfit:wght@400;500;600;700;800",
  Jost: "Jost:wght@400;500;600;700",
  "JetBrains Mono": "JetBrains+Mono:wght@400;500;600;700",
  "Share Tech Mono": "Share+Tech+Mono",
  // Opcional en Temas → Fuente (la piel pixel NO la impone: el texto va en la letra de siempre).
  // Legible a 11–13 px; con Pixelify Sans la «C» se cerraba en «O» (comparado el 25-sep-2026).
  "DotGothic16": "DotGothic16",
};


/** Fuentes empaquetadas por Vite (URL real en /app/assets/…). */
const LOCAL_FONT_URLS: Partial<Record<FontChoice, string>> = {
  "A Note": aNoteUrl,
};

const loaded = new Set<string>();

function ensureLocalFontCss(font: FontChoice, srcUrl: string): void {
  const id = `mck-font-local-${font.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
@font-face {
  font-family: "${font}";
  src: url("${srcUrl}") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;
  document.head.appendChild(style);
}

export function ensurePanelFont(font: FontChoice): void {
  if (loaded.has(font)) return;

  const localUrl = LOCAL_FONT_URLS[font];
  if (localUrl) {
    loaded.add(font);
    ensureLocalFontCss(font, localUrl);
    return;
  }

  const spec = GOOGLE_FONTS[font];
  if (!spec) return;
  loaded.add(font);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

/** Títulos de Barbie Agenda: cuento de princesas (Cinzel Decorative), sin cursivas. */
export function ensureBarbieTitleFont(): void {
  const id = "mck-font-barbie-titulos";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@500;600;700&display=swap";
  document.head.appendChild(link);
}
