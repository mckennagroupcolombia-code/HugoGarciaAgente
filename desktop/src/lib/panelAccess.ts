import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";
import { puedeVerModuloContabilidad } from "./contabilidadAccess";
import { puedeVerModuloLogistica } from "./logisticaAccess";

function puedeVerTickets(user: TicketsUser): boolean {
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas"]).has("tickets");
  return Boolean(p.tickets);
}

/** Rótulos de envío: admin, permiso propio, o quien despacha (pedidos/empaque). */
export function puedeVerGuiasEnvio(user: TicketsUser): boolean {
  if (esAdminPanel(user)) return true;
  const perm = user.permisos_secciones;
  return Boolean(!perm || perm["guias-envio"] || perm.pedidos || perm.empaque);
}

/** Entregas Flex (horas de reparto MeLi): las mismas personas que despachan. */
export function puedeVerEntregasFlex(user: TicketsUser): boolean {
  if (esAdminPanel(user)) return true;
  const perm = user.permisos_secciones;
  return Boolean(!perm || perm["entregas-flex"] || perm.pedidos || perm.empaque || perm["guias-envio"]);
}

/** Visibilidad de un panel/sección del menú según rol y permisos. */
export function puedeVerSeccionPanel(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  const logistica = puedeVerModuloLogistica(user, seccion);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, seccion);
  if (contab !== null) return contab;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if (esAdminPanel(user)) return true;
  if (seccion === "settings") return true;
  if (seccion === "etiquetas") return true;
  if (seccion === "empaque") return true;
  // Rótulos de envío: los hace quien despacha (pedidos/empaque). Debe decir lo
  // mismo que `puedeVerPanel` en App.tsx — si diverge, el panel es accesible
  // pero el botón no aparece en ningún menú (pasó con TKT-2026-1307).
  if (seccion === "guias-envio") return puedeVerGuiasEnvio(user);
  if (seccion === "entregas-flex") return puedeVerEntregasFlex(user);
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas", "empaque"]).has(seccion);
  if (seccion === "postventa" && p.preventa) return true;
  if (seccion === "ventas-email" && p.preventa) return true;
  if (seccion === "vitrina-web" && p.publicaciones) return true;
  return Boolean(p[seccion]);
}

export { esAdminPanel, conPrivilegiosAdminCynthia, modoAvanzadoEfectivo } from "./adminAccess";
