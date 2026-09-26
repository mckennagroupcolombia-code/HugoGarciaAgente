/**
 * El modelo de Colaboradores (igual al del backend, app/services/colaboradores.py): tipos,
 * plantillas de caja y utilidades. Desde el 26-sep-2026 hay UN solo estilo — el edificio pixel —
 * y las cajas son bloques libres: la «plantilla» solo precarga campos; toda caja admite los mismos
 * campos propios, su habitación, su ícono y su responsable.
 */
import type { SpriteId } from "./pixel";

export type Tipo = "accion" | "decision" | "entregable" | "dinero" | "externo" | "consenso" | "producto"
  | "competencia" | "proveedor" | "libre";
export type Carril = "mckenna" | "armando" | "sebastian" | "conjunto";
export type Moneda = "COP" | "USD" | "EUR";
export type Dinero = { monto: number; moneda: Moneda };
export type Dato = { campo: string; valor: string };
export type Consecuencia = { si: string; entonces: string; medida: string };
export type Adjunto = { id: string; nombre: string; tipo: "imagen" | "pdf" };
export type Variables = { como?: string; donde?: string; cuando?: string; porque?: string };
export type Propuesta = { id: string; autor?: number; texto: string };
export type Resuelto = { propuesta: string; modo: "acuerdo" | "turno" | "skill"; por?: number };
export type Componente = { nombre: string; sku?: string; cantidad?: string; costo?: Dinero; proveedor?: string };

/** Una caja: un bloque del edificio. Todo lo que no es id/título/plantilla es opcional. */
export type NodoDoc = {
  id: string; label: string; sublabel?: string; tipo: Tipo; carril: Carril; x: number; y: number;
  habitacion?: string; icono?: SpriteId; avatar?: string;
  imagen?: string; variables?: Variables; tiempo_min?: number; costo?: Dinero; precio?: Dinero;
  datos?: Dato[]; consecuencias?: Consecuencia[]; adjuntos?: Adjunto[]; enlaceApp?: string;
  asunto?: string; propuestas?: Propuesta[]; votos?: Record<string, string>; resuelto?: Resuelto;
  sku?: string; empaque?: { nombre: string; costo?: Dinero }; componentes?: Componente[];
  url?: string; plataforma?: string; entrega_dias?: number; fiabilidad?: number; skill?: string;
};
/** Una entrega (lo que antes era una flecha): un avatar lleva algo de una caja a otra. Los campos
 *  de dibujo de la flecha vieja (lados, color, grosor…) se conservan tal cual al guardar. */
export type EntregaDoc = {
  id: string; from: string; to: string; label?: string; portador?: string;
  fromLado?: string; toLado?: string; color?: string; grosor?: number; trazo?: string; forma?: string;
};
export type Doc = { nodes: NodoDoc[]; edges: EntregaDoc[] };

export type Habitacion = { id: string; nombre: string };
export type Piso = { id: string; nombre: string; color: string; habitaciones: Habitacion[] };
export type Avatar = {
  id: string; nombre: string; rol: string; skills: string[]; piso: string; color: string;
  carril: string | null; usuario_id: number | null;
};
export type Regla = { id: string; nombre: string; base: "costo" | "venta"; pct: number; para: string };
export type RepartoVenta = {
  moneda: string; total: number; costo: number; partes?: { id: string; nombre: string; para: string; monto: number }[];
  boveda?: number; boveda_nombre?: string; mckenna?: number; sin_sumar?: string[];
};
export type Operacion = {
  edificio: { pisos: Piso[] };
  ente: { nombre: string; campos: { nombre: string; valor: string }[] };
  avatares: Avatar[];
  reparto: { reglas: Regla[]; boveda: string };
  items: Record<string, { fase: "sourcing" | "ensamblado" | "en_mckenna" | "publicado"; unidades: number }>;
  ventas: { id: string; nodo: string; cantidad: number; fecha: string; reparto: RepartoVenta }[];
  resultados: Record<string, "bien" | "mal">;
  bitacora: { fecha: string; quien: string; texto: string }[];
};
export type Diagrama = {
  id: number; titulo: string; descripcion: string; version: number; doc: Doc;
  nodos: number; flechas: number; actualizado_en: string; actualizado_por: number | null;
  actualizado_por_nombre: string; archivado: number;
  turno_actual?: number | null; colaborador_id?: number | null; participantes?: Record<string, string>;
  obra?: { pisos: number; terminados: number; avance: number };
  operacion?: Operacion;
  dharma?: Record<string, number>;
};
export type Lista = { diagramas: Omit<Diagrama, "doc">[]; yo: { id: number; nombre: string } };
export type Version = { version: number; usuario: string; resumen: string; creado_en: string; nodos: number; flechas: number };

/** Las plantillas: con qué arranca una caja nueva. «Libre» no trae nada: se le crean sus campos. */
export const PLANTILLAS: { tipo: Tipo; label: string; icono: SpriteId; ayuda: string }[] = [
  { tipo: "libre", label: "Libre", icono: "bloques", ayuda: "Solo título y los campos que le crees" },
  { tipo: "accion", label: "Tarea", icono: "control", ayuda: "Quién, cómo, dónde, cuándo y por qué" },
  { tipo: "producto", label: "Producto", icono: "gema", ayuda: "SKU, receta con SKU hijos, precio y foto" },
  { tipo: "proveedor", label: "Proveedor", icono: "cofre", ayuda: "Entrega, fiabilidad y lo que vende" },
  { tipo: "consenso", label: "Decisión", icono: "urna", ayuda: "Propuestas, votos y desempate" },
  { tipo: "entregable", label: "Entregable", icono: "trofeo", ayuda: "Un resultado que se entrega" },
  { tipo: "dinero", label: "Dinero", icono: "moneda", ayuda: "Un pago, un costo o un precio" },
  { tipo: "externo", label: "Cliente o tercero", icono: "jugador", ayuda: "Alguien de fuera" },
  { tipo: "competencia", label: "Rival", icono: "bandera", ayuda: "Su publicación y su precio" },
  { tipo: "decision", label: "Acuerdo", icono: "estrella", ayuda: "Algo por definir entre los dos" },
];
export const plantillaDe = (t: Tipo) => PLANTILLAS.find((p) => p.tipo === t) ?? PLANTILLAS[0];

/** Íconos que se pueden poner a una caja (los mismos que acepta el servidor). */
export const ICONOS: SpriteId[] = ["bloques", "control", "gema", "cofre", "urna", "trofeo", "moneda", "bolsa", "jugador",
  "bandera", "estrella", "reloj", "datos", "doc", "foto", "alerta", "pulgar", "codigo", "ventana", "camion"];

export const COLORES_PISO = ["#5F574F", "#FFA300", "#1D2B53", "#7E2553", "#29ADFF", "#FFEC27", "#008751", "#AB5236", "#83769C", "#FF77A8"];
/** Tinta legible sobre el color de cada piso. */
export const TINTA_PISO: Record<string, string> = {
  "#FFA300": "#000", "#29ADFF": "#000", "#FFEC27": "#000", "#FF77A8": "#000", "#83769C": "#000",
};
export const COLORES_AVATAR = ["#b45309", "#1d4ed8", "#0f766e", "#7c3aed", "#b91c1c", "#15803d", "#374151"];

export const MONEDAS: Moneda[] = ["COP", "USD", "EUR"];
export const VARIABLES: { id: keyof Variables; label: string; ph: string }[] = [
  { id: "como", label: "Cómo", ph: "cómo se hace" },
  { id: "donde", label: "Dónde", ph: "dónde ocurre" },
  { id: "cuando", label: "Cuándo", ph: "cuándo o cada cuánto" },
  { id: "porque", label: "Por qué", ph: "por qué / para qué" },
];

export const nuevoId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function plata(d?: { monto: number; moneda: string } | null): string {
  if (!d) return "";
  return d.moneda === "COP" ? `$${Math.round(d.monto).toLocaleString("es-CO")}` : `${d.moneda} ${Math.round(d.monto).toLocaleString("es-CO")}`;
}
export function tiempoTexto(min?: number): string {
  if (!min) return "";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function urlValida(u?: string): boolean {
  return Boolean(u && /^https?:\/\/\S+$/i.test(u.trim()));
}
/** Lo que cuesta UNA unidad del producto (receta + empaque) en la moneda del precio. */
export function costoProducto(d: NodoDoc): Dinero | undefined {
  const moneda: Moneda = d.precio?.moneda ?? d.componentes?.find((c) => c.costo)?.costo?.moneda ?? "COP";
  const partes = [...(d.componentes ?? []).map((c) => c.costo), d.empaque?.costo].filter(
    (x): x is Dinero => Boolean(x && x.moneda === moneda));
  if (partes.length) return { monto: partes.reduce((s, x) => s + x.monto, 0), moneda };
  return d.costo;
}

/** Dónde va una caja que todavía no tiene habitación (cajas de antes del edificio): por lo que es. */
export function habitacionDe(n: NodoDoc, pisos: Piso[]): string {
  const todas = pisos.flatMap((p) => p.habitaciones.map((h) => h.id));
  if (n.habitacion && todas.includes(n.habitacion)) return n.habitacion;
  const preferida = ({
    proveedor: "proveedores", producto: "taller", consenso: "decisiones", decision: "decisiones",
    competencia: "tienda", externo: "tienda",
  } as Record<string, string>)[n.tipo]
    ?? ({ sebastian: "taller", armando: "estudio", mckenna: "boveda" } as Record<string, string>)[n.carril]
    ?? "sala";
  return todas.includes(preferida) ? preferida : todas[0] ?? "";
}

/** Combina lo editado aquí con lo que el otro guardó, sobre la versión de partida. */
export function combinar(base: Doc, local: Doc, remoto: Doc): Doc {
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function mezclar<T extends { id: string }>(b: T[], l: T[], r: T[]): T[] {
    const B = new Map(b.map((x) => [x.id, x])), L = new Map(l.map((x) => [x.id, x]));
    const out = new Map(r.map((x) => [x.id, x]));
    for (const [id, x] of L) {
      const enBase = B.get(id);
      if (!enBase || !igual(enBase, x)) out.set(id, x);          // nuevo o cambiado aquí: gana lo local
    }
    for (const [id, x] of B) {
      const remotoSinCambio = out.has(id) && igual(out.get(id), x);
      if (!L.has(id) && remotoSinCambio) out.delete(id);          // borrado aquí y el otro no lo tocó
    }
    return [...out.values()];
  }
  const nodes = mezclar(base.nodes, local.nodes, remoto.nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = mezclar(base.edges, local.edges, remoto.edges).filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}
