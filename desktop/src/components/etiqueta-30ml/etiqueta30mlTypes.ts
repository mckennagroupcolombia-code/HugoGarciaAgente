/**
 * Formato 30 mL (102 × 38 mm): etiqueta horizontal de tres paneles.
 *
 * Usa el mismo objeto de datos que la ficha de 76 × 66 (`ProductLabelData`):
 * el SKU, la ficha técnica, el logo con su color, el autoguardado y la
 * generación en lote son los mismos. Solo cambia la composición, que aquí se
 * arma con una retícula calculada a partir de las medidas del formato.
 */
import type { CSSProperties } from "react";
import { ghsSvgADataUrl, marcoGhsSvg } from "../GHSIconsPicker";
import { codigosGhs, svgPictogramaGhs } from "../../lib/ghsIconos";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { EJEMPLO_ETIQUETA, normalizarHex, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";

export const NOMBRE_FORMATO_30ML = "30 mL";
export const MEDIDAS_30ML_POR_DEFECTO = { ancho_mm: 102, alto_mm: 38 } as const;

/** ¿El formato elegido usa la etiqueta de tres paneles? Por el nombre o, si
 *  se lo renombró (los formatos se muestran por tamaño), por sus medidas. */
export function esFormato30ml(
  tipoNombre?: string | null,
  medidas?: { ancho_mm?: number; alto_mm?: number } | null,
): boolean {
  if (/^30\s*ml$/i.test((tipoNombre || "").trim())) return true;
  return sonMedidas(medidas, MEDIDAS_30ML_POR_DEFECTO);
}

/** Mismas medidas (mm) que el formato, con medio milímetro de tolerancia. */
export function sonMedidas(
  medidas: { ancho_mm?: number; alto_mm?: number } | null | undefined,
  esperadas: { ancho_mm: number; alto_mm: number },
): boolean {
  if (!medidas?.ancho_mm || !medidas?.alto_mm) return false;
  return (
    Math.abs(medidas.ancho_mm - esperadas.ancho_mm) < 0.5
    && Math.abs(medidas.alto_mm - esperadas.alto_mm) < 0.5
  );
}

/** Ancho de diseño en px. La etiqueta se maqueta siempre a este ancho y se
 *  escala entera (vista previa, PNG, impresión): el contenido nunca reflua. */
export const ANCHO_30ML = 1200;

/** Alto de la franja de color sobre el código de barras, en unidades del
 *  SVG del código (ver `FranjaEAN13`): se escala con él, así que no hay
 *  que tocarlo si cambia el tamaño de la etiqueta. */
export const ALTO_FRANJA_30ML = 17;

/** Medidas de la retícula, en px de diseño. Todas salen de aquí: ningún
 *  panel define alturas propias, así las líneas de los tres coinciden. */
export interface Reticula30ml {
  ancho: number;
  alto: number;
  /** Margen blanco alrededor de los tres paneles. */
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
  /** Franja inferior de contacto (15 % del panel). */
  franja: number;
  /** Alto de cada una de las 3 filas de los paneles laterales; la fila del
   *  logo del panel central mide lo mismo, así su línea cae a la misma altura. */
  fila: number;
  /** Bloque de contenido neto del panel central. */
  neto: number;
}

export function reticula30ml(anchoMm?: number, altoMm?: number): Reticula30ml {
  const ratio =
    anchoMm && altoMm && anchoMm > 0 && altoMm > 0
      ? anchoMm / altoMm
      : MEDIDAS_30ML_POR_DEFECTO.ancho_mm / MEDIDAS_30ML_POR_DEFECTO.alto_mm;
  const alto = Math.round(ANCHO_30ML / ratio);
  const margen = 10;
  const separacion = 20;
  const borde = 2;
  const interior = alto - 2 * margen - 2 * borde;
  const franja = Math.round(interior * 0.15);
  const fila = (interior - franja) / 3;
  // Banda del valor (= franja) más una pista corta para el título: el resto
  // del alto lo usa el espacio del timbre, debajo de la tabla de pureza.
  const neto = franja + 26;
  return {
    ancho: ANCHO_30ML,
    alto,
    margen,
    separacion,
    borde,
    // 10 px: la mitad del radio inicial (20), que se veía muy pronunciado.
    radio: 10,
    linea: 1.5,
    interior,
    franja,
    fila,
    neto,
  };
}

/** Tamaños de letra (px de diseño): máximo y mínimo del ajuste automático.
 *  El contenido neto es el elemento más grande de toda la etiqueta: su
 *  mínimo queda por encima del máximo del nombre del producto. */
export const TAM_30ML = {
  valorCelda: [14, 9],
  nombre: [34, 16],
  tabla: [14, 10],
  // Cabe centrado en la banda del alto de las franjas (alineado con el pie).
  neto: [50, 36],
  clasificacion: [13, 9],
  ghs: [14, 9],
  franja: [13, 9],
  web: [14, 10],
} as const satisfies Record<string, readonly [number, number]>;

export interface Celda30ml {
  campo: AttributeKey;
  titulo: string;
  /** Ícono por defecto: id de la galería de íconos químicos. */
  icono: string;
}

/** Matriz 2 × 3 del panel izquierdo, en orden de lectura. */
export const CELDAS_30ML: readonly Celda30ml[] = [
  { campo: "composition", titulo: "Fórmula molecular", icono: "composicion_matraz" },
  { campo: "grade", titulo: "Grado", icono: "calidad_medalla_lineal" },
  { campo: "storage", titulo: "Conservación", icono: "conservacion_termometro" },
  { campo: "origin", titulo: "Origen", icono: "origen_globo_meridianos" },
  { campo: "appearance", titulo: "Apariencia", icono: "apariencia_escamas" },
  { campo: "odor", titulo: "Aroma", icono: "aroma_nariz_percepcion" },
];

/** Casillas en el orden que pide la plantilla (`ordenCeldas`). Solo vale una
 *  lista con las seis claves, cada una una vez: un orden a medias dejaría una
 *  casilla sin dibujar y el dato de un producto sin imprimir. */
export function celdas30ml(data: ProductLabelData): readonly Celda30ml[] {
  const claves = (data.ordenCeldas || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (claves.length !== CELDAS_30ML.length || new Set(claves).size !== claves.length) return CELDAS_30ML;
  const ordenadas = claves.map((k) => CELDAS_30ML.find((c) => c.campo === k));
  return ordenadas.every(Boolean) ? (ordenadas as Celda30ml[]) : CELDAS_30ML;
}

/** Títulos elegibles de la primera celda (menú del título). Se guarda en
 *  `compositionTitulo`, el mismo dato de la ficha de 76 × 66 — las mismas
 *  dos opciones, en el orden propio de este formato. Si trae un título
 *  antiguo que ya no está en la lista, se ve el primero. */
export const TITULOS_FORMULA_30ML = ["Fórmula molecular", "Composición"] as const;

export function tituloFormula30ml(data: ProductLabelData): string {
  const t = data.compositionTitulo || "";
  return (TITULOS_FORMULA_30ML as readonly string[]).includes(t) ? t : TITULOS_FORMULA_30ML[0];
}

export const GRADOS_INSUMO = ["COSMÉTICO", "ALIMENTARIO", "AGRO", "INDUSTRIAL"] as const;
export const GRADO_INSUMO_POR_DEFECTO = GRADOS_INSUMO[0];
export const PREFIJO_SUBTITULO = "INSUMO GRADO";

export const CLASIFICACION_NO_PELIGROSO = "No está clasificado como peligroso según el SGA.";

/** ¿El dato GHS trae un pictograma de peligro (GHS01…GHS09)? */
export function esPeligrosoGhs(ghs: string | undefined): boolean {
  return codigosGhs(ghs).length > 0;
}

/** Máximo de pictogramas que caben en la columna de clasificación. */
export const MAX_PICTOGRAMAS_30ML = 3;

/** Pictogramas a mostrar para un producto peligroso, uno por código del dato
 *  `ghs` ("GHS07" o "GHS07, GHS09"): el oficial de cada código (rombo con su
 *  símbolo, `lib/ghsIconos`), no un rombo vacío con el número. Si hay un solo
 *  código y se eligió un pictograma en la galería, manda ese. */
export function pictogramasGhs(data: ProductLabelData): string[] {
  const codigos = codigosGhs(data.ghs).slice(0, MAX_PICTOGRAMAS_30ML);
  if (data.ghsIconSvg && codigos.length <= 1) return [data.ghsIconSvg];
  return codigos.map((c) => {
    const svg = svgPictogramaGhs(c);
    return ghsSvgADataUrl(svg ?? marcoGhsSvg(c.replace(/\D/g, "").padStart(3, "0"), false));
  });
}

/** Títulos elegibles del bloque de clasificación. Los dos últimos solo tienen
 *  sentido en un producto SIN pictograma GHS: ahí el círculo «¡NO GHS» ya dice
 *  que no es peligroso y el texto puede aprovecharse para el uso. */
export const TITULOS_CLASIFICACION_30ML = ["Clasificación", "Modo de uso", "Sugerencia"] as const;

/** Título que se dibuja. Un producto peligroso lleva siempre «Clasificación».
 *  En vista —lo que se imprime— un título de uso sin texto propio vuelve a
 *  «Clasificación»: debajo saldría la frase del SGA, que no es un modo de uso. */
export function tituloClasificacion30ml(data: ProductLabelData, editMode: boolean): string {
  const [porDefecto] = TITULOS_CLASIFICACION_30ML;
  if (esPeligrosoGhs(data.ghs)) return porDefecto;
  const t = data.clasificacionTitulo || "";
  if (!(TITULOS_CLASIFICACION_30ML as readonly string[]).includes(t)) return porDefecto;
  if (!editMode && !textoPropioClasificacion(data).trim()) return porDefecto;
  return t;
}

/** Dato que muestra y edita el bloque: bajo «Modo de uso» es `modoUso`, que
 *  llega de la ficha técnica; si no, el texto de clasificación. */
export function campoClasificacion30ml(data: ProductLabelData): "modoUso" | "clasificacionTexto" {
  return !esPeligrosoGhs(data.ghs) && data.clasificacionTitulo === "Modo de uso" ? "modoUso" : "clasificacionTexto";
}

/** Lo escrito para el bloque. Bajo «Modo de uso», lo que se hubiera escrito
 *  antes en la clasificación sigue valiendo mientras la ficha no traiga uno. */
export function textoPropioClasificacion(data: ProductLabelData): string {
  if (campoClasificacion30ml(data) === "modoUso") return data.modoUso || data.clasificacionTexto || "";
  return data.clasificacionTexto || "";
}

/** Texto de clasificación de la etiqueta. Sin texto propio, un producto no
 *  peligroso lleva la frase del SGA; uno peligroso NO recibe esa frase por
 *  defecto (sería falsa): queda en blanco hasta que se escriba. */
export function textoClasificacion(data: ProductLabelData): string {
  const propio = textoPropioClasificacion(data).trim();
  if (propio) return propio;
  return esPeligrosoGhs(data.ghs) ? "" : CLASIFICACION_NO_PELIGROSO;
}

/** Texto dentro del círculo de un producto no peligroso: «¡NO GHS». */
export function textoCirculoGhs(ghs: string | undefined): string {
  const t = (ghs || "").trim() || "NO GHS";
  return /^[¡!]/.test(t) ? t : `¡${t}`;
}

// ── Contenido neto: cantidad + unidad ──────────────────────────────────────

export const UNIDADES_NETO = ["g", "kg", "mL", "L", "mg", "oz", "un"] as const;

const MAPA_UNIDADES: Record<string, string> = {
  g: "g", gr: "g", grs: "g", gramos: "g",
  kg: "kg", kilo: "kg", kilos: "kg",
  mg: "mg",
  ml: "mL",
  l: "L", lt: "L", lts: "L", litro: "L", litros: "L",
  oz: "oz",
  un: "un", und: "un", unidades: "un",
};

/** "500g" → {500, g}; "1 Kg" → {1, kg}; "30mL" → {30, mL}. */
export function partirContenidoNeto(neto: string | undefined): { cantidad: string; unidad: string } {
  const m = /^\s*([\d]+(?:[.,]\d+)?)\s*([a-zA-Z]*)\s*$/.exec(neto || "");
  if (!m) return { cantidad: (neto || "").trim(), unidad: "" };
  return { cantidad: m[1], unidad: MAPA_UNIDADES[m[2].toLowerCase()] ?? m[2] };
}

export function unirContenidoNeto(cantidad: string, unidad: string): string {
  const c = cantidad.trim();
  if (!c) return "";
  return unidad ? `${c} ${unidad}` : c;
}

/** Contenido neto tal como se imprime: siempre con espacio ("500 g"). */
export function textoContenidoNeto(neto: string | undefined): string {
  const { cantidad, unidad } = partirContenidoNeto(neto);
  return unirContenidoNeto(cantidad, unidad) || (neto || "").trim();
}

// ── Ejemplo de referencia ──────────────────────────────────────────────────

/** Ejemplos en gris de las casillas vacías (solo en edición): los mismos de
 *  la ficha de 76 × 66 (`EJEMPLO_ETIQUETA`) más el texto de clasificación. */
export const EJEMPLO_30ML = {
  ...EJEMPLO_ETIQUETA,
  clasificacionTexto: CLASIFICACION_NO_PELIGROSO,
} as const;

// ── Color ───────────────────────────────────────────────────────────────────

/** Mezcla `hex` con `con` en la proporción `t` (0 = hex, 1 = con). */
export function mezclarHex(hex: string, con: string, t: number): string {
  const a = normalizarHex(hex).slice(1);
  const b = normalizarHex(con).slice(1);
  const canal = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(0)}${canal(2)}${canal(4)}`.toUpperCase();
}

/** Variables CSS de la etiqueta: retícula en px + acento (el color del logo
 *  elegido) y el lila suave sólido derivado de él. */
export function variables30ml(r: Reticula30ml, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    // Rellenos de un solo color: el acento (franjas, barra web). El lila
    // suave solo marca en edición el foco de las casillas; la tabla
    // Pureza/CAS va sin relleno.
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--e30-margen": `${r.margen}px`,
    "--e30-separacion": `${r.separacion}px`,
    "--e30-borde": `${r.borde}px`,
    "--e30-radio": `${r.radio}px`,
    "--e30-linea": `${r.linea}px`,
    "--e30-franja": `${r.franja}px`,
    "--e30-fila": `${r.fila}px`,
    "--e30-neto": `${r.neto}px`,
  } as CSSProperties;
}
