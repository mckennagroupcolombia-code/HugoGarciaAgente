import { mmParaTipoEtiqueta, TIPOS_ETIQUETA_DEFAULT } from "./etiquetasTipos";
import {
  ETIQUETA_STUDIO_DEFAULT,
  type EtiquetaStudioDatos,
} from "./etiquetasNormativa";
import type { CatalogoStudioFila } from "../components/etiquetas/EtiquetasStudioCatalogo";

export function inferirPresentacionSku(sku: string): Partial<EtiquetaStudioDatos> {
  const raw = sku.trim();
  if (!raw) return {};
  const m =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|mL|lt|l)\b/i) ||
    raw.match(/(\d+)(kg|g|ml|mL|lt|l)$/i);
  if (!m) return {};
  const neto = m[1].replace(",", ".");
  const u = m[2].toLowerCase();
  if (u === "kg" && parseFloat(neto) === 1) {
    return { contenido_neto: "1", unidad: "Kg", tipo_etiqueta: "1 Kg" };
  }
  if (u === "ml") {
    return { contenido_neto: neto, unidad: "mL", tipo_etiqueta: `${neto} mL` };
  }
  if (u === "lt" || u === "l") {
    return { contenido_neto: neto, unidad: "L", tipo_etiqueta: "50 mL" };
  }
  return { contenido_neto: neto, unidad: "g", tipo_etiqueta: `${neto} g` };
}

/** Arma payload Studio desde fila de catálogo + guardado opcional. */
export function studioDatosDesdeCatalogo(
  fila: CatalogoStudioFila,
  guardado?: Partial<EtiquetaStudioDatos> | null,
): EtiquetaStudioDatos {
  const pres = inferirPresentacionSku(fila.sku);
  const tipo =
    guardado?.tipo_etiqueta ||
    fila.tipo_etiqueta ||
    pres.tipo_etiqueta ||
    ETIQUETA_STUDIO_DEFAULT.tipo_etiqueta;
  const [ancho, alto] = mmParaTipoEtiqueta(tipo, TIPOS_ETIQUETA_DEFAULT);
  const nombre = (guardado?.nombre_producto || fila.nombre || "").replace(/\s+/g, " ").trim();

  return {
    ...ETIQUETA_STUDIO_DEFAULT,
    ...guardado,
    sku: fila.sku,
    codigo_barras: guardado?.codigo_barras || fila.sku,
    nombre_producto: nombre,
    ingrediente: guardado?.ingrediente || nombre,
    archivo_ai: fila.archivo_ai || guardado?.archivo_ai,
    forzar_plantilla_svg: fila.fuente === "svg" ? true : guardado?.forzar_plantilla_svg,
    tipo_etiqueta: tipo,
    ancho_mm: guardado?.ancho_mm ?? ancho,
    alto_mm: guardado?.alto_mm ?? alto,
    contenido_neto: guardado?.contenido_neto || pres.contenido_neto || ETIQUETA_STUDIO_DEFAULT.contenido_neto,
    unidad: guardado?.unidad || pres.unidad || ETIQUETA_STUDIO_DEFAULT.unidad,
  };
}
