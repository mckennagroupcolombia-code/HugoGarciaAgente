import { mmParaTipoEtiqueta, TIPOS_ETIQUETA_DEFAULT } from "./etiquetasTipos";
import {
  ETIQUETA_STUDIO_DEFAULT,
  aplicarDefaultsAlternativa,
  type EtiquetaStudioDatos,
} from "./etiquetasNormativa";
import type { CatalogoStudioFila } from "../components/etiquetas/EtiquetasStudioCatalogo";

/** Formato de impresión elegido antes del escaneo. */
export interface FormatoImpresionEscaneo {
  nombre: string;
  ancho_mm: number;
  alto_mm: number;
}

/** Destino del escáner de diagramación (plantilla .ai + formato). */
export interface EscaneoDiagramacionTarget {
  archivo_ai: string;
  tipo_etiqueta: string;
  ancho_mm: number;
  alto_mm: number;
  sku?: string;
  nombre?: string;
}

function tipoDesdeNombrePlantilla(archivoAi: string): string | undefined {
  const stem = archivoAi.replace(/\.(ai|pdf)$/i, "").replace(/^PDF\//i, "");
  const m = stem.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|mL|lt|l)\b/i) || stem.match(/(\d+)(kg|g|ml)$/i);
  if (!m) return undefined;
  return presentacionDesdeTipoEtiqueta(`${m[1]} ${m[2]}`).tipo_etiqueta;
}

/** Arma target de escaneo desde fila del catálogo Studio. */
export function targetEscaneoDesdeFila(
  fila: CatalogoStudioFila,
  formato: FormatoImpresionEscaneo,
): EscaneoDiagramacionTarget | null {
  const archivo = (fila.archivo_ai || "").trim();
  if (!archivo || fila.fuente !== "ai") return null;
  return {
    archivo_ai: archivo,
    tipo_etiqueta: formato.nombre,
    ancho_mm: formato.ancho_mm,
    alto_mm: formato.alto_mm,
    sku: fila.sku,
    nombre: fila.nombre,
  };
}

/** Plantilla .ai sin SKU en catálogo Siigo. */
export function targetEscaneoDesdePlantilla(
  archivoAi: string,
  formato: FormatoImpresionEscaneo,
): EscaneoDiagramacionTarget {
  const archivo = archivoAi.trim();
  return {
    archivo_ai: archivo,
    tipo_etiqueta: formato.nombre,
    ancho_mm: formato.ancho_mm,
    alto_mm: formato.alto_mm,
    nombre: archivo,
  };
}

/** Parsea "250 g", "1 Kg", "50 mL" → contenido, unidad y tipo. */
export function presentacionDesdeTipoEtiqueta(tipo: string): Partial<EtiquetaStudioDatos> {
  const raw = (tipo || "").trim();
  if (!raw) return {};
  const m =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|mL|lt|l)\b/i) ||
    raw.match(/(\d+(?:[.,]\d+)?)\s*(Kg)/);
  if (!m) return { tipo_etiqueta: raw };
  const neto = m[1].replace(",", ".");
  const u = m[2];
  if (u.toLowerCase() === "kg" || u === "Kg") {
    if (parseFloat(neto) === 1) {
      return { contenido_neto: "1", unidad: "Kg", tipo_etiqueta: "1 Kg" };
    }
    return { contenido_neto: neto, unidad: "Kg", tipo_etiqueta: `${neto} Kg` };
  }
  if (u.toLowerCase() === "ml") {
    return { contenido_neto: neto, unidad: "mL", tipo_etiqueta: `${neto} mL` };
  }
  if (u.toLowerCase() === "lt" || u.toLowerCase() === "l") {
    return { contenido_neto: neto, unidad: "L", tipo_etiqueta: `${neto} L` };
  }
  return { contenido_neto: neto, unidad: "g", tipo_etiqueta: `${neto} g` };
}

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

export function inferirPerfilDesdeProducto(
  nombre: string,
  sku: string,
  archivoAi?: string,
): Partial<EtiquetaStudioDatos> {
  const blob = `${nombre} ${sku} ${archivoAi || ""}`.toLowerCase();
  if (/aceite|esencial|essential|atre|melaleuca|lavanda|eucalipto|menta\b|neem|ricino|linaza/i.test(blob)) {
    return {
      perfil: "insumo_cosmetico",
      subtitulo: "Aceite 100% esencial puro",
      descripcion_etiqueta: "",
      aplicaciones: "Cosmética, formulación y aromaterapia",
    };
  }
  if (/cosm[eé]tic|derm|serum|crema|gel\b/i.test(blob)) {
    return {
      perfil: "insumo_cosmetico",
      subtitulo: "Insumo cosmético — materia prima para formulación",
      descripcion_etiqueta: "",
    };
  }
  return {};
}

function esCopiaGenericaPolvo(d: Partial<EtiquetaStudioDatos>): boolean {
  const blob = `${d.subtitulo || ""} ${d.descripcion_etiqueta || ""}`.toLowerCase();
  return blob.includes("polvo fino") || blob.includes("insumo alimentario 100% puro en polvo");
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
  const perfilInferido = inferirPerfilDesdeProducto(nombre, fila.sku, fila.archivo_ai || guardado?.archivo_ai);

  const base: EtiquetaStudioDatos = {
    ...(aplicarDefaultsAlternativa({
      ...ETIQUETA_STUDIO_DEFAULT,
      ...perfilInferido,
      ...guardado,
      sku: fila.sku,
      codigo_barras: guardado?.codigo_barras || "",
      nombre_producto: nombre,
      ingrediente: guardado?.ingrediente || nombre,
      archivo_ai: fila.archivo_ai || guardado?.archivo_ai,
      forzar_plantilla_svg: fila.fuente === "svg" ? true : guardado?.forzar_plantilla_svg,
      tipo_etiqueta: tipo,
      ancho_mm: guardado?.ancho_mm ?? ancho,
      alto_mm: guardado?.alto_mm ?? alto,
      contenido_neto: guardado?.contenido_neto || pres.contenido_neto || ETIQUETA_STUDIO_DEFAULT.contenido_neto,
      unidad: guardado?.unidad || pres.unidad || ETIQUETA_STUDIO_DEFAULT.unidad,
    }) as EtiquetaStudioDatos),
  };

  if (Object.keys(perfilInferido).length > 0 && esCopiaGenericaPolvo(guardado || {})) {
    base.subtitulo = perfilInferido.subtitulo || base.subtitulo;
    base.descripcion_etiqueta = perfilInferido.descripcion_etiqueta ?? "";
  }

  return base;
}
