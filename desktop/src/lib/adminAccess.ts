import type { TicketsUser } from "../stores/ticketsAuth";
import { esCynthiaEtiquetas } from "./studioVisualAccess";

/** Admin real (nivel >= 3) o Cynthia con privilegios de administrador en el panel. */
export function esAdminPanel(user: TicketsUser | null | undefined): boolean {
  if (!user) return false;
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  return esCynthiaEtiquetas(user);
}

/**
 * Vista de equipo (métricas, acciones de todos, historial global).
 * Admin real sí; Cynthia elevada NO — su Agenda/Acciones siguen siendo personales.
 */
export function esAdminVistaEquipo(user: TicketsUser | null | undefined): boolean {
  if (!user) return false;
  if (esCynthiaEtiquetas(user)) return false;
  return (user.rol?.nivel ?? 0) >= 3;
}

/**
 * Eleva nivel a 3 para Cynthia en el cliente (menú/botones como admin).
 * El backend también aplica esto en /auth/me y en la sesión.
 * La Agenda personal no usa esta elevación (ver esAdminVistaEquipo).
 */
export function conPrivilegiosAdminCynthia(user: TicketsUser): TicketsUser {
  if (!esCynthiaEtiquetas(user)) return user;
  const nivel = user.rol?.nivel ?? 0;
  if (nivel >= 3) return user;
  return {
    ...user,
    rol: user.rol
      ? { ...user.rol, nivel: 3 }
      : { id: 0, nombre: "Administrador", nivel: 3 },
  };
}

/** Modo avanzado del menú: toggle UI, o Cynthia (ve todos los botones admin). */
export function modoAvanzadoEfectivo(
  user: TicketsUser | null | undefined,
  advanced: boolean,
): boolean {
  return advanced || esCynthiaEtiquetas(user);
}
