/** Nombre Alegra: MAYÚSCULAS, unidades `mL` y `g` con esa grafía. */
export function nombreMayusculasAlegra(nombre: string, maxLen = 150): string {
  let s = (nombre || "").trim().toUpperCase();
  if (!s) return "";
  s = s.replace(/(\d)(\s*)ML\b/g, "$1$2mL");
  s = s.replace(/(\d)(\s*)G\b/g, "$1$2g");
  return s.slice(0, maxLen);
}
