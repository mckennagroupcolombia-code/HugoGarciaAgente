import { ETAPAS_APP, type EtapaApp } from "./flujoApp";
import type { Panel } from "../stores/app";

/**
 * A qué etapa del flujo pertenece una solicitud o una acción de la Agenda.
 *
 * La `categoria` del ticket no sirve para esto: «logistica» es el valor por defecto y cubre el
 * 80 % de los tickets (compras, etiquetas, nómina…). Por eso manda el TÍTULO, con reglas de
 * palabra clave en orden —la primera que coincide gana— y la categoría solo como respaldo.
 * Es una sugerencia sin IA: si ninguna regla aplica, el ticket queda sin etapa y no se inventa una.
 * El orden importa: «Pagos de préstamos» debe caer en Contar antes de que «pago» lo lleve a Abastecer.
 */

type Regla = { si: RegExp; etapa: string; panel: Panel };

const REGLAS: Regla[] = [
  { si: /nota credito|anulacion|anular/, etapa: "facturar", panel: "anulaciones" },
  { si: /prestamo|cuota de manejo/, etapa: "contar", panel: "prestamos" },
  { si: /impuesto|retencion|contador|declaracion|\b350\b|\b490\b/, etapa: "contar", panel: "conciliacion-contador" },
  { si: /extracto|conciliacion|asiento|libro mayor|banco/, etapa: "contar", panel: "libro-mayor" },
  { si: /nomina|quincena|prestacion de servicios|valores a pagar|servicios publicos|arriendo/, etapa: "contar", panel: "operativos" },
  { si: /factura de compra|proveedor|cotizacion|solicitar compra|compras?:|compra de|importacion|pago a /, etapa: "abastecer", panel: "pagos" },
  { si: /factur/, etapa: "facturar", panel: "facturacion" },
  { si: /etiqueta|\bean\b|codigo de barras/, etapa: "preparar", panel: "etiquetas" },
  { si: /ficha tecnica|\bcoa\b|\bsds\b|\btds\b|documento tecnico/, etapa: "preparar", panel: "fichas" },
  { si: /\bskus?\b|combo|receta/, etapa: "preparar", panel: "combos" },
  { si: /stock|inventario|agotad|conteo/, etapa: "preparar", panel: "control-inventario" },
  { si: /publicidad|\bads\b|\bacos\b/, etapa: "publicar", panel: "publicidad" },
  { si: /publicacion|publicar|vitrina|banner/, etapa: "publicar", panel: "publicaciones" },
  { si: /contenido|video|reel|post\b|redes/, etapa: "publicar", panel: "contenido" },
  { si: /empa(que|car)|alistar/, etapa: "entregar", panel: "empaque" },
  { si: /envio|despach|guia|colecta|flex|entrega|transportadora|mensajeria/, etapa: "entregar", panel: "guias-envio" },
  { si: /pedido/, etapa: "entregar", panel: "pedidos" },
  { si: /pregunta|preventa/, etapa: "vender", panel: "preventa" },
  { si: /whatsapp|cliente|cotizar/, etapa: "vender", panel: "whatsapp" },
];

const POR_CATEGORIA: Record<string, { etapa: string; panel: Panel }> = {
  contabilidad: { etapa: "contar", panel: "contabilidad-inicio" },
  inventario: { etapa: "preparar", panel: "control-inventario" },
  diseno: { etapa: "preparar", panel: "etiquetas" },
  ventas: { etapa: "vender", panel: "preventa" },
};

function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface UbicacionTicket {
  etapa: EtapaApp;
  panel: Panel;
}

export function etapaDeTicket(t: { titulo?: string | null; categoria?: string | null }): UbicacionTicket | null {
  const titulo = normalizar(t.titulo ?? "");
  const hit = REGLAS.find((r) => r.si.test(titulo)) ?? POR_CATEGORIA[normalizar(t.categoria ?? "")];
  if (!hit) return null;
  const etapa = ETAPAS_APP.find((e) => e.id === hit.etapa);
  return etapa ? { etapa, panel: hit.panel } : null;
}
