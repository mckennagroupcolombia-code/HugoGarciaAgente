/**
 * Nombre Alegra: MAYÚSCULAS, unidades `mL` y `g` con esa grafía.
 *
 * `trimSpaces`: en el submit/API sí; en el input en vivo NO — si se hace
 * `.trim()` en cada tecla, al dar espacio entre palabras el espacio desaparece
 * y parece que "no genera" el nombre.
 */
export function nombreMayusculasAlegra(
  nombre: string,
  maxLen = 150,
  opts?: { trimSpaces?: boolean },
): string {
  const trimSpaces = opts?.trimSpaces !== false;
  let s = nombre || "";
  if (trimSpaces) s = s.trim();
  s = s.toUpperCase();
  if (!s.trim()) return trimSpaces ? "" : s.slice(0, maxLen);
  // Tras número: 250G → 250g, 30ML → 30mL
  s = s.replace(/(\d)(\s*)ML\b/g, "$1$2mL");
  s = s.replace(/(\d)(\s*)G\b/g, "$1$2g");
  // Unidad suelta (graneles): "... ML" / "... G" → mL / g
  s = s.replace(/(?<![A-Z0-9])ML\b/g, "mL");
  s = s.replace(/(?<![A-Z0-9])G\b/g, "g");
  return s.slice(0, maxLen);
}
