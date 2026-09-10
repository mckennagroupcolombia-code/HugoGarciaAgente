import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { esAdminPanel } from "./adminAccess";

/** Subpaneles del hub Contabilidad (orden de pestañas).
 * Facturación (+ Sync, Facturas de compra y Astro Killer, que viven dentro de
 * ella) ya NO es parte de Contabilidad — es su propia sección de nivel
 * superior en el menú "Ir a…" (ver lib/navStructure.ts). Sigue viviendo en
 * este archivo por conveniencia (menos módulos que reorganizar), pero
 * `esPanelContabilidad` ya no la incluye.
 *
 * Ingresos/Egresos, Créditos Adquiridos y Préstamos dejaron de ser pestañas
 * propias: son subvistas de "Vista Avanzada" dentro de Libro Mayor (mismos
 * componentes, misma lógica — ver LibroMayorPanel.tsx). El libro mayor es el
 * eje central de este hub; todo lo que es una vista directa de sus mismos
 * datos vive adentro de él, no como pestaña hermana.
 *
 * Stock (→ hub Inventario) y Rentabilidad/Publicidad/Salud del Negocio (→ hub
 * Negocio) tampoco son parte de Contabilidad — no tienen relación con la
 * partida doble, solo convivían aquí por historia. Sus funciones de permiso
 * siguen viviendo en este archivo (`puedeVerModuloContabilidad` sigue siendo
 * la fuente de verdad de esos permisos, exenta del guard de "es de
 * contabilidad" — ver `esModuloExternoConPermisoAqui` abajo), pero ya no
 * cuentan como pestañas del hub.
 *
 * "inicio" es la pestaña guiada: un checklist de lo que falta por hacer hoy
 * en todo el hub (extractos por clasificar, préstamos con saldo pendiente,
 * revisión de facturación), sin datos propios más allá de lo que ya se ve
 * en las demás pestañas — va primera a propósito (ver ContabilidadPanel.tsx
 * / ContabilidadInicioPanel.tsx). */
export const CONTABILIDAD_PANELS = [
  "contabilidad-inicio",
  "libro-mayor",
  "anulaciones",
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
  { id: "mensajeria", label: "Mensajería" },
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
      || p["compras-exterior"]
      || p["productos-siigo"]
      || p["costos-productos"]
      || p["catalogo-alegra"]
      || p.rrhh
      || p.operativos
      || p.impuestos
      || p.servicios
      || p.mensajeria
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
  // Estas secciones ya no son miembros de CONTABILIDAD_PANELS (viven en su
  // propia sección de nivel superior: Facturación, Inventario o Negocio),
  // pero esta función sigue siendo la fuente de verdad de sus permisos — la
  // exención evita que el guard de "no es de contabilidad" las descarte.
  const esModuloExternoConPermisoAqui =
    seccion === "facturacion" || seccion === "sync" || seccion === "facturas"
    || seccion === "astro-killer" || seccion === "cotizar-facturar"
    || seccion === "stock" || seccion === "rentabilidad" || seccion === "publicidad"
    || seccion === "salud-negocio";
  if (
    !esPanelContabilidad(seccion)
    && seccion !== "impuestos"
    && seccion !== "servicios"
    && seccion !== "mensajeria"
    && !esModuloExternoConPermisoAqui
  ) {
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
  if (seccion === "mensajeria") {
    // Pagos a la transportadora: lo lleva despachos (pedidos/empaque) y lo
    // aprueba administración — por eso hereda también de `pedidos`, no solo de
    // los permisos contables.
    return Boolean(p.mensajeria || p.servicios || p.operativos || p.pedidos);
  }
  if (seccion === "anulaciones") {
    // Mismo permiso que Libro Mayor, y a propósito: un expediente muestra el
    // motivo por el que se anuló una venta, el monto reintegrado al comprador y
    // el asiento contable. Es el nivel de sensibilidad del libro mayor, no el de
    // una lista de facturas. Debe coincidir con `_usuario_puede` en
    // `app/routes_anulaciones.py` — si divergen, el panel se ve pero la API
    // responde 403.
    return Boolean(p["libro-mayor"]);
  }
  if (seccion === "libro-mayor") {
    // Permiso propio y explícito: partida doble, plan de cuentas y saldos con
    // socios/proveedores son datos sensibles — no se hereda de facturación/sync.
    // Cubre TODO lo que vive adentro (Diario/ex Ingresos-Egresos, Préstamos,
    // Créditos Adquiridos incluidos) — ver Vista Avanzada en LibroMayorPanel.tsx.
    // El Diario ya expone movimientos de socios/préstamos, así que exigir el
    // mismo permiso estricto para todo el hub es lo correcto, no solo lo más simple.
    return Boolean(p["libro-mayor"]);
  }
  if (seccion === "contabilidad-inicio") {
    // El checklist guiado no expone nada que el usuario no pueda ya ver en
    // alguna otra pestaña del hub — visible con cualquier permiso de
    // contabilidad, igual criterio que `tienePermisoContabilidad`.
    return tienePermisoContabilidad(user);
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
