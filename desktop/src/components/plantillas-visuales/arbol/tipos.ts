/** Studio → Árbol del producto: lo que devuelve `GET /api/mapa-sistema/arbol-producto`
 *  (app/services/arbol_producto.py). Categoría → familia (materia prima) → presentación
 *  (combo C-…) → piezas. Mismos datos que el taller de combos y Canales del producto. */

export type Estado = "ok" | "aviso" | "falta";

export type Pieza = {
  estado: Estado;
  detalle: string;
  // etiquetas
  png?: string;
  png_digital?: string;
  aprobado_at?: string;
  etiqueta_id?: string;
  tamano?: string;
  categoria_png?: string;
  // ean
  codigo?: string;
  // receta: qué pieza del taller la resuelve (receta o etiqueta_fisica)
  pieza_taller?: string;
  // meli
  meli_id?: string;
  permalink?: string;
  precio?: number | null;
  pausada_por_cese?: boolean;
  // web
  cat?: string;
  // fotos: una por canal, posterior a la etiqueta aprobada
  canales?: Partial<Record<"web" | "meli", { n: number; ultima: string; desactualizada: boolean }>>;
  foto_estado?: string;
};

export type ClavePieza = "etiquetas" | "fotos" | "ean" | "receta" | "factura" | "meli" | "web";

/** Costo de la receta (última compra de cada componente) contra el precio publicado.
 *  app/services/costo_receta.py. Precios con IVA; margen sobre el precio sin IVA. */
export type LineaCosto = {
  codigo: string;
  nombre: string;
  casilla: string;
  cantidad: number;
  costo_unitario: number | null;
  subtotal: number | null;
  fuente: "libro" | "factura" | "referencia" | "manual" | "alegra" | "";
  fecha: string;
  detalle: string;
};

export type ContrasteCanal = {
  canal: "web" | "meli" | "lista";
  precio: number;
  neto: number;
  comision: number;
  utilidad: number;
  margen: number | null;
  veces_costo: number | null;
};

export type CostoReceta = {
  total: number;
  lineas: LineaCosto[];
  sin_costo: string[];
  completo: boolean;
  /** Hay piezas sin costo: el margen es un techo, no el real. */
  parcial: boolean;
  contraste: ContrasteCanal[];
  con_iva: boolean;
  /** Tarifa de IVA de venta del combo en Alegra (0.19, 0.05, 0). */
  tasa_iva?: number;
  comision_meli: number;
  error?: string;
};

export type Presentacion = {
  ref: string;
  nombre: string;
  corto: string;
  presentacion: string;
  precio_lista: number | null;
  /** Precios publicados con IVA: vitrina web, MeLi (según la vitrina) y lista de Alegra. */
  precios?: { web?: number | null; meli?: number | null; lista?: number | null };
  costo?: CostoReceta | null;
  foto: string | null;
  foto_estado: string;
  foto_motivo: string;
  alegra: Pieza;
  /** Despliegue gradual tras el cese: null si no hay despliegue; activo = volvió a la venta
   *  en MeLi y la web porque su SKU se factura (app/services/despliegue_ventas.py). */
  desplegado?: { activo: boolean; meli_ids?: string[]; desde?: string } | null;
  clasificacion: string;
  piezas: Record<ClavePieza, Pieza>;
  listas: number;
};

export type Familia = {
  clave: string;
  mp_sku: string;
  nombre: string;
  /** `pdf_nombre`: el PDF completo ya generado (aprobado), si existe; el botón lo abre directo. */
  documento: { estado: Estado; detalle: string; archivo: string; titulo: string; pdf_nombre?: string };
  presentaciones: Presentacion[];
  completas: number;
  total: number;
  desplegadas?: number;
  carpetas_png: string[];
};

export type Categoria = { nombre: string; familias: Familia[]; total: number; completas: number };

export type RespuestaArbol = {
  categorias: Categoria[];
  piezas: ClavePieza[];
  total: number;
  completas: number;
  desplegadas?: number;
  sin_senal: { fuente: string; error: string }[];
  generado: string;
};

export const PIEZAS: { clave: ClavePieza; nombre: string }[] = [
  { clave: "etiquetas", nombre: "Etiquetas" },
  { clave: "fotos", nombre: "Fotos" },
  { clave: "ean", nombre: "EAN" },
  { clave: "receta", nombre: "Receta" },
  { clave: "factura", nombre: "Factura" },
  { clave: "meli", nombre: "MeLi" },
  { clave: "web", nombre: "Web" },
];
export const TOTAL_PIEZAS = PIEZAS.length;

/** Qué pieza del taller resuelve cada hoja del árbol. «factura» no es del taller (se revisa en
 *  Canales del producto) y «fotos» se pega en la columna derecha, bajo su etiqueta. */
export function piezaTaller(p: Presentacion, clave: ClavePieza): string | null {
  if (clave === "etiquetas") return "etiqueta";
  if (clave === "ean") return "ean";
  if (clave === "receta") return p.piezas.receta.pieza_taller || "receta";
  if (clave === "meli" || clave === "web") return "publicacion";
  return null;
}

/** Clases del estilo pixel (arbol.css): bloque de estado y caja de una pieza. */
export const PUNTO: Record<Estado, string> = {
  ok: "ap-p ap-p-ok",
  aviso: "ap-p ap-p-aviso",
  falta: "ap-p ap-p-falta",
};
export const CAJA: Record<Estado, string> = {
  ok: "ap-ok",
  aviso: "ap-aviso",
  falta: "ap-falta",
};

export function peorEstado(estados: Estado[]): Estado {
  if (estados.includes("falta")) return "falta";
  if (estados.includes("aviso")) return "aviso";
  return "ok";
}

export function estadoFamilia(f: Familia): Estado {
  return peorEstado(f.presentaciones.flatMap((p) => Object.values(p.piezas).map((x) => x.estado)));
}

export function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function familiaCoincide(f: Familia, q: string): boolean {
  if (!q) return true;
  if (norm(f.nombre).includes(q) || norm(f.mp_sku).includes(q)) return true;
  return f.presentaciones.some(
    (p) => norm(p.nombre).includes(q) || norm(p.ref).includes(q) || (p.piezas.ean.codigo || "").includes(q),
  );
}

export function pesos(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return "$" + Math.round(Number(n)).toLocaleString("es-CO");
}
