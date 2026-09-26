/**
 * Etiqueta de CÁPSULAS DE GELATINA (66 × 22 mm): dos paneles horizontales,
 * principal (marca, nombre y presentación) a la izquierda y auxiliar (datos,
 * lote, código de barras y pie corporativo) a la derecha, 55 % / 45 %.
 *
 * Usa el mismo formato de 66 × 22 que Aceites Esenciales («5 mL»): el
 * formato solo dice el tamaño. Lo que decide esta diagramación es la
 * categoría de la etiqueta, «Excipientes y cápsulas» (`excipientes`).
 *
 * Misma escala que el 5 mL (18 px/mm, 1188 × 396 px), así que sus tamaños de
 * letra sí son comparables con los de `TAM_5ML`: para pasarlos a puntos,
 * px ÷ 6,35.
 *
 * Mismo objeto de datos que las demás etiquetas (`ProductLabelData`): SKU,
 * ficha técnica, logo con su color, autoguardado y generación en lote.
 */
import type { CSSProperties } from "react";
import { normalizarHex, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import { mezclarHex } from "../etiqueta-30ml/etiqueta30mlTypes";
import { ANCHO_5ML } from "../etiqueta-5ml/etiqueta5mlTypes";

/** Categoría (ver `lib/categoriasEtiqueta`) que usa esta diagramación. */
export const CATEGORIA_CAPSULAS = "excipientes";

/** ¿Va con la etiqueta de cápsulas? Formato de 66 × 22 (`es5ml`) y categoría
 *  «Excipientes y cápsulas». Cualquier otra categoría en ese formato sigue
 *  con los tres paneles de Aceites Esenciales. */
export function esEtiquetaCapsulas(es5ml: boolean, categoria?: string | null): boolean {
  return es5ml && categoria === CATEGORIA_CAPSULAS;
}

/** Medidas de la retícula, en px de diseño. Todas las alturas salen de aquí:
 *  los dos paneles miden lo mismo porque comparten `interior`. */
export interface ReticulaCapsulas {
  ancho: number;
  alto: number;
  margen: number;
  separacion: number;
  borde: number;
  radio: number;
  linea: number;
  interior: number;
  /** Panel principal: cabecera de marca · identificación · presentación. */
  principal: [number, number, number];
  /** Panel auxiliar: composición/color · conservación · lote · código · pie. */
  auxiliar: [number, number, number, number, number];
}

/** Reparte `total` px según `pesos` (%) en enteros que suman exacto. */
function repartir(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  const filas = pesos.map((p) => Math.round((total * p) / suma));
  filas[filas.length - 1] += total - filas.reduce((a, b) => a + b, 0);
  return filas;
}

export function reticulaCapsulas(anchoMm?: number, altoMm?: number): ReticulaCapsulas {
  const ratio = anchoMm && altoMm && anchoMm > 0 && altoMm > 0 ? anchoMm / altoMm : 66 / 22;
  const alto = Math.round(ANCHO_5ML / ratio);
  // Mismo blanco que el 5 mL (0,67 mm de margen, 0,78 mm entre paneles).
  const margen = 12;
  const separacion = 14;
  const borde = 3;
  const interior = alto - 2 * margen - 2 * borde;
  return {
    ancho: ANCHO_5ML,
    alto,
    margen,
    separacion,
    borde,
    radio: 8,
    linea: 2,
    interior,
    principal: repartir(interior, [43, 39, 18]) as ReticulaCapsulas["principal"],
    auxiliar: repartir(interior, [20, 20, 13, 31, 16]) as ReticulaCapsulas["auxiliar"],
  };
}

/** Tamaños de letra (px de diseño): máximo y mínimo del ajuste automático.
 *  18 px/mm → 1 pt = 6,35 px; el suelo real de impresión es ~15 px (2,4 pt). */
export const TAM_CAPSULAS = {
  nombre: [60, 30],
  subtitulo: [26, 16],
  tituloDato: 17,
  valorDato: [30, 18],
  sufijo: 17,
  tituloCasilla: 17,
  valorCasilla: [22, 15],
  conservacion: [19, 14],
  lote: [20, 14],
  pie: [19, 14],
} as const;

/** Datos con los que arranca una etiqueta de cápsulas: se escriben UNA vez,
 *  en las casillas vacías, y desde ahí son datos normales de la etiqueta
 *  (se editan o se borran). Nada de tamaños, cantidades, color ni lote: esos
 *  los pone quien la hace. */
export const DATOS_INICIALES_CAPSULAS = {
  productName: "CÁPSULAS\nDE GELATINA",
  capsulasSubtitulo: "VACÍAS · PARA LLENADO",
  composition: "Gelatina",
  storage: "Mantener el envase bien cerrado, en lugar fresco y seco.",
  website: "www.mckennagroup.co",
  city: "Bogotá · Colombia",
  // El NIT va en `phone`, como en todas las fichas guardadas (ver `IconoContacto`).
  phone: "NIT: 901316016-3",
} as const satisfies Partial<Record<keyof ProductLabelData, string>>;

/** Parche con los datos iniciales que falten; `null` si ya se aplicaron. */
export function parcheInicialCapsulas(data: ProductLabelData): Partial<ProductLabelData> | null {
  if (data.capsulasIniciada) return null;
  const parche: Partial<ProductLabelData> = { capsulasIniciada: true };
  for (const [campo, valor] of Object.entries(DATOS_INICIALES_CAPSULAS)) {
    const actual = data[campo as keyof ProductLabelData];
    if (typeof actual !== "string" || !actual.trim()) {
      (parche as Record<string, string>)[campo] = valor;
    }
  }
  return parche;
}

/** Ejemplos en gris de las casillas vacías (solo en edición, nunca se imprimen). */
export const EJEMPLO_CAPSULAS = {
  productName: "CÁPSULAS DE GELATINA",
  capsulasSubtitulo: "VACÍAS · PARA LLENADO",
  capsulasTamano: "Tamaño",
  netContent: "Cantidad",
  composition: "Gelatina",
  capsulasColor: "Por especificar",
  storage: "Lugar fresco y seco",
  lote: "",
  vencimiento: "",
  website: "www.mckennagroup.co",
  city: "Bogotá · Colombia",
  phone: "NIT: 901316016-3",
} as const;

/** Íconos por defecto (galería de íconos químicos), por casilla. */
export const ICONOS_CAPSULAS = {
  composition: "composicion_atomo_orbitas",
  appearance: "apariencia_capsulas",
  storage: "conservacion_reloj_arena",
} as const;

/** El contenido es un número de unidades: solo dígitos. */
export function soloDigitos(v: string): string {
  return (v || "").replace(/\D/g, "");
}

export function variablesCapsulas(r: ReticulaCapsulas, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--ecap-margen": `${r.margen}px`,
    "--ecap-separacion": `${r.separacion}px`,
    "--ecap-borde": `${r.borde}px`,
    "--ecap-radio": `${r.radio}px`,
    "--ecap-linea": `${r.linea}px`,
    "--ecap-filas-principal": r.principal.map((f) => `${f}px`).join(" "),
    "--ecap-filas-auxiliar": r.auxiliar.map((f) => `${f}px`).join(" "),
    // Las piezas compartidas con el 30 mL (casillas, líneas) leen estas.
    "--e30-linea": `${r.linea}px`,
  } as CSSProperties;
}
