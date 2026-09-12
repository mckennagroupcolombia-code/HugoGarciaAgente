/**
 * Formato 69 × 51 mm ("100 g"): etiqueta de diagramación simple para
 * productos de fácil reconocimiento (Semillas & Frutos Secos). Dos columnas
 * —producto a la izquierda, marca y código de barras a la derecha— y la
 * franja de contacto abajo. Mismo objeto de datos que las demás etiquetas.
 */
import type { CSSProperties } from "react";
import { normalizarHex } from "../etiqueta-ficha/productLabelTypes";
import { mezclarHex, sonMedidas } from "../etiqueta-30ml/etiqueta30mlTypes";

export const MEDIDAS_SIMPLE_POR_DEFECTO = { ancho_mm: 69, alto_mm: 51 } as const;

/** ¿El formato elegido usa la etiqueta simple de dos columnas? Por el nombre
 *  o, si se lo renombró (los formatos se muestran por tamaño), por sus
 *  medidas (69 × 51 mm). */
export function esFormatoSimple(
  tipoNombre?: string | null,
  medidas?: { ancho_mm?: number; alto_mm?: number } | null,
): boolean {
  if (/^100\s*g$/i.test((tipoNombre || "").trim())) return true;
  return sonMedidas(medidas, MEDIDAS_SIMPLE_POR_DEFECTO);
}

/** Ancho de diseño en px: la etiqueta se maqueta a este ancho y se escala. */
export const ANCHO_SIMPLE = 900;

/** Grado del subtítulo cuando la etiqueta no trae uno: son alimentos. */
export const GRADO_SIMPLE_POR_DEFECTO = "ALIMENTARIO";

export interface ReticulaSimple {
  ancho: number;
  alto: number;
  margen: number;
  linea: number;
  /** Franja inferior de contacto (12 % del alto útil: 20 % menos que el 15 %
   *  de la etiqueta 30 mL, a pedido). */
  franja: number;
  /** Fila 1, común a las dos columnas: nombre y recuadro «INSUMO GRADO …» a
   *  la izquierda, logo · información técnica · barra de la web a la derecha.
   *  Su borde inferior es la guía de la que cuelgan las dos barras del acento.
   *  Sin esta fila común cada barra seguía a su propia columna —el nombre una,
   *  el logo la otra— y no coincidían. */
  cabeza: number;
  /** Fila 2: origen y contenido neto · código de barras. */
  medio: number;
  /** Fila 3: conservación y alérgenos · marco del timbre. Su borde superior es
   *  la otra guía: la raya que va bajo el contenido neto cae a la misma altura
   *  que el borde de arriba del timbre. */
  pie: number;
  /** Aire entre las barras del acento y el borde inferior de la cabeza. Es el
   *  mismo en las dos columnas (por eso terminan en la misma línea) y marca
   *  también la separación de las filas de la columna del producto. */
  respiro: number;
  /** Alto del recuadro en blanco para el timbre físico (10 mm reales). */
  timbre: number;
}

/** Alto del recuadro del timbre, en mm. */
export const ALTO_TIMBRE_MM = 10;

/** Proporción áurea. Reparte en φ : 1 el alto que queda libre entre la fila de
 *  la cabeza y la del medio — a la del pie no se le puede aplicar: la fija el
 *  timbre, que son 10 mm reales y no una proporción del diseño. */
const PHI = 1.618033988749895;

/** Aire bajo las barras del acento y separación entre las filas del producto. */
const RESPIRO = 14;

export function reticulaSimple(anchoMm?: number, altoMm?: number): ReticulaSimple {
  const ratio =
    anchoMm && altoMm && anchoMm > 0 && altoMm > 0
      ? anchoMm / altoMm
      : MEDIDAS_SIMPLE_POR_DEFECTO.ancho_mm / MEDIDAS_SIMPLE_POR_DEFECTO.alto_mm;
  const alto = Math.round(ANCHO_SIMPLE / ratio);
  const margen = 10;
  // Sin marco exterior: la etiqueta llega al filo del troquel y solo deja el
  // margen de seguridad. Las líneas del acento son todas interiores.
  const interior = alto - 2 * margen;
  const franja = Math.round(interior * 0.12);
  // px por mm a este ancho de diseño: el recuadro del timbre mide siempre
  // 10 mm reales, no un porcentaje de la etiqueta.
  const pxPorMm = ANCHO_SIMPLE / (anchoMm && anchoMm > 0 ? anchoMm : MEDIDAS_SIMPLE_POR_DEFECTO.ancho_mm);
  const timbre = Math.round(pxPorMm * ALTO_TIMBRE_MM);
  // El pie es lo que mide el timbre más su aire; lo que sobra se corta en
  // sección áurea: cabeza : medio = φ : 1 (y libre : cabeza, otra vez φ).
  const pie = timbre + RESPIRO;
  const libre = interior - franja - pie;
  const cabeza = Math.round((libre * PHI) / (1 + PHI));
  return {
    ancho: ANCHO_SIMPLE,
    alto,
    margen,
    linea: 1.5,
    franja,
    cabeza,
    medio: libre - cabeza,
    pie,
    respiro: RESPIRO,
    timbre,
  };
}

/** Tamaños de letra (máximo, mínimo) del ajuste automático, en px de diseño.
 *  El contenido neto es lo más grande; el nombre le sigue. */
export const TAM_SIMPLE = {
  nombre: [58, 28],
  neto: [76, 44],
  dato: [21, 14],
  subtitulo: [17, 11],
  info: [16, 11],
  franja: [18, 12],
} as const satisfies Record<string, readonly [number, number]>;

export function variablesSimple(r: ReticulaSimple, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--es-margen": `${r.margen}px`,
    "--es-linea": `${r.linea}px`,
    "--es-franja": `${r.franja}px`,
    "--es-cabeza": `${r.cabeza}px`,
    "--es-medio": `${r.medio}px`,
    "--es-pie": `${r.pie}px`,
    "--es-respiro": `${r.respiro}px`,
    "--es-timbre": `${r.timbre}px`,
    // La franja de contacto reutiliza las reglas de la etiqueta 30 mL.
    "--e30-linea": `${r.linea}px`,
  } as CSSProperties;
}
