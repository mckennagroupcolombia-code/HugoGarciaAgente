import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/**
 * Perfil «colaborador externo» (primero Sebastián): solo el apartado
 * Colaboradores y su Agenda con Armando. El backend lo hace cumplir por lista
 * blanca (`_guard_colaborador_externo` en app/routes.py); esto solo arma la vista.
 */
export function esColaboradorExterno(user: TicketsUser | null | undefined): boolean {
  if (!user || esAdminPanel(user)) return false;
  return Boolean(user.permisos_secciones?.colaborador_externo);
}

/** Lo único que ve del menú (la Agenda se sigue rigiendo por su permiso `tickets`). */
export const PANELES_COLABORADOR = new Set(["colaboradores", "hugo", "tickets", "settings", "perfil"]);
