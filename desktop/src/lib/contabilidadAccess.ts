import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";

/** Subpaneles del hub Contabilidad (orden de pestañas). */
export const CONTABILIDAD_PANELS = [
  "facturas",
  "sync",
  "rentabilidad",
  "compras-exterior",
  "costos-productos",
  "rrhh",
] as const satisfies readonly Panel[];

export type ContabilidadPanelId = (typeof CONTABILIDAD_PANELS)[number];

const CONTABILIDAD_SET = new Set<string>(CONTABILIDAD_PANELS);

/** Panel legado oculto: ya no tiene pestaña en el hub. */
export const CONTABILIDAD_PANEL_OCULTO = "centros-costo" as const;

export function esPanelContabilidad(panel: string): panel is ContabilidadPanelId {
  return CONTABILIDAD_SET.has(panel);
}

/** Algún módulo de contabilidad habilitado (no admin). */
export function tienePermisoContabilidad(user: TicketsUser | null): boolean {
  if (!user) return false;
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  return Boolean(
    p.facturas
      || p.sync
      || p.rentabilidad
      || p["compras-exterior"]
      || p["costos-productos"]
      || p.rrhh,
  );
}

/**
 * Costos / rentabilidad acompañan facturas o sync.
 * RRHH usa su permiso directo.
 */
export function puedeVerModuloContabilidad(
  user: TicketsUser | null,
  seccion: string,
): boolean | null {
  if (seccion === CONTABILIDAD_PANEL_OCULTO) return false;
  if (!esPanelContabilidad(seccion)) return null;
  if (!user) return false;
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  if (seccion === "costos-productos") {
    return Boolean(p["costos-productos"] || p.facturas || p.sync);
  }
  if (seccion === "rentabilidad" || seccion === "compras-exterior") {
    return Boolean(p.rentabilidad || p.facturas || p.sync || p["compras-exterior"]);
  }
  if (seccion === "rrhh") {
    return Boolean(p.rrhh);
  }
  return Boolean(p[seccion as keyof typeof p]);
}

const LAST_KEY = "mckenna-contabilidad-last-panel";

export function leerUltimoPanelContabilidad(): ContabilidadPanelId | null {
  try {
    const v = localStorage.getItem(LAST_KEY) || "";
    return esPanelContabilidad(v) ? v : null;
  } catch {
    return null;
  }
}

export function guardarUltimoPanelContabilidad(panel: ContabilidadPanelId): void {
  try {
    localStorage.setItem(LAST_KEY, panel);
  } catch {
    /* ignore */
  }
}

/** Primer subpanel visible según permisos y modo avanzado. */
export function primerPanelContabilidad(
  user: TicketsUser | null,
  advanced: boolean,
  preferido?: Panel | null,
): ContabilidadPanelId {
  const visibles = CONTABILIDAD_PANELS.filter((id) => {
    if (!puedeVerModuloContabilidad(user, id)) return false;
    if (id === "costos-productos" || id === "rrhh") return advanced;
    return true;
  });
  if (preferido && esPanelContabilidad(preferido) && visibles.includes(preferido)) {
    return preferido;
  }
  const last = leerUltimoPanelContabilidad();
  if (last && visibles.includes(last)) return last;
  return visibles[0] ?? "facturas";
}
