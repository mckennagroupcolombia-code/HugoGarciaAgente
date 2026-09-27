/**
 * Etiqueta de ADITIVOS ALIMENTARIOS en el formato de 69 × 51 mm: dos paneles
 * (producto 60 % · marca e información técnica 40 %) y la franja de contacto
 * a todo el ancho. Es la ficha técnica de 76 × 66 reorganizada en horizontal:
 * nombre, banda «MATERIA PRIMA GRADO …», matriz de 2 × 3 y contenido neto a la
 * izquierda; logo, clasificación, información técnica, Pureza/CAS, cuchara y
 * código de barras a la derecha.
 *
 * Usa el mismo formato que la etiqueta simple de Semillas («100 g»): el
 * formato solo dice el tamaño. Lo que decide esta diagramación es la categoría
 * de la etiqueta, «Aditivos alimentarios» (`aditivos`), como las cápsulas en
 * el 66 × 22. Misma escala que la simple (900 px de ancho, 13 px/mm).
 */
import type { CSSProperties } from "react";
import { normalizarHex } from "../etiqueta-ficha/productLabelTypes";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { mezclarHex } from "../etiqueta-30ml/etiqueta30mlTypes";
import { ANCHO_SIMPLE, MEDIDAS_SIMPLE_POR_DEFECTO } from "../etiqueta-simple/etiquetaSimpleTypes";

/** Categoría (ver `lib/categoriasEtiqueta`) que usa esta diagramación. */
export const CATEGORIA_ADITIVOS = "aditivos";

/** Categorías que comparten esta diagramación en 69 × 51. */
export const CATEGORIAS_CON_ETIQUETA_ADITIVOS: readonly string[] = [CATEGORIA_ADITIVOS, "aminoacidos-proteinas", "arcillas"];

/** ¿Va con la etiqueta de aditivos? Formato de 69 × 51 (`esSimple`) y
 *  categoría «Aditivos alimentarios» , «Aminoácidos y proteínas» o «Arcillas y minerales». Cualquier otra categoría en ese formato
 *  sigue con la etiqueta simple de dos columnas. */
export function esEtiquetaAditivos(esSimple: boolean, categoria?: string | null): boolean {
  return esSimple && !!categoria && CATEGORIAS_CON_ETIQUETA_ADITIVOS.includes(categoria);
}

/** Medidas de la retícula, en px de diseño. */
export interface ReticulaAditivos {
  ancho: number;
  alto: number;
  margen: number;
  linea: number;
  /** Franja de contacto, a todo el ancho. */
  franja: number;
  /** Panel del producto: nombre + banda · matriz 2 × 3 · contenido neto. */
  cabeza: number;
  neto: number;
  /** Panel de la marca: logo + lema · clasificación (el resto se reparte). */
  logo: number;
  clasificacion: number;
}

export function reticulaAditivos(anchoMm?: number, altoMm?: number): ReticulaAditivos {
  const ratio =
    anchoMm && altoMm && anchoMm > 0 && altoMm > 0
      ? anchoMm / altoMm
      : MEDIDAS_SIMPLE_POR_DEFECTO.ancho_mm / MEDIDAS_SIMPLE_POR_DEFECTO.alto_mm;
  const alto = Math.round(ANCHO_SIMPLE / ratio);
  const margen = 10;
  const interior = alto - 2 * margen;
  const franja = Math.round(interior * 0.11);
  const cuerpo = interior - franja;
  return {
    ancho: ANCHO_SIMPLE,
    alto,
    margen,
    linea: 1.5,
    franja,
    cabeza: Math.round(cuerpo * 0.3),
    neto: Math.round(cuerpo * 0.17),
    logo: Math.round(cuerpo * 0.2),
    clasificacion: Math.round(cuerpo * 0.15),
  };
}

/** Alto de las barras del acento (banda del grado y barra de la web). */
export const ALTO_BARRA_ADITIVOS = 34;

/** Tamaños de letra (máximo, mínimo) del ajuste automático, en px de diseño
 *  (13 px/mm, los mismos de la etiqueta simple). */
export const TAM_ADITIVOS = {
  nombre: [56, 26],
  banda: [21, 12],
  tituloCelda: 14,
  valorCelda: [18, 11],
  netoTitulo: 17,
  neto: [30, 20],
  info: [16, 11],
  tabla: [16, 11],
  cuchara: [14, 10],
  cucharaCantidad: [22, 14],
  franja: [18, 12],
} as const;

/** Banda bajo el nombre cuando la etiqueta no trae clasificación propia. */
export const BANDA_ADITIVOS_POR_DEFECTO = "MATERIA PRIMA GRADO ALIMENTOS";

/** Matriz de 2 × 3, fila a fila: ORIGEN | APARIENCIA · AROMA | FÓRMULA
 *  MOLECULAR · GRADO | CONSERVACIÓN. Íconos por defecto = los de la ficha. */
export const CELDAS_ADITIVOS: readonly { campo: AttributeKey; titulo: string; icono: string; ejemplo: string }[] = [
  { campo: "origin", titulo: "Origen", icono: "origen_globo_meridianos", ejemplo: "China" },
  { campo: "appearance", titulo: "Apariencia", icono: "apariencia_ojo", ejemplo: "Polvo fino granulado blanco" },
  { campo: "odor", titulo: "Aroma", icono: "aroma_ondas_gota", ejemplo: "Muy dulce" },
  { campo: "composition", titulo: "Fórmula molecular", icono: "composicion_molecula_enlazada", ejemplo: "C₆H₁₂O₆" },
  { campo: "grade", titulo: "Grado", icono: "calidad_escudo_sello", ejemplo: "Alimentos" },
  { campo: "storage", titulo: "Conservación", icono: "conservacion_envase_sellado", ejemplo: "Conservar en empaque bien cerrado, en lugar fresco y seco." },
];

export function variablesAditivos(r: ReticulaAditivos, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--es-margen": `${r.margen}px`,
    "--ead-linea": `${r.linea}px`,
    "--ead-franja": `${r.franja}px`,
    "--ead-cabeza": `${r.cabeza}px`,
    "--ead-neto": `${r.neto}px`,
    "--ead-logo": `${r.logo}px`,
    "--ead-clasif": `${r.clasificacion}px`,
    "--ead-barra": `${ALTO_BARRA_ADITIVOS}px`,
    // Las piezas compartidas con el 30 mL (celdas, franja) leen esta.
    "--e30-linea": `${r.linea}px`,
  } as CSSProperties;
}
