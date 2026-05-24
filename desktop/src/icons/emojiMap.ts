import type { UiIconName } from "./types";
import { isUiIconName } from "./registry";

/** Emoji / texto guardado en BD → icono Phosphor. Ver https://phosphoricons.com/ */
export const EMOJI_TO_ICON: Record<string, UiIconName> = {
  "🏰": "castle",
  "📍": "mapPin",
  "🏢": "building",
  "↳": "arrowSub",
  "🎯": "target",
  "📖": "book",
  "📋": "listChecks",
  "📚": "books",
  "🔗": "link",
  "⚡": "lightning",
  "📌": "pin",
  "♾️": "infinity",
  "♾": "infinity",
  "🔔": "bell",
  "✅": "check",
  "✓": "check",
  "🔒": "lock",
  "👤": "user",
  "🎭": "users",
  "🏷️": "tag",
  "🏷": "tag",
  "📦": "package",
  "🔩": "nut",
  "🔧": "wrench",
  "🧪": "flask",
  "🤝": "handshake",
  "📜": "scroll",
  "💾": "floppyDisk",
  "🗑": "trash",
  "🗑️": "trash",
  "⏳": "hourglass",
  "⚔️": "sword",
  "⚔": "sword",
  "❌": "xCircle",
  "🚚": "truck",
  "📅": "calendar",
  "📆": "calendarBlank",
  "🗓️": "calendarDots",
  "🗓": "calendarDots",
  "🔄": "refresh",
  "📊": "chartBar",
  "🤖": "robot",
  "🔍": "search",
  "✉️": "envelope",
  "✉": "envelope",
  "🧾": "receipt",
  "👂": "ear",
  "🟢": "circle",
  "🔴": "circle",
  "🟡": "circle",
  "❓": "question",
  "⏰": "clock",
  "❗": "warning",
  "⚠️": "warning",
  "⚠": "warning",
  "✨": "star",
  "✏️": "pencil",
  "✏": "pencil",
};

/** Presets para elegir ícono de categoría / reino (valor guardado = emoji). */
export const TOPIC_ICON_PRESETS: { emoji: string; label: string }[] = [
  { emoji: "🏰", label: "Reino" },
  { emoji: "📋", label: "Lista" },
  { emoji: "🎯", label: "Misión" },
  { emoji: "📖", label: "Receta" },
  { emoji: "📦", label: "Inventario" },
  { emoji: "🔧", label: "Herramienta" },
  { emoji: "🧪", label: "Lab" },
  { emoji: "⚡", label: "Rápido" },
  { emoji: "🔔", label: "Alerta" },
  { emoji: "👤", label: "Persona" },
  { emoji: "🏢", label: "Depto" },
  { emoji: "🏷️", label: "Etiqueta" },
];

export function resolveTopicIcon(value?: string | null, fallback?: UiIconName): UiIconName | null {
  const v = (value ?? "").trim();
  if (!v) return fallback ?? null;
  if (v in EMOJI_TO_ICON) return EMOJI_TO_ICON[v];
  if (isUiIconName(v)) return v;
  const first = [...v][0];
  if (first && EMOJI_TO_ICON[first]) return EMOJI_TO_ICON[first];
  return fallback ?? null;
}
