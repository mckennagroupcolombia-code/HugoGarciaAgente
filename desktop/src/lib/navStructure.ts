import type { Panel } from "../stores/app";
import type { PanelTier } from "./panelInfo";
import { CONTABILIDAD_PANELS } from "./contabilidadAccess";
import { LOGISTICA_PANELS } from "./logisticaAccess";

export type NavCategory =
  | "inicio"
  | "clientes"
  | "productos"
  | "contabilidad"
  | "contenido"
  | "produccion"
  | "logistica"
  | "sistemas";

export interface NavItemDef {
  panel: Panel;
  tier: PanelTier;
}

export interface NavSection {
  id: NavCategory;
  label: string;
  /** Grupo plegable (logística). */
  collapsible?: boolean;
  /** Un solo botón en sidebar; subpaneles viven como pestañas internas. */
  hub?: boolean;
  /** Solo visible con modo avanzado activo. */
  advancedOnly?: boolean;
}

export const NAV_SECTIONS: readonly (NavSection & { items: readonly NavItemDef[] })[] = [
  {
    id: "inicio",
    label: "Inicio",
    items: [
      { panel: "hugo", tier: "core" },
      { panel: "dashboard", tier: "core" },
      { panel: "chat", tier: "core" },
    ],
  },
  {
    id: "clientes",
    label: "Clientes y ventas",
    items: [
      { panel: "preventa", tier: "core" },
      { panel: "postventa", tier: "core" },
      { panel: "pedidos", tier: "core" },
      { panel: "whatsapp", tier: "standard" },
      { panel: "webchat", tier: "advanced" },
    ],
  },
  {
    id: "productos",
    label: "Productos e inventario",
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
    items: CONTABILIDAD_PANELS.map((panel) => ({
      panel,
      tier:
        panel === "costos-productos" || panel === "rrhh"
          ? ("advanced" as PanelTier)
          : ("standard" as PanelTier),
    })),
  },
  {
    id: "contenido",
    label: "Contenido",
    items: [
      { panel: "publicaciones", tier: "standard" },
      { panel: "sitioweb", tier: "standard" },
    ],
  },
  {
    id: "produccion",
    label: "Producción",
    items: [{ panel: "placas-concreto", tier: "standard" }],
  },
  {
    id: "logistica",
    label: "Logística internacional",
    collapsible: true,
    advancedOnly: true,
    items: LOGISTICA_PANELS.map((panel) => ({ panel, tier: "advanced" as PanelTier })),
  },
  {
    id: "sistemas",
    label: "Monitoreo",
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
  clientes: "Clientes y ventas",
  productos: "Productos e inventario",
  contabilidad: "Contabilidad",
  contenido: "Contenido",
  produccion: "Producción",
  logistica: "Logística internacional",
  sistemas: "Monitoreo",
};

export function navSectionForPanel(panel: Panel): NavCategory | null {
  for (const section of NAV_SECTIONS) {
    if (section.items.some((i) => i.panel === panel)) return section.id;
  }
  if (panel === "settings" || panel === "perfil") return "inicio";
  return null;
}
