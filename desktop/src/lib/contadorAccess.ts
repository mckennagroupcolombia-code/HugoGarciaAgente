import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/**
 * Perfil «contador»: el contador externo. Ve y cruza TODA la contabilidad del
 * Libro Mayor (consulta), deja indicaciones en el historial de los terceros y
 * nada más. El backend lo hace cumplir por lista blanca
 * (`_guard_perfil_contador` en app/routes.py); esto solo arma la vista.
 */
export function esContador(user: TicketsUser | null | undefined): boolean {
  if (!user || esAdminPanel(user)) return false;
  return Boolean(user.permisos_secciones?.contador);
}

/** Lo único que ve del menú. */
export const PANELES_CONTADOR = new Set(["libro-mayor", "settings", "perfil"]);
