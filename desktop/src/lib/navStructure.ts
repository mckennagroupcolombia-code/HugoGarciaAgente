import type { Panel } from "../stores/app";
import type { PanelTier } from "./panelInfo";
import { CONTABILIDAD_PANELS, CONTABILIDAD_TAB_OCULTAS } from "./contabilidadAccess";
import { LOGISTICA_PANELS } from "./logisticaAccess";

/**
 * Categorías del sidebar.
 * - hub: un botón + pestañas en el cabezote (estilo Contabilidad)
 * - advancedOnly: solo con modo avanzado
 */
export type NavCategory =
  | "inicio"
  | "atencion"
  | "canales"
  | "diseno"
  | "studio-web"
  | "docs"
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
  /** Un solo botón + pestañas en el cabezote (estilo Contabilidad). */
  hub?: boolean;
  /** @deprecated Todas las secciones son hub; se ignora si hub=true. */
  standalone?: boolean;
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
    id: "diseno",
    label: "Diseño",
    hub: true,
    items: [{ panel: "etiquetas", tier: "core" }],
  },
  {
    id: "studio-web",
    label: "Studio web",
    hub: true,
    items: [{ panel: "sitioweb", tier: "standard" }],
  },
  {
    id: "docs",
    label: "Docs técnicos",
    hub: true,
    items: [{ panel: "fichas", tier: "standard" }],
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
      { panel: "stock", tier: "core" },
      { panel: "publicaciones", tier: "standard" },
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
      { panel: "control-versiones", tier: "advanced" },
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
  diseno: "Diseño",
  "studio-web": "Studio web",
  docs: "Docs técnicos",
  contabilidad: "Contabilidad",
  tienda: "Tienda y taller",
  logistica: "Logística",
  sistemas: "Sistemas",
};

export function navSectionDef(sectionId: NavCategory) {
  return NAV_SECTIONS.find((s) => s.id === sectionId);
}

export function esSeccionHub(sectionId: NavCategory | null): boolean {
  if (!sectionId) return false;
  // Todas las categorías del menú operan como hub (cabezote + pestañas).
  return NAV_SECTIONS.some((s) => s.id === sectionId);
}

export function navSectionForPanel(panel: Panel): NavCategory | null {
  if (panel === "etiquetas-config") return "diseno";
  for (const section of NAV_SECTIONS) {
    if (section.items.some((i) => i.panel === panel)) return section.id;
  }
  if (panel === "settings" || panel === "perfil") return null;
  return null;
}
