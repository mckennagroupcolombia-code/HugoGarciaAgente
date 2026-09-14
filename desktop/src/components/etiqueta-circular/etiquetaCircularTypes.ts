/**
 * Formato circular 53 × 53 mm — etiqueta redonda para Ceras y mantecas.
 *
 * A diferencia de los demás formatos, la composición es radial: el nombre y
 * los datos del perímetro van sobre arcos (SVG `textPath`) y el bloque
 * central —descripción, aplicaciones, código de barras y peso— se apila
 * dentro del círculo naranja. Mismo objeto de datos que las demás etiquetas
 * y la misma forma de editar: se hace clic sobre cada texto de la etiqueta.
 *
 * Todo se maqueta a un diámetro de diseño fijo (`DIAMETRO_CIRCULAR`) y se
 * escala desde afuera, así las medidas de impresión no dependen de la
 * pantalla.
 */
import type { CSSProperties } from "react";
import { normalizarHex } from "../etiqueta-ficha/productLabelTypes";
import { mezclarHex, sonMedidas } from "../etiqueta-30ml/etiqueta30mlTypes";

export const MEDIDAS_CIRCULAR_POR_DEFECTO = { ancho_mm: 53, alto_mm: 53 } as const;
export const NOMBRE_FORMATO_CIRCULAR = "Circular 53";

/** ¿El formato elegido usa la etiqueta circular? Por el nombre o, si se lo
 *  renombró (los formatos se muestran por tamaño), por sus medidas. Ojo: ya
 *  existen «Circular» (55 × 55) y «Circular 70», que son otros diseños. */
export function esFormatoCircular(
  tipoNombre?: string | null,
  medidas?: { ancho_mm?: number; alto_mm?: number } | null,
): boolean {
  if (/^circular\s*53$/i.test((tipoNombre || "").trim())) return true;
  return sonMedidas(medidas, MEDIDAS_CIRCULAR_POR_DEFECTO);
}

/** Diámetro de diseño en px — es también el tamaño al que se dibuja en
 *  pantalla, porque el lienzo va siempre al 100 %. Se eligió para que la
 *  etiqueta quepa entera sin desplazarse: al ser cuadrada es la más alta de
 *  todos los formatos (el de 69 × 51 mide 665 px de alto y la ficha de
 *  76 × 66, 833). Todo lo demás —bandas, tamaños de letra, separaciones— se
 *  calcula como fracción de este número, así que cambiarlo reescala el
 *  diseño entero sin tocar ninguna otra constante. */
export const DIAMETRO_CIRCULAR = 680;

export interface ReticulaCircular {
  /** Lado del cuadrado = diámetro (relación 1:1, siempre). */
  diametro: number;
  centro: number;
  /** Borde exterior gris: margen del 1,5 % del diámetro — el círculo llega
   *  casi al filo del lienzo, como en la referencia (§13). */
  rExterior: number;
  /** Círculo naranja interior: 5,5 % del diámetro más adentro (§13). */
  rInterior: number;
  /** Eje del anillo perimetral — sobre él van los textos curvos. */
  rAnillo: number;
  /** Arco del título, ya dentro del círculo naranja. */
  rTitulo: number;
  linea: number;
  lineaFina: number;
  /** Separación entre los dos renglones del costado izquierdo. */
  sepArco: number;
  /** Bandas del bloque central, ya en px para este diámetro. */
  bandas: Record<ClaveBanda, BandaCircular>;
  /** Tamaños de letra (máximo, mínimo), ya en px para este diámetro. */
  tam: Record<ClaveTexto, readonly [number, number]>;
}

export interface BandaCircular {
  top: number;
  alto: number;
  ancho: number;
}

/**
 * Bandas del bloque central como fracción del diámetro. Cada una es tan
 * ancha como quepa a su altura dentro del círculo naranja: por eso la lista
 * de aplicaciones, que va por el centro, es la más ancha.
 */
const BANDAS_REL = {
  descripcion: { top: 0.2882, alto: 0.1618, ancho: 0.5382 },
  aplicacionesTitulo: { top: 0.4529, alto: 0.0382, ancho: 0.4412 },
  aplicaciones: { top: 0.4941, alto: 0.2147, ancho: 0.6912 },
  barras: { top: 0.7088, alto: 0.1412, ancho: 0.4941 },
  neto: { top: 0.8529, alto: 0.0471, ancho: 0.2794 },
} as const;
export type ClaveBanda = keyof typeof BANDAS_REL;

/** Tamaños de letra (máximo, mínimo) como fracción del diámetro. El texto se
 *  encoge hasta el mínimo y, si aún no cabe, se marca en rojo (nunca
 *  desborda, nunca se vuelve ilegible). */
const TAM_REL = {
  titulo: [0.08824, 0.04794],
  descripcion: [0.025, 0.017],
  aplicacionesTitulo: [0.02647, 0.01853],
  aplicacion: [0.02059, 0.01456],
  neto: [0.03088, 0.02103],
  control: [0.01838, 0.0125],
  registro: [0.02059, 0.01456],
  empresa: [0.02353, 0.01647],
} as const satisfies Record<string, readonly [number, number]>;
export type ClaveTexto = keyof typeof TAM_REL;

function bandasCirculares(d: number): Record<ClaveBanda, BandaCircular> {
  const px = (r: { top: number; alto: number; ancho: number }): BandaCircular => ({
    top: Math.round(d * r.top),
    alto: Math.round(d * r.alto),
    ancho: Math.round(d * r.ancho),
  });
  return {
    descripcion: px(BANDAS_REL.descripcion),
    aplicacionesTitulo: px(BANDAS_REL.aplicacionesTitulo),
    aplicaciones: px(BANDAS_REL.aplicaciones),
    barras: px(BANDAS_REL.barras),
    neto: px(BANDAS_REL.neto),
  };
}

function tamanosCirculares(d: number): Record<ClaveTexto, readonly [number, number]> {
  const px = ([max, min]: readonly [number, number]) =>
    [Math.round(d * max * 10) / 10, Math.round(d * min * 10) / 10] as const;
  return {
    titulo: px(TAM_REL.titulo),
    descripcion: px(TAM_REL.descripcion),
    aplicacionesTitulo: px(TAM_REL.aplicacionesTitulo),
    aplicacion: px(TAM_REL.aplicacion),
    neto: px(TAM_REL.neto),
    control: px(TAM_REL.control),
    registro: px(TAM_REL.registro),
    empresa: px(TAM_REL.empresa),
  };
}

export function reticulaCircular(anchoMm?: number, altoMm?: number): ReticulaCircular {
  // La etiqueta es circular: aunque el formato venga con medidas distintas,
  // se maqueta 1:1 y manda el lado menor (nunca se deforma, §2).
  void anchoMm;
  void altoMm;
  const diametro = DIAMETRO_CIRCULAR;
  const centro = diametro / 2;
  const rExterior = centro - diametro * 0.015;
  const rInterior = rExterior - diametro * 0.055;
  return {
    diametro,
    centro,
    rExterior,
    rInterior,
    rAnillo: (rExterior + rInterior) / 2,
    rTitulo: rInterior - diametro * 0.05,
    linea: Math.max(1.2, diametro * 0.0019),
    lineaFina: Math.max(0.9, diametro * 0.0014),
    sepArco: Math.round(diametro * 0.0147),
    bandas: bandasCirculares(diametro),
    tam: tamanosCirculares(diametro),
  };
}

// ── Geometría de los arcos ─────────────────────────────────────────────────

/** Punto del círculo en grados de brújula: 0 = arriba, sentido horario. */
function punto(centro: number, r: number, grados: number): { x: number; y: number } {
  const rad = ((grados - 90) * Math.PI) / 180;
  return { x: centro + r * Math.cos(rad), y: centro + r * Math.sin(rad) };
}

/**
 * Arco como atributo `d` de un <path>, para colgarle un `textPath`.
 *
 * `haciaAfuera` decide de qué lado del trazo queda el texto, que es lo que
 * evita que salga invertido (§12): con el trazo en sentido horario el texto
 * mira hacia afuera —recto arriba, de cabeza abajo—, así que los arcos de la
 * mitad inferior se dibujan al revés para que se lean del derecho.
 */
export function arcoTexto(
  centro: number,
  r: number,
  desde: number,
  hasta: number,
  haciaAfuera = true,
): string {
  const a = haciaAfuera ? desde : hasta;
  const b = haciaAfuera ? hasta : desde;
  const p1 = punto(centro, r, a);
  const p2 = punto(centro, r, b);
  const arcoLargo = Math.abs(hasta - desde) > 180 ? 1 : 0;
  const sentido = haciaAfuera ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${arcoLargo} ${sentido} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

/**
 * Reparto del anillo perimetral, en grados de brújula. Los tramos no se
 * tocan: entre uno y otro queda aire, y la parte de arriba se deja libre
 * porque ahí manda el título.
 */
export const TRAMOS_CIRCULAR = {
  /** Título, dentro del círculo naranja (no en el anillo). Va de un hombro
   *  al otro —±68°, del sector superior izquierdo al superior derecho— y a
   *  un radio alto, que es lo que mantiene arriba las puntas del arco: con
   *  el título grande, bajarlo metía las últimas letras en la descripción. */
  titulo: { desde: -68, hasta: 68, haciaAfuera: true },
  /** Aviso de almacenamiento: arranca en el costado superior derecho, baja
   *  por la curva y sigue por la parte de abajo (§6). Es el tramo más largo
   *  del anillo porque también es, de lejos, el texto más largo. */
  control: { desde: 22, hasta: 170, haciaAfuera: true },
  /** Registro sanitario: arco inferior izquierdo, se lee del derecho. */
  registro: { desde: 182, hasta: 236, haciaAfuera: false },
  /** Razón social y ciudad: costado izquierdo, en dos renglones. */
  empresa: { desde: 244, hasta: 314, haciaAfuera: true },
} as const;

/** Alto de la franja de color sobre el código (§8), en unidades del SVG del
 *  código: ya no sigue al diámetro porque el propio código se escala con la
 *  etiqueta y la franja viaja dentro de él. Los colores son los mismos en los
 *  cuatro formatos y viven en `etiqueta-ficha/franjaBarras`. */
export const ALTO_FRANJA_CIRCULAR = 16;

/** Una aplicación por renglón: así se guarda en `data.aplicaciones` y así se
 *  reparte en viñetas. Los renglones en blanco no cuentan. */
export function lineasAplicaciones(valor: string | undefined): string[] {
  return (valor || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function unirAplicaciones(lineas: readonly string[]): string {
  return lineas.join("\n");
}

export function variablesCirculares(r: ReticulaCircular, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--ec-diametro": `${r.diametro}px`,
    "--ec-linea": `${r.linea}px`,
    // Adorno que no es texto y también sigue al diámetro.
    "--ec-vineta": `${Math.max(3, Math.round(r.diametro * 0.0085))}px`,
    // La franja de contacto y las casillas reutilizan reglas de la 30 mL.
    "--e30-linea": `${r.linea}px`,
  } as CSSProperties;
}
