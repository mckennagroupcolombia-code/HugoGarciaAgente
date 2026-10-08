import type { Panel } from "../stores/app";
import type { PanelTier } from "./panelInfo";
import { CONTABILIDAD_PANELS, CONTABILIDAD_TAB_OCULTAS } from "./contabilidadAccess";

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
  | "contabilidad"
  | "negocio"
  | "inventario"
  | "publicaciones"
  | "placas"
  | "contenido"
  | "sistemas"
  | "facturacion";

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
    label: "Agenda",
    hub: true,
    items: [
      // El mapa va primero: es la pantalla de inicio y el primer panel al que se cae si
      // el guardado no está permitido (NAV_PANEL_ORDER sale de este orden).
      { panel: "mapa-vivo", tier: "core" },
      { panel: "hugo", tier: "core" },
      { panel: "dashboard", tier: "core" },
      { panel: "mapa-sistema", tier: "core" },
      { panel: "chat-equipo", tier: "core" },
      { panel: "colaboradores", tier: "core" },
      { panel: "juegos", tier: "core" },
      { panel: "empresa-viva", tier: "core" },
    ],
  },
  {
    id: "atencion",
    label: "Atención",
    hub: true,
    items: [
      { panel: "preventa", tier: "core" },
      { panel: "postventa", tier: "core" },
      { panel: "ventas-email", tier: "core" },
      { panel: "pedidos", tier: "core" },
      { panel: "empaque", tier: "core" },
      { panel: "guias-envio", tier: "core" },
      { panel: "entregas-flex", tier: "standard" },
      { panel: "whatsapp", tier: "standard" },
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
    label: "Diseño de producto",
    hub: true,
    // Los documentos técnicos (FT · COA · SDS) viven aquí desde el 27-sep-2026: son una
    // pieza más del producto, como la etiqueta y el EAN. Antes eran la sección «Docs técnicos».
    items: [
      { panel: "etiquetas", tier: "core" },
      { panel: "fichas", tier: "standard" },
      // Fórmulas de producto (1-oct-2026): receta de elaboración, con permiso propio.
      { panel: "formulas", tier: "standard" },
      // Desarrollar idea (4-oct-2026): la idea de producto abierta en un cladograma, con IA.
      { panel: "ideas", tier: "standard" },
    ],
  },
  {
    id: "contabilidad",
    label: "Contabilidad",
    hub: true,
    // Operativos es "standard" a propósito (15-sep-2026): adentro vive
    // Mensajería, que la lleva despachos a diario (Flujo K). Con tier
    // "advanced" la pestaña no aparecía hasta activar el modo avanzado, así que
    // quien tiene el permiso no encontraba el panel — el permiso decide el
    // acceso, el modo avanzado solo esconde lo que casi nadie usa.
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
    // Indicadores de "cómo va el negocio" — sin relación con la partida doble
    // (antes convivían dentro de Contabilidad solo por historia).
    id: "negocio",
    label: "Negocio",
    hub: true,
    items: [
      { panel: "rentabilidad", tier: "standard" },
      { panel: "publicidad", tier: "standard" },
      { panel: "salud-negocio", tier: "standard" },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    hub: true,
    items: [
      { panel: "control-inventario", tier: "core" },
      { panel: "recepcion-mercancia", tier: "core" },
      { panel: "stock", tier: "standard" },
      { panel: "mapa-sistema", tier: "standard" },
    ],
  },
  {
    // Individual (como Diseño): no agrupado en "Tienda y taller".
    id: "publicaciones",
    label: "Publicaciones",
    hub: true,
    // La pestaña «Publicaciones» (Catálogo, Galería, Republicar MeLi, Crear desde cero…)
    // salió del menú el 28-sep-2026: no se usaba. El panel sigue vivo para el paso
    // Publicación del taller de combos, que salta a él (ver navSectionForPanel).
    // «Canales del producto» también salió el 6-oct-2026: no se usaba.
    items: [
      { panel: "vitrina-web", tier: "standard" },
    ],
  },
  {
    id: "placas",
    label: "Placas",
    hub: true,
    items: [{ panel: "placas-concreto", tier: "standard" }],
  },
  {
    id: "contenido",
    label: "Contenido",
    hub: true,
    items: [{ panel: "contenido", tier: "standard" }],
  },
  {
    id: "sistemas",
    label: "Sistemas",
    hub: true,
    advancedOnly: true,
    items: [
      { panel: "mapa-sistema", tier: "advanced" },
      { panel: "arquitectura", tier: "advanced" },
      { panel: "supervisor", tier: "advanced" },
      { panel: "voz", tier: "advanced" },
      { panel: "control-versiones", tier: "advanced" },
      { panel: "telemetria", tier: "advanced" },
      // «Conexión MercadoLibre» y «Conexión Gmail» viven dentro de Conexiones desde el
      // 28-sep-2026 (junto con WhatsApp, Alegra, Google, IA…); sus paneles siguen
      // existiendo para enlaces viejos, pero ya no ocupan dos entradas del menú.
      { panel: "conexiones", tier: "advanced" },
      { panel: "tareas-programadas", tier: "advanced" },
    ],
  },
  {
    // Separada de Contabilidad: Facturación (Sync, Facturas de compra, Ventas y
    // NC, Astro Killer) es su propia sección de nivel superior — antes convivía
    // como dos pestañas sueltas ("Facturación" y "Astro Killer") dentro del hub
    // Contabilidad, lo cual no tenía sentido siendo ambas sobre facturación.
    id: "facturacion",
    label: "Facturación",
    hub: true,
    items: [{ panel: "facturacion", tier: "standard" }],
  },
] as const;

/** Orden de fallback al validar panel persistido (login / refresh). */
export const NAV_PANEL_ORDER: Panel[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.panel)),
  "settings",
  "perfil",
];

export const NAV_CATEGORY_LABEL: Record<NavCategory, string> = {
  inicio: "Agenda",
  atencion: "Atención",
  canales: "Canales",
  diseno: "Diseño de producto",
  contabilidad: "Contabilidad",
  negocio: "Negocio",
  inventario: "Inventario",
  publicaciones: "Publicaciones",
  placas: "Placas",
  contenido: "Contenido",
  sistemas: "Sistemas",
  facturacion: "Facturación",
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
  if (panel === "publicaciones") return "publicaciones";
  for (const section of NAV_SECTIONS) {
    if (section.items.some((i) => i.panel === panel)) return section.id;
  }
  if (panel === "settings" || panel === "perfil") return null;
  return null;
}
