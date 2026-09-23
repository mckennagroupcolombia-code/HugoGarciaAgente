import type { ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";

/**
 * Sincronización ficha técnica → etiqueta.
 *
 * La ficha técnica es la fuente de los datos del producto. Si se corrige ahí
 * (grado, origen, composición…), la etiqueta debe cambiar sola. Pero una
 * etiqueta también se ajusta a mano (un texto acortado para que quepa), y
 * volver a copiar la ficha entera borraría eso. Por eso la etiqueta guarda
 * una foto de lo que trajo la última vez (`fichaTecnicaBase`) y se aplica
 * solo lo que CAMBIÓ en la ficha desde esa foto.
 *
 * Fuera a propósito: el contenido neto (manda el del código de barras) y la
 * conservación (manda la sugerida de la familia, con «envase»/«empaque»).
 */
const NO_SINCRONIZAR = new Set<string>(["netContent", "storage", "storageSugerido"]);

export function fotoFicha(patch: Partial<ProductLabelData>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (NO_SINCRONIZAR.has(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

/** Campos de la etiqueta a cambiar porque cambiaron en la ficha desde `base`.
 *  Sin `base` no se sabe qué es ajuste a mano: no se cambia nada. */
export function cambiosDesdeFicha(
  actual: ProductLabelData,
  patch: Partial<ProductLabelData>,
  base: Record<string, string> | undefined,
): Partial<ProductLabelData> {
  if (!base) return {};
  const ahora = fotoFicha(patch);
  const d = actual as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ahora)) {
    if ((base[k] ?? "") === v) continue; // la ficha no cambió este campo
    if ((d[k] ?? "") === v) continue; // la etiqueta ya lo tiene
    out[k] = v;
  }
  return out as Partial<ProductLabelData>;
}

/** Cómo se llama cada campo en el aviso «Actualizado desde la ficha técnica: …». */
export const NOMBRE_CAMPO: Record<string, string> = {
  productName: "nombre",
  classification: "clasificación",
  concentration: "concentración",
  cas: "CAS",
  origin: "origen",
  appearance: "apariencia",
  odor: "aroma",
  composition: "composición",
  compositionTitulo: "título de composición",
  grade: "grado",
  alergenos: "alérgenos",
  descripcionProducto: "descripción",
  aplicaciones: "aplicaciones",
  ghs: "pictograma GHS",
  ghsIconSvg: "pictograma GHS",
  clasificacionTexto: "clasificación SGA",
};
