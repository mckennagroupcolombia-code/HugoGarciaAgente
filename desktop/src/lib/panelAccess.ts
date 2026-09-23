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
import { esContador, PANELES_CONTADOR } from "./contadorAccess";
import { esColaboradorExterno, PANELES_COLABORADOR } from "./colaboradorAccess";
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
  // Contador externo: solo el Libro Mayor. Va antes que todo lo demás porque
  // los paneles «libres» (Etiquetas, Empaque) no son asunto suyo — y su API
  // igual le responde 403 (`_guard_perfil_contador`).
  if (esContador(user)) return PANELES_CONTADOR.has(seccion);
  // Colaborador externo: Colaboradores y su Agenda con Armando, nada más.
  if (esColaboradorExterno(user)) {
    if (!PANELES_COLABORADOR.has(seccion)) return false;
    if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
    return true;
  }
  // Colaboradores es un espacio entre Armando y sus colaboradores: ni otro
  // administrador lo ve sin el permiso explícito (el backend lo niega igual).
  if (seccion === "colaboradores") return Boolean(user.permisos_secciones?.colaboradores);
  const logistica = puedeVerModuloLogistica(user, seccion);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, seccion);
  if (contab !== null) return contab;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if (esAdminPanel(user)) return true;
  if (seccion === "settings") return true;
  // Juegos: un rato de descanso para todo el equipo interno (no para contador ni colaborador externo).
  if (seccion === "juegos") return true;
  if (seccion === "etiquetas") return true;
  if (seccion === "empaque") return true;
  // Espacio de producto: lee el Mapa del sistema, así que se abre con su permiso
  // propio o con los que ya abren esa API (combos, mapa-sistema).
  if (seccion === "producto") {
    const pp = user.permisos_secciones;
    return Boolean(pp && (pp.producto || pp.combos || pp["mapa-sistema"]));
  }
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
