/** Contrato de /api/canales-producto/* (app/services/canales_producto.py). */

export type Clasificacion =
  | "vendible_no_facturable"
  | "inactivo_publicado"
  | "inactivo_con_alias"
  | "pausado_no_facturable"
  | "discrepancia_canales"
  | "incompleto"
  | "suelto"
  | "completo";

export type EstadoPieza = "ok" | "aviso" | "falta" | "na" | "inactivo" | "publicado" | "pausado";

export type Salto = { panel: string; motivo: string; buscar: string };

export type FilaSku = {
  sku: string;
  nombre: string;
  es_kit: boolean;
  clasificacion: Clasificacion;
  motivos: string[];
  saltos: Salto[];
  canales: {
    alegra: { estado: "ok" | "inactivo" | "falta"; tipo: string };
    combo: { estado: EstadoPieza };
    documento: { estado: EstadoPieza };
    ean: { estado: EstadoPieza; codigo: string };
    etiqueta: { estado: EstadoPieza };
    meli: { estado: "publicado" | "pausado" | "falta"; pausada_por_cese?: boolean; n_publicaciones: number; meli_id: string; permalink: string; relacion: string };
    web: { estado: "publicado" | "falta"; cat: string; buyable: boolean; stock: number | null };
    facturable: { estado: "si" | "alias" | "inactivo" | "no"; alias_destino: string };
  };
};

export type Tabla = {
  filas: FilaSku[];
  total: number;
  resumen: Record<Clasificacion, number>;
  sin_senal: { fuente: string; error: string }[];
  fuentes: {
    alegra: { synced_at: string | null; stale: boolean } | null;
    relacion_meli: { actualizado_en: string | null; edad_s: number | null };
    web_cache: { mtime: string } | null;
  };
  generado: string;
};

export type FilaCategoria = {
  sku: string;
  nombre: string;
  clasificacion: Clasificacion;
  cat_etiquetas: string;
  cat_web: string;
  cat_meli: string | null;
};

export type Verificacion = {
  ok: boolean;
  sku: string;
  facturable?: boolean;
  reference?: string;
  alias_de?: string;
  status?: string;
  mensaje?: string;
  error?: string;
};

/** Orden = gravedad. El color dice qué tan urgente es, no de qué canal. */
export const CLASIF: Record<Clasificacion, { nombre: string; corto: string; tono: string; ayuda: string }> = {
  vendible_no_facturable: {
    nombre: "No se puede facturar",
    corto: "No factura",
    tono: "bg-accent-rose text-white",
    ayuda: "Se vende en MeLi o la web con un código que Alegra no conoce ni tiene alias.",
  },
  inactivo_publicado: {
    nombre: "Inactivo y publicado",
    corto: "Inactivo",
    tono: "bg-accent-rose/80 text-white",
    ayuda: "El código está inactivo en Alegra y sin alias: la factura saldría contra un ítem que no se puede anular.",
  },
  inactivo_con_alias: {
    nombre: "Factura por alias",
    corto: "Alias",
    tono: "bg-accent-sun/40 text-ink",
    ayuda: "Se factura con otro código (alias de venta). Funciona, pero conviene unificar.",
  },
  pausado_no_facturable: {
    nombre: "Pausada, no factura",
    corto: "Pausada",
    tono: "bg-accent-rose/25 text-ink",
    ayuda: "Publicación pausada con un código que Alegra no factura: no vende hoy, pero si se reactiva, sus ventas no se podrán facturar.",
  },
  discrepancia_canales: {
    nombre: "Canales no coinciden",
    corto: "Discrepancia",
    tono: "bg-accent-sun text-ink",
    ayuda: "MeLi, la web y Alegra no dicen lo mismo de este SKU.",
  },
  incompleto: {
    nombre: "Le faltan piezas",
    corto: "Incompleto",
    tono: "bg-accent-sun/25 text-ink",
    ayuda: "Documento, EAN o etiqueta sin terminar (se completa en el taller de combos).",
  },
  suelto: {
    nombre: "Sin publicar",
    corto: "Suelto",
    tono: "bg-surface text-ink-secondary",
    ayuda: "Combo de venta en Alegra que no está en ningún canal.",
  },
  completo: {
    nombre: "Completo",
    corto: "Completo",
    tono: "bg-accent-leaf text-white",
    ayuda: "Todo en orden: existe, se factura y está en sus canales.",
  },
};

export const ORDEN_CLASIF: Clasificacion[] = [
  "vendible_no_facturable",
  "inactivo_publicado",
  "inactivo_con_alias",
  "pausado_no_facturable",
  "discrepancia_canales",
  "incompleto",
  "suelto",
  "completo",
];

/** Estado de una pieza del tablero → buena / a medias / mala / no aplica. */
export function tonoPieza(e: string): "ok" | "aviso" | "falta" | "na" {
  if (e === "ok" || e === "publicado" || e === "si") return "ok";
  if (e === "aviso" || e === "pausado" || e === "alias") return "aviso";
  if (e === "na") return "na";
  return "falta";
}
