import type { Panel } from "../stores/app";
import type { PanelTier } from "./panelInfo";
import { CONTABILIDAD_PANELS, CONTABILIDAD_TAB_OCULTAS } from "./contabilidadAccess";
import { LOGISTICA_PANELS } from "./logisticaAccess";

/**
 * Categorías del sidebar — cada una es un hub (un botón + pestañas en el cabezote),
 * misma lógica/estética que Contabilidad.
 */
export type NavCategory =
  | "inicio"
  | "atencion"
  | "canales"
  | "inventario"
  | "contabilidad"
  | "tienda"
  | "logistica"
  | "sistemas";

export interface NavItemDef {
  panel: Panel;
  tier: PanelTier;
}

export interface NavSection {
  id: NavCategory;
  label: string;
  /** @deprecated Todos los hubs usan pestañas en el encabezado. */
  collapsible?: boolean;
  /** Un solo botón en sidebar; subpaneles como pestañas internas. */
  hub?: boolean;
  /** Solo visible con modo avanzado activo. */
  advancedOnly?: boolean;
}

export const NAV_SECTIONS: readonly (NavSection & { items: readonly NavItemDef[] })[] = [
  {
    id: "inicio",
    label: "Inicio",
    hub: true,
    items: [
      { panel: "hugo", tier: "core" },
      { panel: "dashboard", tier: "core" },
    ],
  },
  {
    id: "atencion",
    label: "Atención",
    hub: true,
    items: [
      { panel: "preventa", tier: "core" },
      { panel: "postventa", tier: "core" },
      { panel: "pedidos", tier: "core" },
    ],
  },
  {
    id: "canales",
    label: "Canales",
    hub: true,
    items: [
      { panel: "chat", tier: "core" },
      { panel: "whatsapp", tier: "standard" },
      { panel: "webchat", tier: "advanced" },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    hub: true,
    items: [
      { panel: "stock", tier: "core" },
      { panel: "etiquetas", tier: "core" },
      { panel: "fichas", tier: "standard" },
    ],
  },
  {
    id: "contabilidad",
    label: "Contabilidad",
    hub: true,
    items: CONTABILIDAD_PANELS.filter((panel) => !CONTABILIDAD_TAB_OCULTAS.has(panel)).map(
      (panel) => ({
        panel,
        tier:
          panel === "costos-productos" || panel === "rrhh"
            ? ("advanced" as PanelTier)
            : ("standard" as PanelTier),
      }),
    ),
  },
  {
    id: "tienda",
    label: "Tienda y taller",
    hub: true,
    items: [
      { panel: "publicaciones", tier: "standard" },
      { panel: "sitioweb", tier: "standard" },
      { panel: "placas-concreto", tier: "standard" },
    ],
  },
  {
    id: "logistica",
    label: "Logística",
    hub: true,
    advancedOnly: true,
    items: LOGISTICA_PANELS.map((panel) => ({ panel, tier: "advanced" as PanelTier })),
  },
  {
    id: "sistemas",
    label: "Sistemas",
    hub: true,
    advancedOnly: true,
    items: [
      { panel: "supervisor", tier: "advanced" },
      { panel: "voz", tier: "advanced" },
    ],
  },
] as const;

/** Orden de fallback al validar panel persistido (login / refresh). */
export const NAV_PANEL_ORDER: Panel[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.panel)),
  "settings",
  "perfil",
];

export const NAV_CATEGORY_LABEL: Record<NavCategory, string> = {
  inicio: "Inicio",
  atencion: "Atención",
  canales: "Canales",
  inventario: "Inventario",
  contabilidad: "Contabilidad",
  tienda: "Tienda y taller",
  logistica: "Logística",
  sistemas: "Sistemas",
};

export function navSectionForPanel(panel: Panel): NavCategory | null {
  for (const section of NAV_SECTIONS) {
    if (section.items.some((i) => i.panel === panel)) return section.id;
  }
  if (panel === "settings" || panel === "perfil") return null;
  return null;
}
