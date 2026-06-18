const LETRA = /[a-záéíóúüñ]/i;
const FIN_ORACION = /[.!?]/;

function esLetra(ch: string): boolean {
  return LETRA.test(ch);
}

function mayusEs(ch: string): string {
  return ch.toLocaleUpperCase("es-CO");
}

/** Espacios y puntuación básica (conserva saltos de línea). */
function normalizarEspaciosYPuntuacion(texto: string): string {
  let t = texto.replace(/\r\n/g, "\n");
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/ +([,.;:!?])/g, "$1");
  t = t.replace(/([,;:])([^\s\n\d])/g, "$1 $2");
  t = t.replace(/([.!?])([A-Za-záéíóúüñÁÉÍÓÚÜÑ])/g, "$1 $2");
  t = t.replace(/ +\n/g, "\n");
  t = t.replace(/\n +/g, "\n");
  return t;
}

/** Mayúscula inicial y tras . ! ? o párrafo (doble salto de línea). */
export function capitalizarSegunPuntuacion(texto: string): string {
  if (!texto) return texto;

  let out = "";
  let capitalizar = true;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];

    if (capitalizar && esLetra(ch)) {
      out += mayusEs(ch);
      capitalizar = false;
      continue;
    }

    out += ch;

    if (FIN_ORACION.test(ch)) {
      capitalizar = true;
    } else if (ch === "\n") {
      capitalizar = true;
    } else if (ch !== " " && !FIN_ORACION.test(ch)) {
      capitalizar = false;
    }
  }

  return out;
}

export function autoCorregirTextoContenido(texto: string): string {
  const normalizado = normalizarEspaciosYPuntuacion(texto);
  return capitalizarSegunPuntuacion(normalizado);
}

/** Mapea cursor tras corrección conservando posición relativa cuando es posible. */
export function mapCursorTrasCorreccion(
  antes: string,
  despues: string,
  cursor: number,
): number {
  if (antes === despues) return cursor;
  if (cursor <= 0) return 0;
  if (cursor >= antes.length) return despues.length;

  const prefAntes = antes.slice(0, cursor);
  const prefCorregido = autoCorregirTextoContenido(prefAntes);
  return Math.min(prefCorregido.length, despues.length);
}

export function autoCorregirConSeleccion(
  texto: string,
  selStart: number,
  selEnd: number,
): { texto: string; selStart: number; selEnd: number } {
  const corregido = autoCorregirTextoContenido(texto);
  if (corregido === texto) {
    return { texto, selStart, selEnd };
  }
  const start = mapCursorTrasCorreccion(texto, corregido, selStart);
  const end = selStart === selEnd
    ? start
    : mapCursorTrasCorreccion(texto, corregido, selEnd);
  return { texto: corregido, selStart: start, selEnd: end };
}
