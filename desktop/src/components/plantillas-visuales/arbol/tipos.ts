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
};

export type ClavePieza = "etiquetas" | "ean" | "receta" | "factura" | "meli" | "web";

export type Presentacion = {
  ref: string;
  nombre: string;
  corto: string;
  presentacion: string;
  precio_lista: number | null;
  foto: string | null;
  foto_estado: string;
  foto_motivo: string;
  alegra: Pieza;
  clasificacion: string;
  piezas: Record<ClavePieza, Pieza>;
  listas: number;
};

export type Familia = {
  clave: string;
  mp_sku: string;
  nombre: string;
  documento: { estado: Estado; detalle: string; archivo: string; titulo: string };
  presentaciones: Presentacion[];
  completas: number;
  total: number;
  carpetas_png: string[];
};

export type Categoria = { nombre: string; familias: Familia[]; total: number; completas: number };

export type RespuestaArbol = {
  categorias: Categoria[];
  piezas: ClavePieza[];
  total: number;
  completas: number;
  sin_senal: { fuente: string; error: string }[];
  generado: string;
};

export const PIEZAS: { clave: ClavePieza; nombre: string }[] = [
  { clave: "etiquetas", nombre: "Etiquetas" },
  { clave: "ean", nombre: "EAN" },
  { clave: "receta", nombre: "Receta" },
  { clave: "factura", nombre: "Factura" },
  { clave: "meli", nombre: "MeLi" },
  { clave: "web", nombre: "Web" },
];
export const TOTAL_PIEZAS = PIEZAS.length;

/** Qué pieza del taller resuelve cada hoja del árbol. «factura» no es del taller:
 *  se revisa en Canales del producto. */
export function piezaTaller(p: Presentacion, clave: ClavePieza): string | null {
  if (clave === "etiquetas") return "etiqueta";
  if (clave === "ean") return "ean";
  if (clave === "receta") return p.piezas.receta.pieza_taller || "receta";
  if (clave === "meli" || clave === "web") return "publicacion";
  return null;
}

export const PUNTO: Record<Estado, string> = {
  ok: "bg-accent-leaf",
  aviso: "bg-accent-sun",
  falta: "bg-accent-rose",
};
export const CAJA: Record<Estado, string> = {
  ok: "border-accent-leaf/60 bg-accent-leaf/10",
  aviso: "border-accent-sun/70 bg-accent-sun/15",
  falta: "border-accent-rose/60 bg-accent-rose/10",
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
