/**
 * Formato 5 mL (66 × 22 mm): etiqueta horizontal de tres paneles para los
 * frascos de Aceites Esenciales. Es la estructura de la etiqueta 30 mL
 * (102 × 38 mm) reducida a un tercio del área: mismos tres paneles con los
 * mismos papeles —técnico · producto · documentación— pero dos filas en vez
 * de tres, porque a 22 mm de alto una tercera fila deja el texto por debajo
 * de los 2,5 pt y ya no se lee impreso.
 *
 * Qué se quitó respecto del 30 mL, y por qué:
 *  - Dos de las seis celdas técnicas (Grado y Apariencia). El grado ya se
 *    imprime en el subtítulo «INSUMO GRADO …» del panel central, y la
 *    apariencia no informa en un aceite esencial (siempre líquido).
 *  - El texto de clasificación SGA y el bloque «Información técnica /
 *    Disponible en». Queda el pictograma GHS, que es lo exigible, y la
 *    dirección web en la franja inferior.
 *  - El hueco lateral del timbre junto al código: aquí el timbre físico (lote
 *    y vencimiento) va debajo de la tabla Pureza/CAS, y el código conserva
 *    todo el ancho del panel.
 *
 * Mismo objeto de datos que las demás etiquetas (`ProductLabelData`): el SKU,
 * la ficha técnica, el logo con su color, el autoguardado y la generación en
 * lote son los mismos.
 */
import type { CSSProperties } from "react";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { EJEMPLO_ETIQUETA, normalizarHex } from "../etiqueta-ficha/productLabelTypes";
import { mezclarHex, sonMedidas } from "../etiqueta-30ml/etiqueta30mlTypes";

export const MEDIDAS_5ML_POR_DEFECTO = { ancho_mm: 66, alto_mm: 22 } as const;

/** ¿El formato elegido usa la etiqueta de tres paneles reducida? Por el
 *  nombre o, si se lo renombró (los formatos se muestran por tamaño), por sus
 *  medidas. Ojo: "5 g" (50 × 42) y "50g" (102 × 32) no coinciden con la
 *  expresión ni con las medidas, así que no se confunden con este. */
export function esFormato5ml(
  tipoNombre?: string | null,
  medidas?: { ancho_mm?: number; alto_mm?: number } | null,
): boolean {
  if (/^5\s*ml$/i.test((tipoNombre || "").trim())) return true;
  return sonMedidas(medidas, MEDIDAS_5ML_POR_DEFECTO);
}

/** Píxeles de diseño por milímetro real. 18 px/mm da 1188 × 396 px a
 *  66 × 22 mm: holgado para rasterizar a 300 DPI (que serían 780 px de ancho)
 *  sin interpolar, y suficiente para maquetar textos de 3 pt sin redondeos
 *  visibles. Es más alto que el del 30 mL (11,8 px/mm), así que los tamaños
 *  de letra de `TAM_5ML` NO son comparables con los de `TAM_30ML`: para
 *  pasarlos a puntos, px ÷ 6,35. */
export const PX_POR_MM = 18;

export const ANCHO_5ML = Math.round(MEDIDAS_5ML_POR_DEFECTO.ancho_mm * PX_POR_MM);

/** Alto de la franja de color sobre el código de barras, en unidades del SVG
 *  del código (ver `FranjaEAN13`): se escala con él. */
export const ALTO_FRANJA_5ML = 17;

/** Medidas de la retícula, en px de diseño. Todas salen de aquí: ningún panel
 *  define alturas propias, así las líneas de los tres coinciden. */
export interface Reticula5ml {
  ancho: number;
  alto: number;
  /** Margen blanco alrededor de los tres paneles (seguridad de troquel). */
  margen: number;
  /** Espacio blanco entre paneles. */
  separacion: number;
  /** Borde exterior de cada panel. */
  borde: number;
  radio: number;
  /** Líneas divisorias internas. */
  linea: number;
  /** Alto útil de un panel (dentro de su borde). */
  interior: number;
  /** Franja inferior de contacto (15 % del panel, como en el 30 mL). */
  franja: number;
  /** Alto de cada una de las 2 filas de los paneles laterales; la fila del
   *  logo del panel central mide lo mismo, así su línea cae a la misma
   *  altura. */
  fila: number;
  /** Bloque de contenido neto del panel central. */
  neto: number;
}

export function reticula5ml(anchoMm?: number, altoMm?: number): Reticula5ml {
  const ratio =
    anchoMm && altoMm && anchoMm > 0 && altoMm > 0
      ? anchoMm / altoMm
      : MEDIDAS_5ML_POR_DEFECTO.ancho_mm / MEDIDAS_5ML_POR_DEFECTO.alto_mm;
  const alto = Math.round(ANCHO_5ML / ratio);
  // 0,67 mm de margen y 0,78 mm entre paneles: proporcionalmente menos que en
  // el 30 mL (0,85 y 1,7 mm). A 22 mm de alto cada décima de milímetro de
  // blanco sale del texto, y el troquel de estos frascos es de rollo.
  const margen = 12;
  const separacion = 14;
  const borde = 3;
  const interior = alto - 2 * margen - 2 * borde;
  const franja = Math.round(interior * 0.15);
  const fila = (interior - franja) / 2;
  const neto = Math.round(interior * 0.26);
  return {
    ancho: ANCHO_5ML,
    alto,
    margen,
    separacion,
    borde,
    radio: 8,
    linea: 2,
    interior,
    franja,
    fila,
    neto,
  };
}

/** Tamaños de letra (px de diseño): máximo y mínimo del ajuste automático.
 *  A 18 px/mm, 1 pt son 6,35 px — el valor de una celda va entonces entre
 *  4,7 y 3,0 pt, y el contenido neto (lo más grande de la etiqueta) a 11 pt.
 *  Por debajo de 3 pt el texto deja de leerse impreso, así que esos mínimos
 *  son el suelo real: si un dato no cabe, hay que acortarlo, no encogerlo. */
export const TAM_5ML = {
  valorCelda: [30, 19],
  tituloCelda: 21,
  nombre: [58, 30],
  tabla: [26, 17],
  tituloTabla: 22,
  neto: [72, 44],
  tituloNeto: 21,
  franja: [24, 15],
  web: [26, 17],
} as const;

export interface Celda5ml {
  campo: AttributeKey;
  titulo: string;
  /** Ícono por defecto: id de la galería de íconos químicos. */
  icono: string;
}

/** Matriz 2 × 2 del panel izquierdo, en orden de lectura. Son cuatro de las
 *  seis celdas del 30 mL: las que un aceite esencial necesita en el frasco.
 *  Orden en la matriz (fila a fila): Origen, Fórmula/Composición,
 *  Conservación, Aroma. */
export const CELDAS_5ML: readonly Celda5ml[] = [
  { campo: "origin", titulo: "Origen", icono: "origen_globo_meridianos" },
  { campo: "composition", titulo: "Fórmula molecular", icono: "composicion_matraz" },
  { campo: "storage", titulo: "Conservación", icono: "conservacion_termometro" },
  { campo: "odor", titulo: "Aroma", icono: "aroma_nariz_percepcion" },
];

/** Ejemplos en gris de las casillas vacías (solo en edición): los mismos de
 *  la ficha de 76 × 66. */
export const EJEMPLO_5ML = EJEMPLO_ETIQUETA;

/** Variables CSS de la etiqueta: retícula en px + acento (el color del logo
 *  elegido) y el tono suave sólido derivado de él. Las claves `--e30-*` que
 *  van al final no son un descuido: las piezas que se comparten con la
 *  etiqueta 30 mL (franja de contacto, casillas, celdas) las leen. */
export function variables5ml(r: Reticula5ml, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--e5-margen": `${r.margen}px`,
    "--e5-separacion": `${r.separacion}px`,
    "--e5-borde": `${r.borde}px`,
    "--e5-radio": `${r.radio}px`,
    "--e5-linea": `${r.linea}px`,
    "--e5-franja": `${r.franja}px`,
    "--e5-fila": `${r.fila}px`,
    "--e5-neto": `${r.neto}px`,
    "--e30-linea": `${r.linea}px`,
    "--e30-franja": `${r.franja}px`,
  } as CSSProperties;
}
