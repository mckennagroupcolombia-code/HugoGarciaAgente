/**
 * El barrio de McKenna: las tres casas reales, sus cuartos, sus muebles y los puestos donde
 * trabaja cada quien. Unidades del mundo: 1 = una baldosa (≈ 2 m; la escala del kit de muebles
 * y del kit de carros de Kenney). x crece hacia el oriente, z hacia la calle (hacia la cámara).
 *
 * - Búnker Suba: casa de Armando y Cynthia. Gerencia, contabilidad y el estudio de diseño.
 * - Sede McKenna Sur: casa de Victor y Stella. Oficina (alistar, empacar, responder), bodega,
 *   patio de recepción (llegan los camiones de los proveedores) y portón (los mensajeros).
 * - Tienda digital: donde los clientes de MeLi y WhatsApp llegan a preguntar.
 *
 * Quién vive en qué casa y con qué avatar está en app/data/empresa_viva_casas.json (llega en
 * el estado del servidor); aquí solo está la forma del barrio.
 */
import { ubicacionDe } from "../../lib/flujoApp";
import type { Panel } from "../../stores/app";

export type CasaId = "bunker" | "sede" | "tienda";
export type LugarId =
  | "gerencia" | "contabilidad" | "estudio" | "cuarto_bunker_1" | "cuarto_bunker_2"
  | "oficina_sede" | "bodega" | "recepcion" | "porton" | "hongos" | "cuarto_sede_1" | "cuarto_sede_2"
  | "tienda";
export type Animacion = "sit" | "idle" | "interact-right" | "pick-up" | "holding-both" | "walk";

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Puesto { x: number; z: number; /** hacia dónde mira, grados (0 = hacia la calle) */ rot: number; anim: Animacion }
export interface Mueble { m: string; x: number; z: number; rot?: number; s?: number }

export interface Lugar {
  id: LugarId;
  casa: CasaId;
  titulo: string;
  hace: string;
  rect: Rect;
  piso: string;
  /** Al aire libre: sin piso de madera ni muros. */
  afuera?: boolean;
  puestos: Puesto[];
  muebles: Mueble[];
  /** Panel que se abre al tocar el lugar. */
  panel: Panel;
  /** Etapas del Mapa cuyo «detenido» se apila aquí. */
  etapas: string[];
  /** Puerta del cuarto (para caminar por dentro de la casa sin atravesar muros). */
  puerta: { x: number; z: number };
}

export interface Casa {
  id: CasaId;
  titulo: string;
  lote: Rect;
  casa: Rect;
  /** Puerta de la casa, por fuera (en el antejardín) y por dentro. */
  puertaFuera: { x: number; z: number };
  puertaDentro: { x: number; z: number };
  muro: string;
  cesped: string;
  /** Techo: «teja» (dos aguas, teja de barro) o «plano» (moderno, con antepecho). */
  techo: "teja" | "plano";
  /** Color del techo / detalles (marcos de ventana, toldo). */
  acento: string;
}

export const CALLE = { z0: 9.2, z1: 12.4 };
export const ANDEN_Z = 8.7;
export const CARRIL_IDA = 11.6;   // hacia el oriente (la tienda, la sede)
export const CARRIL_VUELTA = 10.0;
export const LIMITE = { x0: -36, x1: 36, z0: -15, z1: 20 };

export const CASAS: Casa[] = [
  { id: "bunker", titulo: "Búnker Suba", lote: { x0: -31, z0: -12, x1: -13, z1: 8.2 }, casa: { x0: -29, z0: -9, x1: -15, z1: 1 },
    puertaFuera: { x: -21.5, z: 2.2 }, puertaDentro: { x: -21.5, z: 0.2 }, muro: "#E9E4DA", cesped: "#7BC96F",
    techo: "plano", acento: "#4A5568" },
  { id: "sede", titulo: "Sede McKenna Sur", lote: { x0: -11, z0: -12, x1: 13.5, z1: 8.2 }, casa: { x0: -9, z0: -9, x1: 7, z1: 1 },
    puertaFuera: { x: -5, z: 2.2 }, puertaDentro: { x: -5, z: 0.2 }, muro: "#F4E3C3", cesped: "#86CF74",
    techo: "teja", acento: "#C8553D" },
  { id: "tienda", titulo: "Tienda digital", lote: { x0: 15.5, z0: -12, x1: 31, z1: 8.2 }, casa: { x0: 17, z0: -7, x1: 29, z1: 1 },
    puertaFuera: { x: 23, z: 2.2 }, puertaDentro: { x: 23, z: 0.2 }, muro: "#FFF3D6", cesped: "#7BC96F",
    techo: "plano", acento: "#2D9CDB" },
];
export const CASA = Object.fromEntries(CASAS.map((c) => [c.id, c])) as Record<CasaId, Casa>;

// Atajos para escribir muebles: escritorio con su silla y su pantalla, mirando a la calle.
const escritorio = (x: number, z: number): Mueble[] => [
  { m: "muebles/desk", x, z },
  { m: "muebles/computerScreen", x: x + 0.12, z: z - 0.12 },
  { m: "muebles/chairDesk", x, z: z + 0.45, rot: 180 },
];
const sentado = (x: number, z: number): Puesto => ({ x, z: z + 0.42, rot: 180, anim: "sit" });

export const LUGARES: Lugar[] = [
  // ── Búnker Suba ──
  {
    id: "cuarto_bunker_1", casa: "bunker", titulo: "Cuarto", hace: "Descanso", rect: { x0: -29, z0: -9, x1: -24, z1: -4 },
    piso: "#C99E6E", panel: "hugo", etapas: [], puerta: { x: -26.5, z: -3.6 },
    muebles: [{ m: "muebles/bedDouble", x: -27.4, z: -7.6 }, { m: "muebles/cabinetBedDrawer", x: -25.8, z: -8.6 },
              { m: "muebles/rugRound", x: -26, z: -6 }, { m: "muebles/lampRoundFloor", x: -28.6, z: -5 }],
    puestos: [{ x: -27.2, z: -6.4, rot: 0, anim: "sit" }, { x: -26, z: -5.6, rot: 30, anim: "idle" }],
  },
  {
    id: "cuarto_bunker_2", casa: "bunker", titulo: "Cuarto", hace: "Descanso", rect: { x0: -24, z0: -9, x1: -20, z1: -4 },
    piso: "#D4A979", panel: "hugo", etapas: [], puerta: { x: -22, z: -3.6 },
    muebles: [{ m: "muebles/bedSingle", x: -22.8, z: -7.8 }, { m: "muebles/pottedPlant", x: -20.6, z: -8.5 },
              { m: "muebles/rugRectangle", x: -22, z: -5.8 }],
    puestos: [{ x: -22.6, z: -6.6, rot: 0, anim: "sit" }, { x: -21.5, z: -5.6, rot: -20, anim: "idle" }],
  },
  {
    id: "estudio", casa: "bunker", titulo: "Estudio de diseño", hace: "Etiquetas, fichas, combos, fotos y publicaciones",
    rect: { x0: -20, z0: -9, x1: -15, z1: -4 }, piso: "#E6D3B3", panel: "etiquetas", etapas: ["preparar", "publicar"],
    puerta: { x: -17.5, z: -3.6 },
    muebles: [...escritorio(-18.8, -7.6), ...escritorio(-16.6, -7.6), { m: "muebles/bookcaseOpen", x: -15.5, z: -5.5, rot: -90 },
              { m: "muebles/plantSmall1", x: -19.6, z: -8.6 }],
    puestos: [sentado(-18.8, -7.6), sentado(-16.6, -7.6), { x: -17.6, z: -5.2, rot: 0, anim: "interact-right" }],
  },
  {
    id: "gerencia", casa: "bunker", titulo: "Gerencia", hace: "Dirigir la empresa y administrar la aplicación",
    rect: { x0: -29, z0: -4, x1: -22, z1: 1 }, piso: "#B98B5E", panel: "mapa-sistema", etapas: ["dirigir"],
    puerta: { x: -23, z: -1.5 },
    muebles: [...escritorio(-26.8, -2.8), { m: "muebles/bookcaseClosedWide", x: -28.4, z: -3.6 },
              { m: "muebles/loungeSofa", x: -24.2, z: -3.6 }, { m: "muebles/rugRectangle", x: -25.5, z: -1 },
              { m: "muebles/pottedPlant", x: -28.5, z: 0.4 }],
    puestos: [sentado(-26.8, -2.8), { x: -24.4, z: -2.9, rot: 0, anim: "sit" }],
  },
  {
    id: "contabilidad", casa: "bunker", titulo: "Contabilidad", hace: "Pagos, facturas, Libro Mayor e impuestos",
    rect: { x0: -22, z0: -4, x1: -15, z1: 1 }, piso: "#D9C4A0", panel: "contabilidad-inicio", etapas: ["abastecer", "facturar", "contar"],
    puerta: { x: -21, z: -1.5 },
    muebles: [...escritorio(-20, -2.8), ...escritorio(-17.6, -2.8), { m: "muebles/bookcaseOpen", x: -15.5, z: -2, rot: -90 },
              { m: "muebles/bookcaseOpen", x: -15.5, z: -1.2, rot: -90 }, { m: "muebles/table", x: -18.8, z: -0.3 }],
    puestos: [sentado(-20, -2.8), sentado(-17.6, -2.8), { x: -18.8, z: 0.3, rot: 180, anim: "interact-right" }],
  },

  // ── Sede McKenna Sur ──
  {
    id: "cuarto_sede_1", casa: "sede", titulo: "Cuarto", hace: "Descanso", rect: { x0: -9, z0: -9, x1: -5, z1: -4 },
    piso: "#C99E6E", panel: "hugo", etapas: [], puerta: { x: -7, z: -3.6 },
    muebles: [{ m: "muebles/bedSingle", x: -7.8, z: -7.8 }, { m: "muebles/televisionModern", x: -5.6, z: -8.6 },
              { m: "muebles/rugRound", x: -7, z: -6 }],
    puestos: [{ x: -7.6, z: -6.6, rot: 0, anim: "sit" }, { x: -6.4, z: -5.6, rot: 20, anim: "idle" }],
  },
  {
    id: "cuarto_sede_2", casa: "sede", titulo: "Cuarto", hace: "Descanso", rect: { x0: -5, z0: -9, x1: -1, z1: -4 },
    piso: "#D4A979", panel: "hugo", etapas: [], puerta: { x: -3, z: -3.6 },
    muebles: [{ m: "muebles/bedSingle", x: -3.8, z: -7.8 }, { m: "muebles/radio", x: -1.6, z: -8.6 },
              { m: "muebles/pottedPlant", x: -1.5, z: -5 }, { m: "muebles/rugRectangle", x: -3, z: -5.8 }],
    puestos: [{ x: -3.6, z: -6.6, rot: 0, anim: "sit" }, { x: -2.5, z: -5.6, rot: -20, anim: "idle" }],
  },
  {
    id: "oficina_sede", casa: "sede", titulo: "Oficina de la sede", hace: "Responder clientes, alistar y empacar los pedidos",
    rect: { x0: -9, z0: -4, x1: -1, z1: 1 }, piso: "#D9C4A0", panel: "empaque", etapas: ["entregar"],
    puerta: { x: -2, z: -1.5 },
    muebles: [...escritorio(-8, -2.9), ...escritorio(-6, -2.9),
              { m: "muebles/table", x: -3.6, z: -2.4 }, { m: "muebles/table", x: -3.6, z: -1.1 },
              { m: "muebles/cardboardBoxOpen", x: -3.9, z: -2.5 }, { m: "muebles/cardboardBoxClosed", x: -3.3, z: -1.2 },
              // La cocina del equipo (Victor hace el almuerzo).
              { m: "muebles/kitchenFridgeLarge", x: -1.5, z: -3.6 }, { m: "muebles/kitchenStove", x: -2.3, z: -3.65 },
              { m: "muebles/kitchenSink", x: -2.95, z: -3.65 }, { m: "muebles/kitchenCoffeeMachine", x: -2.95, z: -3.7 }],
    puestos: [sentado(-8, -2.9), sentado(-6, -2.9), { x: -3.6, z: -1.65, rot: 180, anim: "interact-right" },
              { x: -2.4, z: -1.8, rot: -90, anim: "pick-up" }, { x: -7, z: -0.4, rot: 180, anim: "interact-right" }],
  },
  {
    id: "bodega", casa: "sede", titulo: "Bodega", hace: "Existencias: lo que hay, lo crítico y lo que hay que reponer",
    rect: { x0: -1, z0: -9, x1: 7, z1: 1 }, piso: "#BFB6A8", panel: "control-inventario", etapas: [],
    puerta: { x: 0, z: -1.5 },
    // Los estantes y sus cajas se dibujan aparte (escena.ts): cuántas cajas hay depende del stock.
    muebles: [],
    puestos: [{ x: 1.4, z: -5.2, rot: 180, anim: "pick-up" }, { x: 4.2, z: -5.2, rot: 180, anim: "pick-up" },
              { x: 2.8, z: -1.6, rot: 180, anim: "holding-both" }],
  },
  {
    id: "recepcion", casa: "sede", titulo: "Recepción de mercancía", hace: "Llegan los camiones de los proveedores: se cuenta y se registra",
    rect: { x0: 7, z0: -9, x1: 13, z1: 1 }, piso: "#A9A9A9", afuera: true, panel: "recepcion-mercancia", etapas: [],
    puerta: { x: 7.4, z: -4 },
    muebles: [{ m: "muebles/cardboardBoxClosed", x: 7.8, z: -8.4 }, { m: "muebles/cardboardBoxClosed", x: 8.1, z: -8.4 }],
    puestos: [{ x: 8.6, z: -3, rot: 90, anim: "holding-both" }, { x: 8.6, z: -1.6, rot: 90, anim: "interact-right" }],
  },
  {
    id: "porton", casa: "sede", titulo: "Portón de despacho", hace: "Los mensajeros recogen los paquetes alistados",
    rect: { x0: -9, z0: 1, x1: -1, z1: 7 }, piso: "#B5B0A6", afuera: true, panel: "entregas-flex", etapas: [],
    puerta: { x: -5, z: 1.6 },
    muebles: [],
    puestos: [{ x: -2.2, z: 5.6, rot: 90, anim: "holding-both" }],
  },

  {
    id: "hongos", casa: "sede", titulo: "Cultivo de hongos", hace: "La línea de hongos: camas de cultivo y cosecha",
    rect: { x0: 0.5, z0: 2.6, x1: 6.5, z1: 7.2 }, piso: "#8C6A4A", afuera: true, panel: "control-inventario", etapas: [],
    puerta: { x: 0.8, z: 4.9 },
    // Las camas y los hongos se arman en escena.ts (no hay hongos en los packs).
    muebles: [],
    puestos: [{ x: 2.2, z: 4.3, rot: 180, anim: "pick-up" }, { x: 4.8, z: 4.3, rot: 180, anim: "pick-up" }],
  },

  // ── Tienda digital ──
  {
    id: "tienda", casa: "tienda", titulo: "Tienda digital", hace: "Preguntas de MercadoLibre y clientes de WhatsApp",
    rect: { x0: 17, z0: -7, x1: 29, z1: 1 }, piso: "#F3E3C3", panel: "preventa", etapas: ["vender"],
    puerta: { x: 23, z: 0.2 },
    muebles: [
      ...[19, 20, 21, 22, 24, 25, 26, 27].map((x): Mueble => ({ m: "muebles/kitchenBar", x, z: -2.2 })),
      { m: "muebles/kitchenBarEnd", x: 18.2, z: -2.2 }, { m: "muebles/kitchenBarEnd", x: 27.8, z: -2.2, rot: 180 },
      { m: "muebles/laptop", x: 20, z: -2.25 }, { m: "muebles/laptop", x: 22, z: -2.25 }, { m: "muebles/laptop", x: 25, z: -2.25 },
      { m: "muebles/bookcaseOpen", x: 18.5, z: -6.6 }, { m: "muebles/bookcaseOpen", x: 20, z: -6.6 },
      { m: "muebles/bookcaseOpen", x: 26, z: -6.6 }, { m: "muebles/bookcaseOpen", x: 27.5, z: -6.6 },
      { m: "muebles/pottedPlant", x: 17.6, z: 0.3 }, { m: "muebles/pottedPlant", x: 28.4, z: 0.3 },
      { m: "muebles/rugRectangle", x: 23, z: -0.6 },
    ],
    puestos: [{ x: 20, z: -3, rot: 0, anim: "interact-right" }, { x: 22, z: -3, rot: 0, anim: "interact-right" },
              { x: 25, z: -3, rot: 0, anim: "interact-right" }, { x: 26.6, z: -3, rot: 0, anim: "interact-right" },
              { x: 18.8, z: -4.4, rot: 0, anim: "idle" }],
  },
];
export const LUGAR = Object.fromEntries(LUGARES.map((l) => [l.id, l])) as Record<LugarId, Lugar>;

/** Hugo atiende en la tienda, en el centro del mostrador. */
export const HUGO_PUESTO = { x: 23.5, z: -3.1, rot: 0 };
/** Fila de clientes: de la puerta de la tienda hacia el andén y por el andén hacia el occidente. */
export function puestoFila(i: number): { x: number; z: number } {
  if (i < 3) return { x: 23 + (i % 2 ? 0.25 : -0.25), z: 1.4 + i * 0.85 };
  return { x: 22.4 - (i - 3) * 0.75, z: ANDEN_Z + (i % 2) * 0.15 };
}
/** Mostrador por dentro: cliente frente a quien lo atiende. */
export const MOSTRADOR_CLIENTE = { x: 23, z: -1.4 };

/** Bodega: 3 filas de estantes con 6 estantes cada una. */
export const ESTANTES = { filas: [-7.9, -6.1, -3.4], x0: -0.4, paso: 1.2, porFila: 6 };

/** Mesa de paquetes alistados en el portón, y paquetes por alistar en la oficina. */
export function puestoPaqueteAlistado(i: number) {
  const col = i % 6, fila = Math.floor(i / 6);
  return { x: -8.3 + col * 0.42, z: 3.2 + fila * 0.42 };
}
export function puestoPaquetePorAlistar(i: number) {
  const col = i % 6, fila = Math.floor(i / 6);
  return { x: -8.5 + col * 0.36, z: -0.9 + fila * 0.36, y: 0 };
}
export const MENSAJERO_PARQUEO = { x: -5, z: CARRIL_VUELTA };
export const CAMION_PROVEEDOR_PARQUEO = { x: 10.2, z: -4.2 };
export const ENTRADA_RECEPCION = { x: 10.2, z: CARRIL_IDA };

/** Paneles que la etapa no ubica bien en el barrio. */
const PRECISIONES: Partial<Record<string, LugarId>> = {
  "recepcion-mercancia": "recepcion", "logistica-proveedores": "contabilidad", "logistica-importaciones": "contabilidad",
  "logistica-embarques": "contabilidad", "logistica-aduanas": "contabilidad", "logistica-seguimiento": "contabilidad",
  "compras-exterior": "contabilidad",
  stock: "bodega", "control-inventario": "bodega", bultos: "bodega", insumos: "bodega",
  pedidos: "oficina_sede", empaque: "oficina_sede", "guias-envio": "oficina_sede", "revision-empaque": "oficina_sede",
  "entregas-flex": "porton",
  publicaciones: "estudio", "canales-producto": "estudio", formulas: "estudio", ideas: "estudio",
  postventa: "tienda",
};
const POR_ETAPA: Record<string, LugarId> = {
  abastecer: "contabilidad", preparar: "estudio", publicar: "estudio", vender: "tienda",
  entregar: "oficina_sede", facturar: "contabilidad", contar: "contabilidad", dirigir: "gerencia",
};

/** A qué lugar va quien tiene abierto este panel. `null` = no es trabajo de un lugar
 *  (Agenda, mensajes, el Mapa, el juego): se queda en su sitio de siempre. */
export function lugarDePanel(panel: string): LugarId | null {
  const p = PRECISIONES[panel];
  if (p) return p;
  const etapa = ubicacionDe(panel as Panel)?.etapa.id;
  return (etapa && POR_ETAPA[etapa]) || null;
}

export function casaDeLugar(l: LugarId): CasaId {
  return LUGAR[l].casa;
}

// ─── Lo que se hace con las manos (cronómetro de tareas) ─────────────────────

export interface Parada { x: number; z: number; rot: number; anim: Animacion }
/** Dónde y cómo se ve cada función del catálogo de rendimiento (app/services/rendimiento.py).
 *  `ronda` = la persona va y viene entre esos puntos (alistar entre estantes, hacer el aseo).
 *  Sin `lugar`: la tarea es de escritorio y se hace en el puesto de siempre de esa persona. */
export const TAREA: Record<string, { lugar?: LugarId; corto: string; parada?: Parada; ronda?: Parada[]; anim?: Animacion }> = {
  almuerzo: { lugar: "oficina_sede", corto: "Cocinando", parada: { x: -2.3, z: -3.05, rot: 180, anim: "interact-right" } },
  desayuno: { lugar: "oficina_sede", corto: "Preparando el desayuno", parada: { x: -2.3, z: -3.05, rot: 180, anim: "interact-right" } },
  empacar: { lugar: "oficina_sede", corto: "Empacando", parada: { x: -4.4, z: -0.45, rot: 180, anim: "interact-right" } },
  embalar: { lugar: "oficina_sede", corto: "Embalando", parada: { x: -3.0, z: -0.6, rot: 180, anim: "pick-up" } },
  lote: { lugar: "oficina_sede", corto: "Poniendo fecha y lote", parada: { x: -4.2, z: -1.65, rot: 180, anim: "interact-right" } },
  imprimir_et: { lugar: "oficina_sede", corto: "Imprimiendo etiquetas", parada: { x: -6, z: -2.48, rot: 180, anim: "sit" } },
  guias: { lugar: "oficina_sede", corto: "Imprimiendo guías", parada: { x: -8, z: -2.48, rot: 180, anim: "sit" } },
  cuaderno: { lugar: "oficina_sede", corto: "Anotando guías", parada: { x: -8, z: -2.48, rot: 180, anim: "sit" } },
  alistar: { lugar: "bodega", corto: "Alistando pedidos", ronda: [
    { x: 0.8, z: -5.2, rot: 180, anim: "pick-up" }, { x: 3.2, z: -7.0, rot: 180, anim: "pick-up" },
    { x: 5.4, z: -4.8, rot: 180, anim: "pick-up" }, { x: 2.0, z: -2.4, rot: 180, anim: "holding-both" },
  ] },
  envasar: { lugar: "bodega", corto: "Envasando", parada: { x: 2.8, z: -1.6, rot: 180, anim: "interact-right" } },
  preparar: { lugar: "bodega", corto: "Preparando fórmulas", parada: { x: 4.6, z: -1.6, rot: 180, anim: "interact-right" } },
  compras: { lugar: "bodega", corto: "Revisando el stock", ronda: [
    { x: 1.4, z: -5.2, rot: 180, anim: "idle" }, { x: 4.2, z: -7.0, rot: 180, anim: "idle" },
  ] },
  aseo: { lugar: "bodega", corto: "Haciendo el aseo", ronda: [
    { x: 0.4, z: -2.0, rot: 90, anim: "walk" }, { x: 6.2, z: -2.0, rot: 90, anim: "walk" },
    { x: 6.2, z: -8.4, rot: 0, anim: "walk" }, { x: 0.4, z: -8.4, rot: -90, anim: "walk" },
  ] },
  envio: { lugar: "porton", corto: "Llevando envíos", parada: { x: -3, z: 6.2, rot: 180, anim: "holding-both" } },
  hongos: { lugar: "hongos", corto: "Cuidando los hongos", parada: { x: 2.2, z: 4.3, rot: 180, anim: "pick-up" } },
  clientes: { lugar: "tienda", corto: "Atendiendo clientes" },
  meli_qa: { lugar: "tienda", corto: "Respondiendo en MeLi" },
  facturar: { corto: "Facturando" },
  nc: { corto: "Notas crédito" },
  aprobar: { lugar: "gerencia", corto: "Aprobando pagos" },
  sol_pago: { lugar: "contabilidad", corto: "Solicitudes de pago" },
  contab: { lugar: "contabilidad", corto: "Libro Mayor" },
  analisis: { lugar: "gerencia", corto: "Analizando el negocio" },
  exterior: { lugar: "contabilidad", corto: "Compras al exterior" },
  diseno: { lugar: "estudio", corto: "Diseñando etiquetas" },
  docs: { lugar: "estudio", corto: "Fichas técnicas" },
  publica: { lugar: "estudio", corto: "Publicando" },
  catalogo: { lugar: "estudio", corto: "Armando combos" },
};

/** Dónde se toma el café en cada casa (las pausas cortas de quien trabaja). */
export const CAFE: Record<CasaId, { lugar: LugarId; x: number; z: number; rot: number }> = {
  bunker: { lugar: "gerencia", x: -24.2, z: -2.2, rot: 0 },
  sede: { lugar: "oficina_sede", x: -2.95, z: -3.0, rot: 180 },
  tienda: { lugar: "tienda", x: 18.8, z: -4.6, rot: 0 },
};
