/**
 * Texto justificado dentro de un círculo cuyo diámetro = ancho de la caja.
 * El tamaño del círculo lo controla el usuario (width / asa / control Diámetro),
 * NO el tamaño de fuente: la fuente solo afecta cuánto texto cabe en cada cuerda.
 *
 * `porcion`:
 *   - "completo" → usa todo el círculo (diámetro = ancho).
 *   - "superior" / "inferior" → solo esa media luna.
 *   - "banda" → franja central (deja polos libres).
 *
 * MISMA lógica que `_texto_circulo_raster` en app/tools/plantillas_visuales.py.
 */

export type CirculoPorcion = "completo" | "superior" | "inferior" | "banda";

export interface LineaCirculo {
  palabras: string[];
  anchos: number[];
  texto: string;
  yCenter: number;
  chord: number;
  xIni: number;
  justificar: boolean;
  /** Índice de ritmo vertical (incluye huecos de párrafo). */
  slotIndex: number;
}

export interface TextoCirculoLayout {
  lineas: LineaCirculo[];
  altoTotal: number;
  /** Radio = ancho/2 (diámetro fijado por la caja). */
  radio: number;
  porcion: CirculoPorcion;
  /** Paso vertical en px (entero) — todas las líneas usan el mismo. */
  lhPx: number;
}

const MEDIO_GLIFO = 0.38;
const MARGEN_POLO = 0.35;
const BANDA_FRAC = 0.58;

/** Interlineado por defecto del studio (párrafos legibles). */
export const LINE_HEIGHT_DEFECTO = 1.25;

/** Paso vertical en píxeles enteros → ritmo uniforme (sin subpíxeles raros). */
export function pasoInterlineadoPx(fontSize: number, lineHeight: number): number {
  const lh = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : LINE_HEIGHT_DEFECTO;
  return Math.max(1, Math.round(fontSize * lh));
}

export function calcularTextoCirculo(
  contenido: string,
  w: number,
  fontSize: number,
  lineHeight: number,
  align: string,
  medir: (s: string) => number,
  holguraLateral = 0,
  porcion: CirculoPorcion = "completo",
): TextoCirculoLayout | null {
  if (w <= 0 || fontSize <= 0) return null;
  const rawLines = (contenido || "").replace(/\r\n/g, "\n").split("\n");
  const tieneTexto = rawLines.some((p) => p.split(" ").filter(Boolean).length > 0);
  if (!tieneTexto) return null;

  const lhPx = pasoInterlineadoPx(fontSize, lineHeight);
  const pad = fontSize * MEDIO_GLIFO;
  const margen = lhPx * MARGEN_POLO;
  const esp = medir(" ");
  const R = w / 2;
  const cy = R;

  let yMin: number;
  let yMax: number;
  if (porcion === "superior") {
    yMin = margen + pad;
    yMax = cy;
  } else if (porcion === "inferior") {
    yMin = cy;
    yMax = 2 * R - margen - pad;
  } else if (porcion === "banda") {
    const half = R * BANDA_FRAC;
    yMin = cy - half;
    yMax = cy + half;
  } else {
    yMin = margen + pad;
    yMax = 2 * R - margen - pad;
  }
  if (yMax - yMin < lhPx) return null;

  const slots: number[] = [];
  let y = yMin + lhPx / 2;
  while (y <= yMax - lhPx / 2 + 0.01) {
    slots.push(y);
    y += lhPx;
  }
  if (slots.length === 0) return null;

  const chordAt = (yCenter: number) => {
    const dy = Math.abs(yCenter - cy) + pad;
    const half = Math.sqrt(Math.max(0, R * R - dy * dy));
    return Math.min(w, Math.max(2 * half - 2 * holguraLateral, fontSize));
  };

  const yDeSlot = (slotIndex: number) =>
    slotIndex < slots.length
      ? slots[slotIndex]
      : yMax + (slotIndex - slots.length + 1) * lhPx;

  const lineas: LineaCirculo[] = [];
  let slot = 0;
  let huecoPendiente = false;

  for (const raw of rawLines) {
    const palabras = raw.split(" ").filter(Boolean);
    if (palabras.length === 0) {
      // Línea vacía → como máximo un hueco de párrafo (evita \n\n\n gigantes
      // y también el colapso total que dejaba el ritmo irregular).
      if (lineas.length > 0) huecoPendiente = true;
      continue;
    }
    if (huecoPendiente) {
      slot += 1;
      huecoPendiente = false;
    }

    let idx = 0;
    while (idx < palabras.length) {
      const yCenter = yDeSlot(slot);
      const chord = slot < slots.length ? chordAt(yCenter) : w;
      const grupo = [palabras[idx]];
      const anchos = [medir(palabras[idx])];
      let total = anchos[0];
      idx += 1;
      while (idx < palabras.length) {
        const a2 = medir(palabras[idx]);
        if (total + esp + a2 > chord) break;
        grupo.push(palabras[idx]);
        anchos.push(a2);
        total += esp + a2;
        idx += 1;
      }
      const ultimaDeParrafo = idx >= palabras.length;
      lineas.push({
        palabras: grupo,
        anchos,
        texto: grupo.join(" "),
        yCenter,
        chord,
        xIni: (w - chord) / 2,
        justificar: align === "justify" && !ultimaDeParrafo && grupo.length > 1,
        slotIndex: slot,
      });
      slot += 1;
    }
  }
  if (lineas.length === 0) return null;

  // Alinear arriba preservando huecos (slotIndex), no recompactar a 0..n-1.
  const ultimoSlot = lineas[lineas.length - 1].slotIndex;
  if (ultimoSlot < slots.length) {
    const base = lineas[0].slotIndex;
    const y0 = slots[0];
    for (const ln of lineas) {
      ln.yCenter = y0 + (ln.slotIndex - base) * lhPx;
      ln.chord = chordAt(ln.yCenter);
      ln.xIni = (w - ln.chord) / 2;
    }
  }

  const ultimo = lineas[lineas.length - 1];
  return {
    lineas,
    altoTotal: Math.max(2 * R, ultimo.yCenter + lhPx / 2),
    radio: R,
    porcion,
    lhPx,
  };
}
