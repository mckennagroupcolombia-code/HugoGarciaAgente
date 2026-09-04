/**
 * Contrato del formateo de nombre Alegra (espejo de desktop/src/lib/alegraNombreProducto.ts).
 * Evita que vuelva el bug: trim en cada tecla → no se pueden escribir espacios.
 */
function nombreMayusculasAlegra(nombre, maxLen = 150, opts) {
  const trimSpaces = opts?.trimSpaces !== false;
  let s = nombre || "";
  if (trimSpaces) s = s.trim();
  s = s.toUpperCase();
  if (!s.trim()) return trimSpaces ? "" : s.slice(0, maxLen);
  s = s.replace(/(\d)(\s*)ML\b/g, "$1$2mL");
  s = s.replace(/(\d)(\s*)G\b/g, "$1$2g");
  return s.slice(0, maxLen);
}

const live = nombreMayusculasAlegra("urea ", 100, { trimSpaces: false });
const live2 = nombreMayusculasAlegra("UREA COSMETICA ", 100, { trimSpaces: false });
const final = nombreMayusculasAlegra("  urea 250 g  ");

if (live !== "UREA ") throw new Error(`live space lost: ${JSON.stringify(live)}`);
if (live2 !== "UREA COSMETICA ") throw new Error(`live multi-word space lost: ${JSON.stringify(live2)}`);
if (final !== "UREA 250 g") throw new Error(`submit normalize failed: ${JSON.stringify(final)}`);

console.log("qa-alegra-nombre: ok");
