import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/** Subpaneles del hub Contabilidad (orden de pestañas).
 * Facturación (+ Sync, Facturas de compra y Astro Killer, que viven dentro de
 * ella) ya NO es parte de Contabilidad — es su propia sección de nivel
 * superior en el menú "Ir a…" (ver lib/navStructure.ts). Sigue viviendo en
 * este archivo por conveniencia (menos módulos que reorganizar), pero
 * `esPanelContabilidad` ya no la incluye. */
export const CONTABILIDAD_PANELS = [
  "ingresos-egresos",
  "creditos-adquiridos",
  "libro-mayor",
  "stock",
  "rentabilidad",
  "publicidad",
  "salud-negocio",
  "compras-exterior",
  "productos-siigo",
  "costos-productos",
  "catalogo-alegra",
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
 * - rrhh → vive dentro de Operativos
 */
export const CONTABILIDAD_TAB_OCULTAS = new Set<ContabilidadPanelId>([
  "productos-siigo",
  "rrhh",
]);

/** Subvistas internas de la sección Facturación.
 * "ventas" fusiona lo que antes eran dos subtabs separadas ("Ventas y NC" y
 * "Astro Killer" / "trazabilidad") — se mantiene el id "ventas" para no
 * romper `leerSubtabFacturacion`/localStorage de usuarios que ya lo tenían
 * guardado. */
export const FACTURACION_SUBTABS = [
  { id: "sync", label: "Sync" },
  { id: "compra", label: "Facturas de compra" },
  { id: "ventas", label: "Ventas, NC y Astro Killer" },
  { id: "directo", label: "Cotizar/Facturar" },
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

/** rrhh → Operativos. */
export function normalizarPanelContabilidad(panel: string): ContabilidadPanelId | null {
  if (panel === "rrhh") return "operativos";
  if (esPanelContabilidad(panel)) return panel;
  return null;
}

export function subtabDesdePanelLegacy(panel: string): FacturacionSubtabId | null {
  if (panel === "sync") return "sync";
  if (panel === "facturas") return "compra";
  if (panel === "astro-killer") return "ventas";
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
      || p.publicidad
      || p["salud-negocio"]
      || p["compras-exterior"]
      || p["productos-siigo"]
      || p["costos-productos"]
      || p["catalogo-alegra"]
      || p.rrhh
      || p.operativos
      || p.impuestos
      || p.servicios
      || p["ingresos-egresos"]
      || p["creditos-adquiridos"]
      || p["libro-mayor"],
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
  // facturacion/sync/facturas/astro-killer ya no son miembros de
  // CONTABILIDAD_PANELS (viven en su propia sección de nivel superior), pero
  // esta función sigue siendo la fuente de verdad de sus permisos — la
  // exención evita que el guard de "no es de contabilidad" las descarte.
  const esFacturacionExterna =
    seccion === "facturacion" || seccion === "sync" || seccion === "facturas"
    || seccion === "astro-killer" || seccion === "cotizar-facturar";
  if (!esPanelContabilidad(seccion) && seccion !== "impuestos" && seccion !== "servicios" && !esFacturacionExterna) {
    return null;
  }
  if (!user) return false;
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return false;
  if (seccion === "facturacion") {
    return Boolean(p.facturacion || p.facturas || p.sync);
  }
  if (seccion === "cotizar-facturar") {
    // Permiso propio y explícito, NO heredado de facturas/sync — crea
    // facturas DIAN reales para ventas ad-hoc (mismo criterio que
    // libro-mayor: dato/acción sensible, no se hereda automáticamente).
    return Boolean(p["cotizar-facturar"]);
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
  if (seccion === "publicidad") {
    return Boolean(p.publicidad || p.rentabilidad || p.facturas || p.sync || p.facturacion);
  }
  if (seccion === "salud-negocio") {
    return Boolean(p["salud-negocio"] || p.rentabilidad || p.publicidad || p.facturacion);
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
  if (seccion === "creditos-adquiridos") {
    return Boolean(
      p["creditos-adquiridos"]
        || p["ingresos-egresos"]
        || p.facturas
        || p.sync
        || p.facturacion
        || p.rentabilidad,
    );
  }
  if (seccion === "libro-mayor") {
    // Permiso propio y explícito: partida doble, plan de cuentas y saldos con
    // socios/proveedores son datos sensibles — no se hereda de facturación/sync.
    return Boolean(p["libro-mayor"]);
  }
  if (seccion === "catalogo-alegra") {
    return Boolean(
      p["catalogo-alegra"]
        || p["productos-siigo"]
        || p["costos-productos"]
        || p.facturas
        || p.sync
        || p.facturacion
        || p.rentabilidad,
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
    if (v === "sync" || v === "compra" || v === "ventas" || v === "directo") return v;
    // "trazabilidad" (Astro Killer) quedó fusionada dentro de "ventas".
    if (v === "trazabilidad") return "ventas";
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
  return visibles[0] ?? CONTABILIDAD_PANELS[0];
}
