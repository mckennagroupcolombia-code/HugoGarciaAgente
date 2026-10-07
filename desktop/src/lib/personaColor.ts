/**
 * Color e iniciales estables por persona para los chats (avatar y nombre del autor): la misma
 * persona sale siempre del mismo color, en el grupo, en el aviso y en los ajustes de sonido.
 * Tonos con contraste suficiente para letra blanca (avatar) y para texto sobre fondo claro u
 * oscuro (nombre del autor, `colorTextoPersona`).
 */
const TONOS = [212, 340, 152, 28, 268, 190, 0, 96, 300, 45, 230, 168];

function tono(nombre: string): number {
  let h = 0;
  for (const ch of (nombre || "?").trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONOS[h % TONOS.length];
}

/** Fondo del avatar (letra blanca encima). */
export function colorDePersona(nombre: string): string {
  return `hsl(${tono(nombre)} 58% 42%)`;
}

/** Color del nombre del autor sobre la burbuja: se lee en claro y en oscuro. */
export function colorTextoPersona(nombre: string): string {
  return `hsl(${tono(nombre)} 70% var(--mck-autor-l, 38%))`;
}

export function iniciales(nombre: string | null | undefined): string {
  const partes = (nombre || "?").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}
