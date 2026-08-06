import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/** Subpaneles del hub Contabilidad (orden de pestañas). */
export const CONTABILIDAD_PANELS = [
  "facturacion",
  "sync",
  "facturas",
  "ingresos-egresos",
  "stock",
  "rentabilidad",
  "compras-exterior",
  "productos-siigo",
  "costos-productos",
  "operativos",
  "rrhh",
] as const satisfies readonly Panel[];

export type ContabilidadPanelId = (typeof CONTABILIDAD_PANELS)[number];

const CONTABILIDAD_SET = new Set<string>(CONTABILIDAD_PANELS);

/** Panel legado oculto: ya no tiene pestaña en el hub. */
export const CONTABILIDAD_PANEL_OCULTO = "centros-costo" as const;

/**
 * Pestañas ocultas del cabezote:
 * - productos-siigo → FAB
 * - sync / facturas → viven dentro de Facturación
 * - rrhh → vive dentro de Operativos
 */
export const CONTABILIDAD_TAB_OCULTAS = new Set<ContabilidadPanelId>([
  "productos-siigo",
  "sync",
  "facturas",
  "rrhh",
]);

/** Subvistas internas de la pestaña Facturación. */
export const FACTURACION_SUBTABS = [
  { id: "sync", label: "Sync" },
  { id: "compra", label: "Facturas de compra" },
] as const;

export type FacturacionSubtabId = (typeof FACTURACION_SUBTABS)[number]["id"];

/** Subvistas internas de la pestaña Operativos. */
export const OPERATIVOS_SUBTABS = [
  { id: "rrhh", label: "Recursos humanos" },
  { id: "impuestos", label: "Pagos de impuestos" },
  { id: "servicios", label: "Servicios" },
] as const;

export type OperativosSubtabId = (typeof OPERATIVOS_SUBTABS)[number]["id"];

export type FacturasVistaBoot = "pendientes" | "historial" | "consultar";

/** sync/facturas → Facturación; rrhh → Operativos. */
export function normalizarPanelContabilidad(panel: string): ContabilidadPanelId | null {
  if (panel === "sync" || panel === "facturas") return "facturacion";
  if (panel === "rrhh") return "operativos";
  if (esPanelContabilidad(panel)) return panel;
  return null;
}

export function subtabDesdePanelLegacy(panel: string): FacturacionSubtabId | null {
  if (panel === "sync") return "sync";
  if (panel === "facturas") return "compra";
  return null;
}

export function subtabOperativosDesdeLegacy(panel: string): OperativosSubtabId | null {
  if (panel === "rrhh") return "rrhh";
  return null;
}

export function esPanelContabilidad(panel: string): panel is ContabilidadPanelId {
  return CONTABILIDAD_SET.has(panel);
}

/** Algún módulo de contabilidad habilitado (no admin). */
export function tienePermisoContabilidad(user: TicketsUser | null): boolean {
  if (!user) return false;
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  return Boolean(
    p.facturas
      || p.sync
      || p.facturacion
      || p.stock
      || p.rentabilidad
      || p["compras-exterior"]
      || p["productos-siigo"]
      || p["costos-productos"]
      || p.rrhh
      || p.operativos
      || p.impuestos
      || p.servicios,
  );
}

/**
 * Costos / rentabilidad acompañan facturas o sync.
 * RRHH / Operativos: permiso propio o avanzado.
 * Facturación = sync u facturas (o permiso propio).
 */
export function puedeVerModuloContabilidad(
  user: TicketsUser | null,
  seccion: string,
): boolean | null {
  if (seccion === CONTABILIDAD_PANEL_OCULTO) return false;
  if (!esPanelContabilidad(seccion) && seccion !== "impuestos" && seccion !== "servicios") {
    return null;
  }
  if (!user) return false;
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  if (seccion === "facturacion") {
    return Boolean(p.facturacion || p.facturas || p.sync);
  }
  if (seccion === "stock") {
    return Boolean(p.stock || p.facturacion || p.facturas || p.sync || p.rentabilidad);
  }
  if (seccion === "costos-productos") {
    return Boolean(p["costos-productos"] || p.facturas || p.sync || p.facturacion);
  }
  if (seccion === "rentabilidad" || seccion === "compras-exterior") {
    return Boolean(
      p.rentabilidad || p.facturas || p.sync || p.facturacion || p["compras-exterior"],
    );
  }
  if (seccion === "productos-siigo") {
    return Boolean(p["productos-siigo"] || p.facturas || p.sync || p.facturacion);
  }
  if (seccion === "operativos") {
    return Boolean(
      p.operativos || p.rrhh || p.impuestos || p.servicios || p.rentabilidad || p.facturacion,
    );
  }
  if (seccion === "rrhh") {
    return Boolean(p.rrhh || p.operativos);
  }
  if (seccion === "impuestos") {
    return Boolean(p.impuestos || p.operativos || p.facturacion || p.facturas);
  }
  if (seccion === "servicios") {
    return Boolean(p.servicios || p.operativos || p.rentabilidad);
  }
  if (seccion === "ingresos-egresos") {
    return Boolean(
      p["ingresos-egresos"] || p.facturas || p.sync || p.facturacion || p.rentabilidad,
    );
  }
  return Boolean(p[seccion as keyof typeof p]);
}

const LAST_KEY = "mckenna-contabilidad-last-panel";
const FACTURACION_SUB_KEY = "mckenna-facturacion-subtab";
const OPERATIVOS_SUB_KEY = "mckenna-operativos-subtab";

export function leerUltimoPanelContabilidad(): ContabilidadPanelId | null {
  try {
    const v = localStorage.getItem(LAST_KEY) || "";
    const n = normalizarPanelContabilidad(v);
    return n;
  } catch {
    return null;
  }
}

export function guardarUltimoPanelContabilidad(panel: ContabilidadPanelId): void {
  try {
    const n = normalizarPanelContabilidad(panel) ?? panel;
    localStorage.setItem(LAST_KEY, n);
    localStorage.setItem("mckenna-hub-last:contabilidad", n);
  } catch {
    /* ignore */
  }
}

export function leerSubtabFacturacion(): FacturacionSubtabId {
  try {
    const v = localStorage.getItem(FACTURACION_SUB_KEY) || "";
    if (v === "sync" || v === "compra") return v;
    if (v === "facturas") return "compra";
  } catch { /* */ }
  return "compra";
}

export function guardarSubtabFacturacion(id: FacturacionSubtabId): void {
  try {
    localStorage.setItem(FACTURACION_SUB_KEY, id);
  } catch { /* */ }
}

export function leerSubtabOperativos(): OperativosSubtabId {
  try {
    const v = localStorage.getItem(OPERATIVOS_SUB_KEY) || "";
    if (v === "rrhh" || v === "impuestos" || v === "servicios") return v;
  } catch { /* */ }
  return "rrhh";
}

export function guardarSubtabOperativos(id: OperativosSubtabId): void {
  try {
    localStorage.setItem(OPERATIVOS_SUB_KEY, id);
  } catch { /* */ }
}

/** Primer subpanel visible según permisos y modo avanzado. */
export function primerPanelContabilidad(
  user: TicketsUser | null,
  advanced: boolean,
  preferido?: Panel | null,
): ContabilidadPanelId {
  const visibles = CONTABILIDAD_PANELS.filter((id) => {
    if (CONTABILIDAD_TAB_OCULTAS.has(id)) return false;
    if (!puedeVerModuloContabilidad(user, id)) return false;
    if (id === "costos-productos") return advanced;
    if (id === "operativos") {
      return advanced || Boolean(puedeVerModuloContabilidad(user, "servicios"));
    }
    return true;
  });
  const pref = preferido ? normalizarPanelContabilidad(preferido) : null;
  if (pref && visibles.includes(pref)) return pref;
  const last = leerUltimoPanelContabilidad();
  if (last && visibles.includes(last)) return last;
  try {
    const hubLast = localStorage.getItem("mckenna-hub-last:contabilidad") || "";
    const n = normalizarPanelContabilidad(hubLast);
    if (n && visibles.includes(n)) return n;
  } catch { /* */ }
  return visibles[0] ?? "facturacion";
}
