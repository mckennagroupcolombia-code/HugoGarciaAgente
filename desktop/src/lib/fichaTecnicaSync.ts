import type { ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";
import { FICHA_SIN_DATO } from "./fichaTecnicaCampos";

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
 * Fuera a propósito: el contenido neto (manda el del código de barras). La
 * conservación SÍ se sincroniza: desde el 2026-09-23 manda la del documento
 * técnico (resumida a 15 palabras), no la sugerida de la familia.
 */
const NO_SINCRONIZAR = new Set<string>(["netContent", "storageSugerido"]);

export function fotoFicha(patch: Partial<ProductLabelData>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (NO_SINCRONIZAR.has(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

/** Campos de la etiqueta a cambiar porque cambiaron en la ficha desde `base`.
 *  Sin `base` no se sabe qué es ajuste a mano: solo se llenan las casillas
 *  vacías. */
export function cambiosDesdeFicha(
  actual: ProductLabelData,
  patch: Partial<ProductLabelData>,
  base: Record<string, string> | undefined,
): Partial<ProductLabelData> {
  const ahora = fotoFicha(patch);
  const d = actual as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ahora)) {
    const enEtiqueta = String(d[k] ?? "");
    if (enEtiqueta === v) continue; // la etiqueta ya lo tiene
    // Una casilla vacía no es un ajuste a mano: si la ficha trae el dato se
    // llena, aunque la foto diga que ya se había traído (PROTEÍNA AISLADA DE
    // SOYA quedó con la composición en blanco y la foto con el texto, y la
    // ficha nunca volvía a llenarla).
    const vacia = !enEtiqueta.trim() || enEtiqueta.includes(FICHA_SIN_DATO);
    if (!vacia && (!base || (base[k] ?? "") === v)) continue; // la ficha no cambió este campo
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
  modoUso: "modo de uso",
  beneficio1: "beneficio 1",
  beneficio2: "beneficio 2",
  ghs: "pictograma GHS",
  ghsIconSvg: "pictograma GHS",
  clasificacionTexto: "clasificación SGA",
};
