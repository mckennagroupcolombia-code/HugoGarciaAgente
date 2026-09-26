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
  // El mapa es la pantalla de inicio de todo el equipo interno: cada carta se filtra
  // con esta misma función, así que nadie ve en él un panel que no pueda abrir.
  if (seccion === "mapa-vivo") return true;
  // Juegos: un rato de descanso para todo el equipo interno (no para contador ni colaborador externo).
  if (seccion === "juegos") return true;
  // El chat del equipo es de todo el equipo interno (cada canal filtra sus miembros en la API).
  if (seccion === "chat-equipo") return true;
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
  // Recepción de mercancía: la hace quien está en bodega (mismas personas que despachan o
  // llevan inventario). Debe decir lo mismo que routes_recepciones._PERMISOS.
  if (seccion === "recepcion-mercancia") {
    const pr = user.permisos_secciones;
    return Boolean(!pr || pr["recepcion-mercancia"] || pr.pedidos || pr.empaque || pr["control-inventario"] || pr.stock);
  }
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas", "empaque"]).has(seccion);
  if (seccion === "postventa" && p.preventa) return true;
  if (seccion === "ventas-email" && p.preventa) return true;
  if (seccion === "vitrina-web" && p.publicaciones) return true;
  // Mismos permisos que acepta /api/canales-producto (routes_canales_producto._PERMISOS).
  if (seccion === "canales-producto" && (p.publicaciones || p["mapa-sistema"])) return true;
  return Boolean(p[seccion]);
}

export { esAdminPanel, conPrivilegiosAdminCynthia, modoAvanzadoEfectivo } from "./adminAccess";

/**
 * La pantalla de inicio de esta persona (26-sep-2026): el Mapa. La portada de la Agenda ya no
 * existe como pantalla; todo lo que antes «volvía a la Agenda» vuelve aquí. Solo quien no puede
 * abrir el Mapa (p. ej. un perfil de lista blanca) sigue aterrizando en la Agenda.
 */
export function panelDeInicio(user: TicketsUser | null): "mapa-vivo" | "hugo" {
  return user && puedeVerSeccionPanel(user, "mapa-vivo") ? "mapa-vivo" : "hugo";
}
