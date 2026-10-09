/**
 * Lo que manda el servidor (/api/empresa-viva/estado y /api/empresa-viva/jugador) y la forma del
 * barrio que arma scripts/empresa_viva/armar_mapa.py (public/empresa/pixel/mapa.json).
 */

// ─── /api/empresa-viva/estado (app/services/empresa_viva.py) ─────────────────

import type { LoteMapa } from "./vecindario";

export type Por = { id: number | null; nombre: string; bot?: boolean } | null;

/** El avatar en pixel art: piezas del catálogo LPC (public/empresa/pixel/personajes/personajes.json)
 *  y sus paletas. Lo valida el servidor (tickets_db._limpiar_avatar_empresa). */
export interface AvatarPixel {
  cuerpo: "hombre" | "mujer";
  piel: string;
  ojos: string;
  pelo: string;
  color_pelo: string;
  barba: string;
  torso: string;
  color_torso: string;
  piernas: string;
  color_piernas: string;
  zapatos: string;
  color_zapatos: string;
  delantal: string;
  color_delantal: string;
  gafas: string;
}
export interface AvatarElegido { pixel?: AvatarPixel | null; color?: string; avatar?: string; accesorio?: string }

export interface PersonaApi {
  id: number; nombre: string; username: string; en_linea: boolean; panel: string; via: "panel" | "whatsapp" | "";
  avatar?: AvatarElegido | null; funciones?: string[];
  /** Tarea con cronómetro andando (lo que hace con las manos ahora). */
  tarea?: { funcion: string; hace: string; titulo: string; ticket_id: number; desde: string } | null;
  /** En el panel, por WhatsApp o con un cronómetro andando. */
  presente?: boolean;
}
export interface AccionApi {
  id: string; tipo: "creo" | "comento" | "adjunto" | "midio" | "resolvio" | "en_proceso" | "reporto" | "zumbido";
  de: number; ts: number; ticket_id: number; titulo: string;
}
export interface InteraccionApi {
  /** «chat» = mensaje del chat directo de dos (solo lo reciben ellos). */
  id: string; tipo: "pregunta" | "solicitud" | "respuesta" | "grupo" | "idea" | "chat"; de: number; para: number[]; todos?: boolean;
  ts: number; texto: string; canal?: string; canal_id?: number; ticket_id?: number;
}
export interface VisitanteApi {
  id: string; tipo: "preventa" | "whatsapp"; desde: string; producto: string; texto: string; panel: string; puede: boolean;
}
export interface PaqueteApi {
  id: string; canal: "meli" | "web" | "whatsapp"; flex: boolean; estado: "por_alistar" | "alistado" | "en_ruta";
  desde: string; unidades: number; producto: string; lugar: string; alistado_por: Por; panel: string; puede: boolean;
}
export interface ProveedorApi {
  id: string; estado: "descargando" | "registrado"; proveedor: string; items: number; recibe: Por; desde: string;
  panel: string; puede: boolean;
}
export interface Detenido { id: string; n: number; texto: string; panel: string; severidad: string }
export interface EventoApi { seq: number; ts: number; tipo: string; objeto: string; por: Por }
export interface ConfigCasas {
  usuarios: Record<string, { vive?: string; cuarto?: string; trabaja?: string; pixel?: Partial<AvatarPixel>; rol?: string }>;
  clientes?: Partial<AvatarPixel>[];
  proveedor?: Partial<AvatarPixel>;
  mensajero?: Partial<AvatarPixel>;
}
export interface Reponer { sku: string; nombre: string; estado: "agotado" | "critico"; stock: number | null }
export interface EstadoEmpresa {
  yo: number;
  personas: PersonaApi[];
  casas: ConfigCasas;
  visitantes: VisitanteApi[];
  visitantes_mas: number;
  paquetes: PaqueteApi[];
  paquetes_mas: number;
  proveedores: ProveedorApi[];
  bodega: { publicaciones: number; agotados: number; criticos: number; por_reponer?: Reponer[]; panel: string } | null;
  oficina: Record<string, { alta: number; media: number; items: Detenido[] }>;
  eventos: EventoApi[];
  interacciones?: InteraccionApi[];
  acciones?: AccionApi[];
  sin_senal: { fuente: string; error: string }[];
  generado: string;
  hora?: string;
}

// ─── /api/empresa-viva/jugador: quién más anda jugando ──────────────────────

export type Dir = "arriba" | "abajo" | "izquierda" | "derecha";
export type Pose = "quieto" | "camina" | "corre" | "sentado" | "celebra";
export interface JugadorApi { id: number; x: number; y: number; dir: Dir; pose: Pose; t: number; modulo?: string }
export interface RespuestaJugador { jugadores: JugadorApi[]; ahora: number }

// ─── public/empresa/pixel/mapa.json ──────────────────────────────────────────

export interface PuestoMapa { x: number; y: number; dir: Dir; pose: "sentado" | "parado" }
export interface LugarMapa {
  casa: string; titulo: string; hace: string; panel: string; etapas: string[];
  rect: [number, number, number, number]; afuera: boolean; puestos: PuestoMapa[];
  /** Dónde va el nombre del cuarto (en la cara del muro norte, o a la entrada del patio). */
  rotulo?: { x: number; y: number };
}
/** El objeto de un módulo de la app en el barrio (o el directorio de una casa). */
export interface EstacionMapa {
  panel: string; icono: string; x: number; y: number; z: number; lugar: string;
  uso: { x: number; y: number; dir: Dir; pose: "sentado" | "parado" };
  tipo: "modulo" | "directorio" | "ajedrez" | "trofeos" | "tenis" | "lote"; casa?: string;
  /** Para `tipo: "lote"`: el terreno del vecindario de ese letrero. */
  lote?: string;
}
export interface TechoMapa {
  archivo: string; x: number; y: number; w: number; h: number; base_y: number;
  letrero: { x: number; y: number; texto: string };
}
export interface CasaMapa { titulo: string; rect: [number, number, number, number]; puerta: { x: number; y: number }; techo: TechoMapa }
export interface PuntoMapa { x: number; y: number; dir: Dir; columnas?: number; paso?: number; sobre?: number; filas?: number; alto_fila?: number }
export interface MuebleMapa { f: string; x: number; y: number; zbase?: number; z?: number }
export interface Mapa {
  ancho: number; alto: number; baldosa: number; celda: number;
  /** HD-2D: cuántas veces más píxeles trae el arte (2) y los trozos del suelo (en px del mundo). */
  hd?: number;
  suelo?: { archivo: string; x: number; y: number; w: number; h: number }[];
  calle: { vuelta_y: number; ida_y: number };
  lugares: Record<string, LugarMapa>;
  casas: Record<string, CasaMapa>;
  puntos: Record<string, PuntoMapa> & { fila?: { puntos: { x: number; y: number }[] } };
  pilas: Record<string, { x: number; y: number }>;
  muebles: MuebleMapa[];
  estantes: { x: number; y: number; z: number }[];
  estaciones: EstacionMapa[];
  solido: string[];
  hugo: { archivo: string; cuadro: [number, number]; ancla: [number, number] };
  /** Los terrenos del vecindario (vecindario.ts; el dueño y su casa llegan del servidor). */
  lotes?: LoteMapa[];
}

// ─── Lo que se toca en el juego ──────────────────────────────────────────────

/** Lo que el jugador tiene enfrente al pulsar A (o lo que tocó con el dedo). */
export type Examinable =
  | { tipo: "persona"; datos: PersonaApi; lugar: string; rol?: string; jugando: boolean }
  | { tipo: "visitante"; datos: VisitanteApi }
  | { tipo: "paquete"; datos: PaqueteApi }
  | { tipo: "proveedor"; datos: ProveedorApi }
  | { tipo: "hugo" }
  | { tipo: "mensajero"; alistados: number }
  | { tipo: "lugar"; lugar: string }
  /** El objeto de un módulo de la app (el Libro Mayor en la biblioteca, Facturación en un escritorio…). */
  | { tipo: "modulo"; panel: string; lugar: string }
  /** El directorio de la entrada de una casa. */
  | { tipo: "directorio"; casa: string }
  /** La mesa de ajedrez del parque (minijuego entre dos: Ajedrez.tsx). */
  | { tipo: "ajedrez" }
  /** La cancha de tenis del parque (minijuego en equipo: Tenis.tsx). */
  | { tipo: "tenis" }
  /** El letrero de un terreno del vecindario (comprar, construir, decorar: Casa.tsx). */
  | { tipo: "lote"; lote: string }
  /** La repisa de trofeos al lado de la cama de un cuarto (`lugar` = el cuarto). */
  | { tipo: "trofeos"; lugar: string };
