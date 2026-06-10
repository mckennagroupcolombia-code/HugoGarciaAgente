import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";

export const CONTABILIDAD_PANELS = ["facturas", "centros-costo", "rentabilidad", "sync"] as const satisfies readonly Panel[];

/** Algún módulo de contabilidad habilitado (no admin). */
export function tienePermisoContabilidad(user: TicketsUser | null): boolean {
  if (!user) return false;
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  return Boolean(p.facturas || p.sync || p["centros-costo"] || p.rentabilidad);
}

/**
 * Centro de costos acompaña facturas o sincronización.
 * El resto de módulos usan su permiso directo.
 */
export function puedeVerModuloContabilidad(user: TicketsUser | null, seccion: string): boolean | null {
  if (!CONTABILIDAD_PANELS.includes(seccion as (typeof CONTABILIDAD_PANELS)[number])) {
    return null;
  }
  if (!user) return false;
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  if (seccion === "centros-costo") {
    return Boolean(p["centros-costo"] || p.facturas || p.sync);
  }
  if (seccion === "rentabilidad") {
    return Boolean(p.rentabilidad || p.facturas || p.sync);
  }
  return Boolean(p[seccion as keyof typeof p]);
}
