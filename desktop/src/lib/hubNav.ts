import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import type { UiIconName } from "../icons/types";
import {
  NAV_SECTIONS,
  navSectionForPanel,
  type NavCategory,
  type NavItemDef,
} from "./navStructure";
import { CONTABILIDAD_TAB_OCULTAS } from "./contabilidadAccess";

/** Icono del hub / standalone en sidebar y encabezado. */
export const HUB_SECTION_ICON: Record<NavCategory, UiIconName> = {
  inicio: "home",
  atencion: "bell",
  canales: "chat",
  diseno: "tag",
  docs: "file",
  contabilidad: "receipt",
  inventario: "listChecks",
  publicaciones: "megaphone",
  placas: "package",
  contenido: "camera",
  sistemas: "monitor",
  facturacion: "scroll",
};

/** Tooltip al pasar el mouse sobre el botón del hub. */
export const HUB_SECTION_HINT: Record<NavCategory, string> = {
  inicio: "Agenda del equipo y métricas del día.",
  atencion: "Preventa MeLi, postventa, pedidos web y evidencia de empaque.",
  canales: "Chat IA, WhatsApp y chat de la página web.",
  diseno: "Etiquetas, Studio visual e impresión.",
  docs: "Fichas técnicas e información científica de ingredientes.",
  contabilidad: "Facturas, sync MeLi↔Alegra, stock, rentabilidad y más.",
  inventario: "Checklist de stock agotado, crítico o bajo — agrega unidades, pide compra o marca revisado.",
  publicaciones: "Catálogo MeLi / web: fotos, textos, sync y republicar.",
  placas: "Calculadora de dosificación para placas de concreto pulido.",
  contenido: "Quitar marca de agua estática de un video antes de publicarlo.",
  sistemas: "Supervisor de WhatsApp y canal de voz IA.",
  facturacion: "Sync MeLi↔Alegra, facturas de compra, ventas y NC, y Astro Killer (trazabilidad venta→factura).",
};

const LAST_KEY_PREFIX = "mckenna-hub-last:";

export function leerUltimoPanelHub(sectionId: NavCategory): Panel | null {
  try {
    const v = localStorage.getItem(LAST_KEY_PREFIX + sectionId) || "";
    return v ? (v as Panel) : null;
  } catch {
    return null;
  }
}

export function guardarUltimoPanelHub(sectionId: NavCategory, panel: Panel): void {
  try {
    localStorage.setItem(LAST_KEY_PREFIX + sectionId, panel);
  } catch {
    /* ignore */
  }
}

export function itemsVisiblesHub(
  items: readonly NavItemDef[],
  user: TicketsUser | null,
  advanced: boolean,
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean,
  sectionId?: NavCategory,
): NavItemDef[] {
  return items.filter((item) => {
    if (CONTABILIDAD_TAB_OCULTAS.has(item.panel as never)) return false;
    if (!puedeVer(user, item.panel)) return false;
    if (item.tier === "advanced" && !advanced) return false;
    // Si un panel aparece en dos hubs, navSectionForPanel elige el primero:
    // no listarlo en el hub “prestado” (evita abrir Contabilidad al entrar a Tienda).
    if (sectionId && navSectionForPanel(item.panel) !== sectionId) return false;
    return true;
  });
}

/** Primer subpanel al abrir un hub (respeta último visitado). */
export function primerPanelHub(
  sectionId: NavCategory,
  user: TicketsUser | null,
  advanced: boolean,
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean,
  preferido?: Panel | null,
): Panel | null {
  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const visibles = itemsVisiblesHub(section.items, user, advanced, puedeVer, sectionId);
  if (!visibles.length) return null;
  if (preferido && visibles.some((i) => i.panel === preferido)) return preferido;
  const last = leerUltimoPanelHub(sectionId);
  if (last && visibles.some((i) => i.panel === last)) return last;
  return visibles[0].panel;
}

export function esPanelDeHub(panel: Panel): boolean {
  const section = navSectionForPanel(panel);
  return section !== null && panel !== "settings" && panel !== "perfil";
}

/** Categorías con cabezote de hub (todas las del menú). */
export function esCategoriaHub(sectionId: NavCategory | null): boolean {
  if (!sectionId) return false;
  return NAV_SECTIONS.some((x) => x.id === sectionId);
}
