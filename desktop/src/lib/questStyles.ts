/** Clases compartidas con variantes dark (paleta McKenna teal). */

export function questTone(light: string, dark: string, isDark: boolean): string {
  return isDark ? dark : light;
}

/** KPIs del tablero — versión apagada en oscuro */
export const QUEST_STAT_ITEMS = [
  { label: "⚔️ En campaña", key: "en_proceso" as const, color: "#3b82f6", colorDark: "#5a7f9e", borderDark: "rgba(90,127,158,0.32)" },
  { label: "🔔 En revisión", key: "esperando" as const, color: "#f59e0b", colorDark: "#9a7d52", borderDark: "rgba(154,125,82,0.32)" },
  { label: "⏳ Por iniciar", key: "pendientes" as const, color: "#9ca3af", colorDark: "#5c6b70", borderDark: "rgba(92,107,112,0.28)" },
  { label: "✅ Completadas", key: "resueltos" as const, color: "#22c55e", colorDark: "#4d8a62", borderDark: "rgba(77,138,98,0.32)" },
];

export const ESTADO_DOT_COLOR = {
  pendiente:            { light: "#9ca3af", dark: "#5c6b70" },
  en_proceso:           { light: "#3b82f6", dark: "#5a7f9e" },
  esperando_aprobacion: { light: "#f59e0b", dark: "#9a7d52" },
  resuelto:             { light: "#22c55e", dark: "#4d8a62" },
  rechazado:            { light: "#ef4444", dark: "#9a5a5a" },
};

export const PRIORIDAD_DOT: Record<string, { sym: string; cls: string }> = {
  baja:    { sym: "—",  cls: "text-gray-400 dark:text-muted/70" },
  media:   { sym: "▲",  cls: "text-blue-500 dark:text-sky-500/55" },
  alta:    { sym: "▲▲", cls: "text-orange-500 dark:text-orange-400/50" },
  urgente: { sym: "⚡",  cls: "text-red-500 dark:text-red-400/50" },
};

export const ESTADO_STYLES: Record<string, string> = {
  pendiente:
    "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/35 dark:text-yellow-400/90 dark:border-yellow-800/40",
  en_proceso:
    "bg-blue-100 text-blue-800 border-blue-300 dark:bg-sky-950/40 dark:text-sky-400/85 dark:border-sky-900/45",
  esperando_aprobacion:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/35 dark:text-orange-400/85 dark:border-orange-900/40",
  resuelto:
    "bg-green-100 text-green-800 border-green-300 dark:bg-emerald-950/40 dark:text-emerald-400/85 dark:border-emerald-900/45",
  rechazado:
    "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/35 dark:text-red-400/85 dark:border-red-900/40",
};

export const PRIORIDAD_STYLES: Record<string, string> = {
  baja: "bg-gray-100 text-gray-600 dark:bg-black/25 dark:text-muted",
  media: "bg-blue-100 text-blue-700 dark:bg-sky-950/35 dark:text-sky-400/80",
  alta: "bg-orange-100 text-orange-700 dark:bg-orange-950/35 dark:text-orange-400/80",
  urgente: "bg-red-100 text-red-700 dark:bg-red-950/35 dark:text-red-400/80",
};

export const CATEGORIA_FALLBACK: Record<string, { label: string; cls: string }> = {
  rrhh: {
    label: "RR.H.H.",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  },
  logistica: {
    label: "Logística",
    cls: "bg-teal-100 text-teal-800 dark:bg-accent/20 dark:text-accent-sun",
  },
  mantenimiento: {
    label: "Mantenimiento",
    cls: "bg-purple-100 text-purple-800 dark:bg-accent-plum/20 dark:text-accent-plum",
  },
};

export const TIPO_MATERIAL_BADGE: Record<string, { label: string; className: string }> = {
  elaborado: {
    label: "✨ elaborado",
    className:
      "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/30",
  },
  consumibles: {
    label: "📦 consumibles",
    className:
      "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-400/30",
  },
  repuestos: {
    label: "🔩 repuestos",
    className:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-400/30",
  },
  herramientas: {
    label: "🔧 herramientas",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
  },
};

export const ALERT_ERROR =
  "rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/55 dark:text-red-300/90 dark:border dark:border-red-900/50";

export const ALERT_ERROR_SM =
  "rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/55 dark:text-red-300/90";

/** Envuelve títulos/porcentajes de misión con color dinámico (menos saturación en oscuro). */
export const QUEST_MISION_CHROME = "quest-mision-chrome";

/** Botones del menú principal (QuestNavBar, tema, salir). */
export const QUEST_NAV_BTN = "quest-nav-btn";
export function questNavBtn(active = false, extra = ""): string {
  return [QUEST_NAV_BTN, active ? "quest-nav-btn--active" : "", extra].filter(Boolean).join(" ");
}

/** Rotación estable por id (efecto post-it en el tablero). */
export function stickyRotation(id: number): number {
  const angles = [-2.5, 1.8, -1.2, 2.2, -0.8, 1.5, -2, 0.9, 1.1, -1.6, 2.5, -0.5];
  return angles[Math.abs(id) % angles.length];
}

/** Fondo tipo papel con tinte del color de la misión. */
export function stickyPaperBackground(color: string, dark: boolean): string {
  const c = color || "#0c6069";
  if (dark) {
    return `linear-gradient(168deg, ${c}38 0%, rgb(32 40 42) 42%, rgb(24 32 34) 100%)`;
  }
  return `linear-gradient(168deg, ${c}40 0%, #fffef8 42%, #fff9e0 100%)`;
}
