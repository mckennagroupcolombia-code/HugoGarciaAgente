import type { FilaSku } from "./tipos";

/** Las piezas del tablero, en el orden en que nace un producto:
 *  inventario → combo → respaldo (documento, EAN, etiqueta) → canales → factura. */
export type Pieza = {
  clave: string;
  titulo: string;
  etapa: "inventario" | "respaldo" | "canal" | "factura";
  estado: (f: FilaSku) => string;
  texto: (f: FilaSku) => string;
};

const TXT: Record<string, string> = {
  ok: "Listo",
  aviso: "A medias",
  falta: "Falta",
  na: "No aplica",
};

export const PIEZAS: Pieza[] = [
  {
    clave: "alegra",
    titulo: "Alegra",
    etapa: "inventario",
    estado: (f) => f.canales.alegra.estado,
    texto: (f) =>
      f.canales.alegra.estado === "ok"
        ? `Existe y está activo (${f.canales.alegra.tipo === "kit" ? "combo" : "producto"})`
        : f.canales.alegra.estado === "inactivo"
        ? "Existe pero está INACTIVO"
        : "El código no existe en Alegra",
  },
  {
    clave: "combo",
    titulo: "Receta",
    etapa: "inventario",
    estado: (f) => f.canales.combo.estado,
    texto: (f) => TXT[f.canales.combo.estado] ?? f.canales.combo.estado,
  },
  {
    clave: "documento",
    titulo: "Documento",
    etapa: "respaldo",
    estado: (f) => f.canales.documento.estado,
    texto: (f) => TXT[f.canales.documento.estado] ?? f.canales.documento.estado,
  },
  {
    clave: "ean",
    titulo: "EAN",
    etapa: "respaldo",
    estado: (f) => f.canales.ean.estado,
    texto: (f) => (f.canales.ean.codigo ? `${TXT[f.canales.ean.estado] ?? ""} · ${f.canales.ean.codigo}` : TXT[f.canales.ean.estado] ?? f.canales.ean.estado),
  },
  {
    clave: "etiqueta",
    titulo: "Etiqueta",
    etapa: "respaldo",
    estado: (f) => f.canales.etiqueta.estado,
    texto: (f) => TXT[f.canales.etiqueta.estado] ?? f.canales.etiqueta.estado,
  },
  {
    clave: "meli",
    titulo: "MercadoLibre",
    etapa: "canal",
    estado: (f) => f.canales.meli.estado,
    texto: (f) =>
      f.canales.meli.estado === "falta"
        ? "Sin publicación conocida"
        : `${f.canales.meli.estado === "publicado" ? (f.canales.meli.pausada_por_cese ? "Activa (pausada por el cese)" : "Activa") : "Pausada"}${f.canales.meli.n_publicaciones > 1 ? ` · ${f.canales.meli.n_publicaciones} publicaciones` : ""}${
            f.canales.meli.relacion === "sku_divergente" ? " · SKU distinto al de Alegra" : ""
          }`,
  },
  {
    clave: "web",
    titulo: "Tienda web",
    etapa: "canal",
    estado: (f) => f.canales.web.estado,
    texto: (f) =>
      f.canales.web.estado === "falta"
        ? "No aparece en la tienda"
        : `${f.canales.web.buyable ? "Se puede comprar" : "Solo vitrina"}${f.canales.web.cat ? ` · ${f.canales.web.cat}` : ""}`,
  },
  {
    clave: "facturable",
    titulo: "Factura",
    etapa: "factura",
    estado: (f) => f.canales.facturable.estado,
    texto: (f) => {
      const fa = f.canales.facturable;
      if (fa.estado === "si") return "Se factura con su propio código";
      if (fa.estado === "alias") return `Se factura como «${fa.alias_destino}» (alias)`;
      if (fa.estado === "inactivo") return "Saldría contra un ítem inactivo";
      return "No se puede facturar";
    },
  },
];
