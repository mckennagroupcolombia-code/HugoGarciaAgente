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
  s = s.replace(/(\d)(\s*)ML\b/g, "$1$2mL");
  s = s.replace(/(\d)(\s*)G\b/g, "$1$2g");
  return s.slice(0, maxLen);
}
