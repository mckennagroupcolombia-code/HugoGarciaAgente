import type { FontChoice } from "./types";

const GOOGLE_FONTS: Partial<Record<FontChoice, string>> = {
  Inter: "Inter:wght@400;500;600;700;800",
  "DM Sans": "DM+Sans:wght@400;500;600;700",
  Nunito: "Nunito:wght@400;500;600;700;800",
};

const loaded = new Set<string>();

export function ensurePanelFont(font: FontChoice): void {
  const spec = GOOGLE_FONTS[font];
  if (!spec || loaded.has(font)) return;
  loaded.add(font);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}
