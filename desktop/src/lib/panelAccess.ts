import type { TicketsUser } from "../stores/ticketsAuth";
import { puedeVerModuloContabilidad } from "./contabilidadAccess";
import { puedeVerModuloLogistica } from "./logisticaAccess";

function puedeVerTickets(user: TicketsUser): boolean {
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas"]).has("tickets");
  return Boolean(p.tickets);
}

/** Visibilidad de un panel/sección del menú según rol y permisos. */
export function puedeVerSeccionPanel(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  const logistica = puedeVerModuloLogistica(user, seccion);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, seccion);
  if (contab !== null) return contab;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  if (seccion === "settings") return true;
  if (seccion === "etiquetas") return true;
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas"]).has(seccion);
  if (seccion === "postventa" && p.preventa) return true;
  if (seccion === "sitioweb" && p.publicaciones) return true;
  return Boolean(p[seccion]);
}
