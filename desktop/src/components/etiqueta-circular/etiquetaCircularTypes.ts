/**
 * Formato circular 53 × 53 mm — etiqueta redonda para Ceras y mantecas.
 *
 * A diferencia de los demás formatos, la composición es radial: el nombre y
 * los datos del perímetro van sobre arcos (SVG `textPath`) y el bloque
 * central —logo, rejilla 2 × 2 de casillas con ícono, código de
 * barras y peso— se apila
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
  /** Líneas finas del bloque central: logo↔rejilla, la cruz de la rejilla y
   *  rejilla↔código de barras. */
  lineas: readonly LineaCircular[];
  /** Lado del ícono de cada casilla de la rejilla. */
  icono: number;
  /** Tamaños de letra (máximo, mínimo), ya en px para este diámetro. */
  tam: Record<ClaveTexto, readonly [number, number]>;
}

export interface BandaCircular {
  top: number;
  alto: number;
  ancho: number;
}

/** Una línea fina del bloque central, en px de diseño (esquina superior
 *  izquierda y tamaño): sirve igual para las horizontales y la vertical. */
export interface LineaCircular {
  top: number;
  left: number;
  ancho: number;
  alto: number;
}

/**
 * Bandas del bloque central como fracción del diámetro. Cada una es tan
 * ancha como quepa a su altura dentro del círculo naranja (con el arco del
 * título arriba y el anillo a los lados).
 *
 * Entre `logo` y `rejilla`, y entre `rejilla` y `barras`, queda un hueco
 * para la línea separadora. El bloque del código de barras conserva su alto:
 * es el único con poco margen antes de que el EAN se vea más chico.
 */
const BANDAS_REL = {
  // Logo + lema: el hueco que queda por dentro del arco del título (las
  // letras cuelgan hacia afuera). A esa altura el arco deja libres ±0,18 d,
  // de ahí el ancho. Es alta a propósito: así el logo queda limitado por el
  // ANCHO y no por el alto; si lo limitara el alto, el lema (que se iguala al
  // ancho del logo y le resta alto) y el logo se reajustarían en bucle.
  logo: { top: 0.1647, alto: 0.17, ancho: 0.3 },
  // Rejilla 2 × 2 de casillas con ícono. No sube más: arriba de 0,37 d sus
  // esquinas tocarían las letras del título. Por debajo del arco del título solo
  // manda el círculo naranja: las esquinas de la rejilla quedan a ≤ 0,39 d
  // del centro, dentro del radio interior (0,43 d) con aire.
  rejilla: { top: 0.3765, alto: 0.3147, ancho: 0.68 },
  barras: { top: 0.7088, alto: 0.1412, ancho: 0.4941 },
  neto: { top: 0.8529, alto: 0.0471, ancho: 0.2794 },
} as const;
export type ClaveBanda = keyof typeof BANDAS_REL;

/** Tamaños de letra (máximo, mínimo) como fracción del diámetro. El texto se
 *  encoge hasta el mínimo y, si aún no cabe, se marca en rojo (nunca
 *  desborda, nunca se vuelve ilegible). */
const TAM_REL = {
  titulo: [0.08824, 0.04794],
  casillaTitulo: [0.0202, 0.0202],
  casillaValor: [0.0243, 0.0178],
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
    logo: px(BANDAS_REL.logo),
    rejilla: px(BANDAS_REL.rejilla),
    barras: px(BANDAS_REL.barras),
    neto: px(BANDAS_REL.neto),
  };
}

/** Separadores horizontales en medio de los huecos logo↔rejilla y
 *  rejilla↔barras, al ancho de la rejilla; y la cruz que parte la rejilla en
 *  cuatro, un poco más corta que ella para que las casillas no se toquen en
 *  las puntas. */
function lineasCirculares(
  d: number,
  b: Record<ClaveBanda, BandaCircular>,
  grosor: number,
): LineaCircular[] {
  const c = d / 2;
  const g = b.rejilla;
  const medio = (finDeA: number, inicioDeB: number) => (finDeA + inicioDeB) / 2;
  const horizontal = (y: number, ancho: number): LineaCircular => ({
    top: y - grosor / 2,
    left: c - ancho / 2,
    ancho,
    alto: grosor,
  });
  const altoCruz = g.alto * 0.86;
  return [
    // Más corta que la de abajo: sus puntas quedan junto a la «M» y la última
    // letra del título, que a esa altura todavía bajan por el arco.
    horizontal(medio(b.logo.top + b.logo.alto, g.top), g.ancho * 0.8),
    horizontal(g.top + g.alto / 2, g.ancho * 0.94),
    { top: g.top + (g.alto - altoCruz) / 2, left: c - grosor / 2, ancho: grosor, alto: altoCruz },
    horizontal(medio(g.top + g.alto, b.barras.top), g.ancho),
  ];
}

function tamanosCirculares(d: number): Record<ClaveTexto, readonly [number, number]> {
  const px = ([max, min]: readonly [number, number]) =>
    [Math.round(d * max * 10) / 10, Math.round(d * min * 10) / 10] as const;
  return {
    titulo: px(TAM_REL.titulo),
    casillaTitulo: px(TAM_REL.casillaTitulo),
    casillaValor: px(TAM_REL.casillaValor),
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
  const bandas = bandasCirculares(diametro);
  const lineaFina = Math.max(0.9, diametro * 0.0014);
  return {
    diametro,
    centro,
    rExterior,
    rInterior,
    rAnillo: (rExterior + rInterior) / 2,
    rTitulo: rInterior - diametro * 0.05,
    linea: Math.max(1.2, diametro * 0.0019),
    lineaFina,
    sepArco: Math.round(diametro * 0.0147),
    bandas,
    lineas: lineasCirculares(diametro, bandas, lineaFina),
    icono: Math.round(diametro * 0.0572),
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

/** Casillas de la rejilla, en orden de lectura. `campo` es a la vez el dato
 *  y la clave de su ícono en `attribute_icons`; el ícono por defecto es el
 *  mismo que en la etiqueta de 30 mL. */
export const CASILLAS_CIRCULAR = [
  { campo: "origin", titulo: "Origen", icono: "origen_globo_meridianos" },
  { campo: "appearance", titulo: "Apariencia", icono: "apariencia_escamas" },
  { campo: "odor", titulo: "Aroma", icono: "aroma_nariz_percepcion" },
  { campo: "storage", titulo: "Conservación", icono: "conservacion_termometro" },
] as const;
export type CampoCasillaCircular = (typeof CASILLAS_CIRCULAR)[number]["campo"];

export function variablesCirculares(r: ReticulaCircular, accentColor?: string): CSSProperties {
  const acento = normalizarHex(accentColor);
  return {
    "--acento": acento,
    "--acento-50": `${acento}80`,
    "--acento-suave": mezclarHex(acento, "#FFFFFF", 0.88),
    "--ec-diametro": `${r.diametro}px`,
    "--ec-linea": `${r.linea}px`,
    "--ec-icono": `${r.icono}px`,
    // La franja de contacto y las casillas reutilizan reglas de la 30 mL.
    "--e30-linea": `${r.linea}px`,
  } as CSSProperties;
}
