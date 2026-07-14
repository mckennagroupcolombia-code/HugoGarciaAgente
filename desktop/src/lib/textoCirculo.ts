/**
 * Texto justificado con la figura de un círculo (forma = "circulo").
 * Se busca el círculo MÁS PEQUEÑO en el que quepa todo el párrafo (líneas
 * envueltas al ancho de la cuerda a cada altura), así el bloque de texto
 * dibuja la silueta del círculo: líneas cortas arriba y abajo, anchas en el
 * centro. El diámetro nunca supera el ancho de la caja; si el texto no cabe
 * ni en ese círculo máximo, el resto sigue debajo a ancho completo.
 *
 * MISMA lógica que `_texto_circulo_raster` en app/tools/plantillas_visuales.py:
 * cualquier cambio aquí debe replicarse allá para que el PNG exportado por el
 * servidor coincida con el editor.
 */

export interface LineaCirculo {
  palabras: string[];
  anchos: number[];
  /** Línea unida con espacios (para render no justificado). */
  texto: string;
  /** Centro vertical de la línea, relativo al borde superior de la caja. */
  yCenter: number;
  /** Ancho de la cuerda disponible a esa altura. */
  chord: number;
  /** Borde izquierdo de la cuerda, relativo al borde izquierdo de la caja. */
  xIni: number;
  /** true → repartir palabras hasta llenar la cuerda (flex space-between). */
  justificar: boolean;
}

export interface TextoCirculoLayout {
  lineas: LineaCirculo[];
  altoTotal: number;
  /** Radio del círculo que contiene el texto (centro en x = ancho/2, y = radio). */
  radio: number;
}

/** Margen vertical del glifo respecto al centro de su línea (≈ media altura). */
const MEDIO_GLIFO = 0.38;
/** Holgura radial sobre la primera/última línea (controla su largo mínimo). */
const MARGEN_POLO = 0.35;

export function calcularTextoCirculo(
  contenido: string,
  w: number,
  fontSize: number,
  lineHeight: number,
  align: string,
  medir: (s: string) => number,
  /** Reduce cada cuerda por lado (p. ej. para que el texto no toque un marco). */
  holguraLateral = 0,
): TextoCirculoLayout | null {
  if (w <= 0 || fontSize <= 0) return null;
  const parrafos = (contenido || "")
    .split("\n")
    .map((p) => p.split(" ").filter(Boolean))
    .filter((p) => p.length > 0);
  if (parrafos.length === 0) return null;

  const lhPx = fontSize * lineHeight;
  const pad = fontSize * MEDIO_GLIFO;
  const margen = lhPx * MARGEN_POLO;
  const esp = medir(" ");

  const radioPara = (n: number) => ((n - 1) / 2) * lhPx + pad + margen;
  // Máximo de líneas cuyo círculo aún cabe en el ancho de la caja
  let maxN = 1;
  while (2 * radioPara(maxN + 1) <= w) maxN += 1;

  function intentar(
    n: number,
    R: number,
    desbordar: boolean,
  ): LineaCirculo[] | null {
    const cy = R;
    const lineas: LineaCirculo[] = [];
    let i = 0;
    for (const palabras of parrafos) {
      let idx = 0;
      while (idx < palabras.length) {
        if (i >= n && !desbordar) return null;
        const yCenter = cy + (i - (n - 1) / 2) * lhPx;
        let chord: number;
        if (i >= n) {
          chord = w; // desborde bajo el círculo
        } else {
          const dy = Math.abs(yCenter - cy) + pad;
          const half = Math.sqrt(Math.max(0, R * R - dy * dy));
          chord = Math.min(w, Math.max(2 * half - 2 * holguraLateral, fontSize));
        }
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
        });
        i += 1;
      }
    }
    // Si se usaron menos líneas que n, recentrar el bloque en el círculo
    if (lineas.length < n) {
      const off = ((n - lineas.length) * lhPx) / 2;
      for (const l of lineas) l.yCenter += off;
    }
    return lineas;
  }

  let lineas: LineaCirculo[] | null = null;
  let R = radioPara(1);
  for (let n = 1; n <= maxN && !lineas; n += 1) {
    R = radioPara(n);
    lineas = intentar(n, R, false);
  }
  if (!lineas) {
    // Texto más grande que el círculo máximo: círculo a todo el ancho y el
    // resto continúa debajo en líneas de ancho completo.
    R = w / 2;
    const n = Math.max(1, Math.floor((2 * R) / lhPx));
    lineas = intentar(n, R, true);
  }
  if (!lineas || lineas.length === 0) return null;

  const ultimo = lineas[lineas.length - 1];
  return { lineas, altoTotal: Math.max(2 * R, ultimo.yCenter + lhPx / 2), radio: R };
}
