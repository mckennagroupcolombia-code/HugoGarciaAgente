/**
 * Franja de ocho colores que corona el código de barras en los cuatro
 * formatos de etiqueta.
 *
 * No es un componente: la franja se dibuja DENTRO del SVG del código (ver
 * `lib/ean13`, `FranjaEAN13`). Fue un intento previo pintarla como una capa
 * aparte en el DOM, pero así no hay manera de que empiece y acabe donde las
 * barras — la zona muda del EAN-13 es asimétrica (11 módulos a la izquierda
 * y 7 a la derecha), de modo que el centro de las barras no coincide con el
 * de la imagen, y `object-fit: contain` desplaza el dibujo de forma distinta
 * en cada formato. Compartiendo coordenadas con las barras, el encaje es
 * exacto a cualquier escala y viaja solo al PNG y a la impresión.
 */

/** Los ocho colores corporativos, en el orden del espectro de la referencia. */
export const COLORES_FRANJA_BARRAS = [
  "#E6007E",
  "#7B2D8E",
  "#1B2E7A",
  "#0090D4",
  "#00A9A5",
  "#3FA535",
  "#F3D200",
  "#F08A1E",
] as const;

export interface FranjaBarras {
  /** Alto en unidades del SVG del código (no en px: el código se escala).
   *  Las barras miden 80 de alto y el SVG 339 de ancho, para hacerse una
   *  idea de la proporción. */
  alto: number;
  /** Aire entre la franja y lo alto de las barras, en esas mismas unidades. */
  separacion?: number;
}
