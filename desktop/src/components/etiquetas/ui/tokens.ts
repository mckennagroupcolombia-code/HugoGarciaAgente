/**
 * Tokens semánticos compartidos del módulo Etiquetas.
 * Construidos sobre los colores de tailwind.config.ts (surface/ink/border/accent/success/danger/warning).
 * Sigue el patrón ya usado en LoginGate.tsx, PlacasConcretoPanel.tsx y MeliComplianceTab.tsx
 * (border-danger/30 bg-danger/5 text-danger) — no inventa colores nuevos.
 */

export type Tone = "neutral" | "accent" | "success" | "danger" | "warning" | "plum";

export const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-border",
  accent: "border-accent/30",
  success: "border-success/30",
  danger: "border-danger/30",
  warning: "border-warning/30",
  plum: "border-accent-plum/30",
};

export const TONE_BG_SOFT: Record<Tone, string> = {
  neutral: "bg-surface",
  accent: "bg-accent/10",
  success: "bg-success/10",
  danger: "bg-danger/10",
  warning: "bg-warning/10",
  plum: "bg-accent-plum/10",
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-secondary",
  accent: "text-accent",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  plum: "text-accent-plum",
};

export const TONE_SOLID_BG: Record<Tone, string> = {
  neutral: "bg-ink text-surface hover:opacity-90",
  accent: "bg-accent text-white hover:bg-accent-hover",
  success: "bg-success text-white hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  warning: "bg-warning text-white hover:opacity-90",
  plum: "bg-accent-plum text-white hover:opacity-90",
};
