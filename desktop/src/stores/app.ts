import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notifyNavChange } from "../lib/appBackNavigation";
import { LOGISTICA_PANEL_LEGACY } from "../lib/logisticaAccess";

export type Panel =
  | "hugo"
  | "dashboard"
  | "chat"
  | "voz"
  | "webchat"
  | "whatsapp"
  | "supervisor"
  | "preventa"
  | "postventa"
  | "sync"
  | "stock"
  | "fichas"
  | "pedidos"
  | "publicaciones"
  | "facturas"
  | "costos-productos"
  | "centros-costo"
  | "rentabilidad"
  | "tickets"
  | "etiquetas"
  | "etiquetas-config"
  | "logistica-importaciones"
  | "logistica-embarques"
  | "logistica-aduanas"
  | "logistica-proveedores"
  | "logistica-seguimiento"
  | "settings"
  | "perfil";

/** Pestaña activa dentro de Impresora · Etiquetas. */
export type EtiquetasTab = "imprimir" | "inventario" | "studio";

/** Datos para abrir Impresión con un producto o plantilla precargados. */
export interface EtiquetasHandoff {
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
  forma?: string;
  calidad?: string;
  rotacion?: string;
  pdf_ruta?: string;
  pdf_nombre?: string;
  lote_defecto?: string;
  vencimiento_defecto?: string;
  lote_pos?: string;
  lote_font?: number;
  lote_x_pct?: number;
  lote_y_pct?: number;
  campos_texto?: unknown[];
  lineas?: unknown[];
  imagenes?: unknown[];
  rectangulos?: unknown[];
}

/** Solicitud de etiquetas abierta desde Centro de Mando → panel Imprimir. */
export interface EtiquetasSolicitudActiva {
  id: number;
  titulo?: string;
  descripcion?: string;
  numero?: string;
  creado_por_nombre?: string | null;
}

/** Vista inicial del Centro de Mando al saltar desde Hugo u otro panel. */
export type TicketsBootView =
  | "agente"
  | "home"
  | "list"
  | "acciones"
  | "solicitudes"
  | "contratos"
  | null;

/** Salto desde otro panel (p. ej. Impresora · Etiquetas) hacia Solicitudes. */
export interface SolicitudBoot {
  abrirWizard?: boolean;
  prefillTitulo?: string;
  prefillDescripcion?: string;
  abrirTicketId?: number;
}

export type AccionesBootTab =
  | "subhome"
  | "activas"
  | "pendientes"
  | "procedimientos"
  | "historial"
  | "agenda"
  | "notas"
  | "bolsillo";

/** Salto desde otro panel (p. ej. Sincronización) hacia una pestaña de Rentabilidad. */
export type RentabilidadBootTab = "combos" | "nomina" | "servicios" | "periodo" | "precios";

interface AppState {
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Vista activa dentro de Hugo / Centro de Mando (p. ej. agente, home, list). */
  centroMandoView: string;
  setCentroMandoView: (v: string) => void;
  ticketsBootView: TicketsBootView;
  setTicketsBootView: (v: TicketsBootView) => void;
  solicitudBoot: SolicitudBoot | null;
  setSolicitudBoot: (v: SolicitudBoot | null) => void;
  accionesBootTab: AccionesBootTab | null;
  setAccionesBootTab: (v: AccionesBootTab | null) => void;
  rentabilidadBootTab: RentabilidadBootTab | null;
  setRentabilidadBootTab: (v: RentabilidadBootTab | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  etiquetasTab: EtiquetasTab;
  setEtiquetasTab: (t: EtiquetasTab) => void;
  etiquetasHandoff: EtiquetasHandoff | null;
  setEtiquetasHandoff: (h: EtiquetasHandoff | null) => void;
  etiquetasSolicitudActiva: EtiquetasSolicitudActiva | null;
  setEtiquetasSolicitudActiva: (s: EtiquetasSolicitudActiva | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      panel: "hugo",
      centroMandoView: "home",
      setCentroMandoView: (centroMandoView) => set({ centroMandoView }),
      setPanel: (panel) => {
        let next = panel === "tickets" ? "hugo" : panel;
        if ((next as string) === LOGISTICA_PANEL_LEGACY) next = "logistica-importaciones";
        set({ panel: next, sidebarOpen: false });
        queueMicrotask(() => notifyNavChange());
      },
      ticketsBootView: null,
      setTicketsBootView: (ticketsBootView) => set({ ticketsBootView }),
      solicitudBoot: null,
      setSolicitudBoot: (solicitudBoot) => set({ solicitudBoot }),
      accionesBootTab: null,
      setAccionesBootTab: (accionesBootTab) => set({ accionesBootTab }),
      rentabilidadBootTab: null,
      setRentabilidadBootTab: (rentabilidadBootTab) => set({ rentabilidadBootTab }),
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => {
        set({ sidebarOpen });
        queueMicrotask(() => notifyNavChange());
      },
      toggleSidebar: () => {
        set((s) => ({ sidebarOpen: !s.sidebarOpen }));
        queueMicrotask(() => notifyNavChange());
      },
      etiquetasTab: "imprimir",
      setEtiquetasTab: (etiquetasTab) => set({ etiquetasTab }),
      etiquetasHandoff: null,
      setEtiquetasHandoff: (etiquetasHandoff) => set({ etiquetasHandoff }),
      etiquetasSolicitudActiva: null,
      setEtiquetasSolicitudActiva: (etiquetasSolicitudActiva) => set({ etiquetasSolicitudActiva }),
    }),
    {
      name: "mckenna-app",
      partialize: (s) => ({ panel: s.panel }),
      migrate: (persisted) => {
        const s = persisted as { panel?: string };
        if (s?.panel === LOGISTICA_PANEL_LEGACY) s.panel = "logistica-importaciones";
        return persisted as AppState;
      },
      version: 1,
    },
  ),
);
