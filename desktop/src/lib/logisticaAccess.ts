import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/** Clave de permiso única para todo el módulo Logística Internacional. */
export const LOGISTICA_PERMISO = "logistica-internacional";

export const LOGISTICA_PANELS = [
  "logistica-importaciones",
  "logistica-embarques",
  "logistica-aduanas",
  "logistica-proveedores",
  "logistica-seguimiento",
] as const satisfies readonly Panel[];

export type LogisticaPanel = (typeof LOGISTICA_PANELS)[number];

export function esPanelLogistica(panel: string): panel is LogisticaPanel {
  return (LOGISTICA_PANELS as readonly string[]).includes(panel);
}

/** Panel legado persistido en localStorage antes del desglose por secciones. */
export const LOGISTICA_PANEL_LEGACY = "logistica-internacional";

export function puedeVerModuloLogistica(
  user: TicketsUser | null,
  seccion: string,
): boolean | null {
  if (!esPanelLogistica(seccion) && seccion !== LOGISTICA_PANEL_LEGACY) return null;
  if (!user) return false;
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  return Boolean(p[LOGISTICA_PERMISO] || p[seccion]);
}
