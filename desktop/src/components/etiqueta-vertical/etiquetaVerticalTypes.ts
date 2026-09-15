/**
 * Formato 38 × 102 mm vertical ("Vertical 38"): etiqueta alta y estrecha
 * para frascos de Aceites & Grasas. Siete bloques apilados cuyas alturas en
 * milímetros suman exactamente el alto de la etiqueta, así que no hay
 * sobrante ni recorte: la retícula los reparte en píxeles a escala fija.
 * Mismo objeto de datos que las demás etiquetas.
 */
import { sonMedidas } from "../etiqueta-30ml/etiqueta30mlTypes";

export const MEDIDAS_VERTICAL_POR_DEFECTO = { ancho_mm: 38, alto_mm: 102 } as const;

/** ¿El formato elegido usa la etiqueta vertical? Por el nombre o, si se lo
 *  renombró (los formatos se muestran por tamaño), por sus medidas. Ojo: el
 *  formato "30 mL" es 102 × 38 — el mismo tamaño acostado—, y `sonMedidas`
 *  compara ancho con ancho, así que no se confunden. */
export function esFormatoVertical(
  tipoNombre?: string | null,
  medidas?: { ancho_mm?: number; alto_mm?: number } | null,
): boolean {
  if (/^vertical\s*38$/i.test((tipoNombre || "").trim())) return true;
  return sonMedidas(medidas, MEDIDAS_VERTICAL_POR_DEFECTO);
}

/** Píxeles de diseño por milímetro real. 12 px/mm da 456 × 1224 px a 38 ×
 *  102 mm: suficiente para que el texto de 5,5 pt se maquete con holgura y
 *  para rasterizar a 300 DPI sin interpolar de más. */
export const PX_POR_MM = 12;

/** Altura de cada bloque en milímetros. Suman el alto de la etiqueta. */
export const BLOQUES_MM = {
  cabecera: 11,
  filaUno: 16,
  filaDos: 18.5,
  beneficios: 16,
  neto: 9,
  marca: 21.5,
  pie: 10,
} as const;

export type BloqueVertical = keyof typeof BLOQUES_MM;

export const ALTO_BLOQUES_MM = Object.values(BLOQUES_MM).reduce((a, b) => a + b, 0);

export interface ReticulaVertical {
  ancho: number;
  alto: number;
  /** Alto de cada bloque en píxeles de diseño. */
  bloques: Record<BloqueVertical, number>;
  /** Grosor de las divisorias: 0,15 mm reales. */
  linea: number;
  pxPorMm: number;
}

export function reticulaVertical(anchoMm?: number, altoMm?: number): ReticulaVertical {
  const ancho_mm = anchoMm && anchoMm > 0 ? anchoMm : MEDIDAS_VERTICAL_POR_DEFECTO.ancho_mm;
  const alto_mm = altoMm && altoMm > 0 ? altoMm : MEDIDAS_VERTICAL_POR_DEFECTO.alto_mm;
  // Los bloques están definidos para 102 mm; si el formato mide otra cosa se
  // reparten proporcionalmente, de modo que sigan sumando el alto exacto.
  const factor = alto_mm / ALTO_BLOQUES_MM;
  const pxPorMm = PX_POR_MM;
  const alto = Math.round(alto_mm * pxPorMm);

  const claves = Object.keys(BLOQUES_MM) as BloqueVertical[];
  const bloques = {} as Record<BloqueVertical, number>;
  let acumulado = 0;
  claves.forEach((k, i) => {
    if (i === claves.length - 1) {
      // El último absorbe el redondeo: la suma es exactamente `alto`.
      bloques[k] = alto - acumulado;
      return;
    }
    const px = Math.round(BLOQUES_MM[k] * factor * pxPorMm);
    bloques[k] = px;
    acumulado += px;
  });

  return {
    ancho: Math.round(ancho_mm * pxPorMm),
    alto,
    bloques,
    linea: Math.max(1, Math.round(0.15 * pxPorMm)),
    pxPorMm,
  };
}

/** Azul del formato. Es fijo: la etiqueta se imprime siempre así. */
export const AZUL_VERTICAL = "#087CE0";

/** Ícono por defecto de cada casilla, de la galería de íconos químicos (los
 *  mismos que usan los demás formatos, para que se vean de la misma familia).
 *  Los tres de beneficios no existen en la galería y se dibujan aparte. */
export const ICONOS_VERTICAL = {
  appearance: "apariencia_ojo",
  odor: "aroma_ondas_gota",
  composition: "composicion_matraz",
  storage: "calidad_escudo_sello",
} as const;

/** Texto de ejemplo: en edición se ve en gris y no se imprime. */
export const EJEMPLO_VERTICAL = {
  productName: "AGUA DE ROSAS",
  gradoInsumo: "COSMÉTICO",
  appearance: "Líquido de tonalidad rosada",
  odor: "Floral característico",
  composition: "Agua destilada de rosas y conservante.",
  storage: "Lugar fresco, seco y protegido de la luz.",
  beneficio1: "Hidratación leve",
  beneficio2: "Sensación refrescante",
  beneficio3: "Cuidado de la piel",
  netContent: "250 mL",
  city: "Bogotá · Colombia",
  website: "www.mckennagroup.co",
} as const;
