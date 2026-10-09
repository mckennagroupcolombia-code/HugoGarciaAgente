/**
 * El barrio de McKenna: qué lugar corresponde a cada panel de la app y dónde se hace cada tarea
 * con las manos. Las coordenadas (cuartos, puestos, puntos) NO están aquí: salen de mapa.json, que
 * arma scripts/empresa_viva/armar_mapa.py junto con el dibujo, para que nunca se desalineen.
 *
 * - Búnker Suba: casa de Armando y Cynthia. Gerencia, contabilidad y el estudio de diseño.
 * - Sede McKenna Sur: casa de Victor y Stella. Oficina con cocina (alistar, empacar, responder),
 *   bodega, patio de recepción (los proveedores), portón (los mensajeros) y el cultivo de hongos.
 * - Tienda digital: donde los clientes de MeLi y WhatsApp llegan a preguntar.
 *
 * Quién vive en qué casa, su cuarto, dónde trabaja y su avatar por defecto están en
 * app/data/empresa_viva_casas.json (llega en el estado del servidor).
 */
import { ETAPAS_APP, FUERA_DEL_FLUJO, ORIGEN_APP, ubicacionDe } from "../../lib/flujoApp";
import { PANEL_INFO } from "../../lib/panelInfo";
import { COLOR } from "../mapaComun";
import type { Panel } from "../../stores/app";

export type LugarId =
  | "gerencia" | "contabilidad" | "estudio" | "cuarto_bunker_1" | "cuarto_bunker_2"
  | "oficina_sede" | "bodega" | "recepcion" | "porton" | "hongos" | "cuarto_sede_1" | "cuarto_sede_2"
  | "tienda" | "sistemas";
export type CasaId = "bunker" | "sede" | "tienda";

/** Paneles que la etapa no ubica bien en el barrio. */
const PRECISIONES: Partial<Record<string, LugarId>> = {
  "recepcion-mercancia": "recepcion", facturas: "contabilidad", pagos: "contabilidad", "creditos-adquiridos": "contabilidad",
  stock: "bodega", "control-inventario": "bodega", bultos: "bodega", insumos: "bodega",
  pedidos: "oficina_sede", empaque: "oficina_sede", "guias-envio": "oficina_sede", "revision-empaque": "oficina_sede",
  "entregas-flex": "porton",
  publicaciones: "estudio", "canales-producto": "estudio", formulas: "estudio", ideas: "estudio",
  postventa: "tienda",
};
const POR_ETAPA: Record<string, LugarId> = {
  abastecer: "recepcion", preparar: "estudio", publicar: "estudio", vender: "tienda",
  entregar: "oficina_sede", facturar: "oficina_sede", contar: "contabilidad", dirigir: "gerencia", sistema: "sistemas",
};

/** A qué lugar va quien tiene abierto este panel. `null` = no es trabajo de un lugar
 *  (Agenda, mensajes, el Mapa, el juego): se queda en su sitio de siempre. */
export function lugarDePanel(panel: string): LugarId | null {
  const p = PRECISIONES[panel];
  if (p) return p;
  const etapa = ubicacionDe(panel as Panel)?.etapa.id;
  return (etapa && POR_ETAPA[etapa]) || null;
}

/** Dónde y cómo se ve cada función del catálogo de rendimiento (app/services/rendimiento.py).
 *  `punto` = un punto con nombre de mapa.json; `ronda` = va y viene entre esos puntos (alistar
 *  entre estantes, hacer el aseo). Sin `lugar`: la tarea es de escritorio, en su puesto de siempre. */
export const TAREA: Record<string, { lugar?: LugarId; corto: string; punto?: string; ronda?: string[]; sentado?: boolean }> = {
  almuerzo: { lugar: "oficina_sede", corto: "Cocinando", punto: "cocina" },
  desayuno: { lugar: "oficina_sede", corto: "Preparando el desayuno", punto: "cocina" },
  empacar: { lugar: "oficina_sede", corto: "Empacando", punto: "empacar" },
  embalar: { lugar: "oficina_sede", corto: "Embalando", punto: "embalar" },
  lote: { lugar: "oficina_sede", corto: "Poniendo fecha y lote", punto: "lote" },
  imprimir_et: { lugar: "oficina_sede", corto: "Imprimiendo etiquetas", punto: "imprimir_et", sentado: true },
  guias: { lugar: "oficina_sede", corto: "Imprimiendo guías", punto: "guias", sentado: true },
  cuaderno: { lugar: "oficina_sede", corto: "Anotando guías", punto: "guias", sentado: true },
  alistar: { lugar: "bodega", corto: "Alistando pedidos", ronda: ["ronda_alistar_0", "ronda_alistar_1", "ronda_alistar_2", "ronda_alistar_3"] },
  envasar: { lugar: "bodega", corto: "Envasando", punto: "envasar" },
  preparar: { lugar: "bodega", corto: "Preparando fórmulas", punto: "preparar" },
  compras: { lugar: "bodega", corto: "Revisando el stock", ronda: ["ronda_alistar_0", "ronda_alistar_2"] },
  aseo: { lugar: "bodega", corto: "Haciendo el aseo", ronda: ["ronda_aseo_0", "ronda_aseo_1", "ronda_aseo_2", "ronda_aseo_3"] },
  envio: { lugar: "porton", corto: "Llevando envíos", punto: "envio" },
  hongos: { lugar: "hongos", corto: "Cuidando los hongos", punto: "hongos" },
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

/** Dónde se toma el tinto en cada casa (las pausas cortas de quien trabaja). */
export const CAFE: Record<CasaId, string> = { bunker: "cafe_bunker", sede: "cafe_sede", tienda: "mostrador_cliente" };

/** A dónde mira la cámara al tocar el nombre de una casa en la barra. */
export const VISTA_CASA: Record<CasaId, LugarId> = { bunker: "gerencia", sede: "oficina_sede", tienda: "tienda" };

/** Lo que se sabe de un módulo para contarlo en el juego: su nombre, para qué sirve y en qué
 *  etapa y tramo del Mapa de la app vive (lib/flujoApp.ts, la misma fuente del Mapa). */
export function infoModulo(panel: string): { nombre: string; hace: string; descripcion: string; etapa?: string; tramo?: string } {
  const info = PANEL_INFO[panel];
  const nombre = info?.label ?? panel;
  if (panel === ORIGEN_APP.panel) return { nombre, hace: ORIGEN_APP.hace, descripcion: info?.description ?? "", etapa: "Inicio" };
  for (const etapa of ETAPAS_APP)
    for (const tramo of etapa.tramos) {
      const paso = tramo.pasos.find((p) => p.panel === panel);
      if (paso) return { nombre, hace: paso.hace, descripcion: info?.description ?? "", etapa: etapa.titulo, tramo: tramo.titulo };
    }
  const fuera = FUERA_DEL_FLUJO.find((p) => p.panel === panel);
  return { nombre, hace: fuera?.hace ?? info?.description ?? "", descripcion: info?.description ?? "" };
}

/** Módulos que salieron del menú y viven dentro de otro: en el barrio se va al objeto de ese otro
 *  (el Mapa todavía los nombra en sus pendientes). */
const OBJETO_DE: Record<string, string> = {
  publicaciones: "vitrina-web", "canales-producto": "vitrina-web",
  // Botón propio en el Mapa, pero en el barrio se cotiza en el escritorio de Facturación.
  "cotizar-facturar": "facturacion",
};
export const objetoDe = (panel: string) => OBJETO_DE[panel] ?? panel;

const hex = (css: string, def: string) => css.match(/#[0-9a-f]{6}/i)?.[0] ?? def;

/** El color de un módulo en el barrio = el de su etapa en el Mapa de la app (mapaComun.COLOR, paleta
 *  PICO-8): así el Libro Mayor se ve del mismo color en el Mapa y en su objeto del juego. `fondo` y
 *  `tinta` en #rrggbb. Lo que no es de una etapa (Agenda, chat, juegos) va en amarillo «Inicio». */
export function colorModulo(panel: string): { fondo: string; tinta: string; etapa: string } {
  const id = ubicacionDe(panel as Panel)?.etapa.id ?? "";
  const c = COLOR[id];
  if (!c) return { fondo: "#FFEC27", tinta: "#000000", etapa: "" };
  return { fondo: hex(c.fondo, "#5F574F"), tinta: hex(c.tinta, "#FFF1E8"), etapa: id };
}

/** Título de cada etapa (para el rótulo de los cuartos: «Contabilidad · Contar»). */
export function tituloEtapa(id: string): string {
  return ETAPAS_APP.find((e) => e.id === id)?.titulo ?? id;
}
