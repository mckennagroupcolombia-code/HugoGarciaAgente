import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notifyNavChange } from "../lib/appBackNavigation";

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
  | "centros-costo"
  | "rentabilidad"
  | "tickets"
  | "etiquetas"
  | "etiquetas-config"
  | "settings"
  | "perfil";

/** Pestaña activa dentro de Impresora · Etiquetas. */
export type EtiquetasTab = "imprimir" | "plantillas" | "inventario";

/** Datos para abrir Impresión con un producto o plantilla precargados. */
export interface EtiquetasHandoff {
  tipo_etiqueta?: string;
  rotacion?: string;
  campos_texto?: unknown[];
  lineas?: unknown[];
  imagenes?: unknown[];
  rectangulos?: unknown[];
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

export type AccionesBootTab =
  | "subhome"
  | "activas"
  | "pendientes"
  | "recordatorios"
  | "procedimientos"
  | "historial";

interface AppState {
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Vista activa dentro de Hugo / Centro de Mando (p. ej. agente, home, list). */
  centroMandoView: string;
  setCentroMandoView: (v: string) => void;
  ticketsBootView: TicketsBootView;
  setTicketsBootView: (v: TicketsBootView) => void;
  accionesBootTab: AccionesBootTab | null;
  setAccionesBootTab: (v: AccionesBootTab | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  etiquetasTab: EtiquetasTab;
  setEtiquetasTab: (t: EtiquetasTab) => void;
  etiquetasHandoff: EtiquetasHandoff | null;
  setEtiquetasHandoff: (h: EtiquetasHandoff | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      panel: "hugo",
      centroMandoView: "home",
      setCentroMandoView: (centroMandoView) => set({ centroMandoView }),
      setPanel: (panel) => {
        const next = panel === "tickets" ? "hugo" : panel;
        set({ panel: next, sidebarOpen: false });
        queueMicrotask(() => notifyNavChange());
      },
      ticketsBootView: null,
      setTicketsBootView: (ticketsBootView) => set({ ticketsBootView }),
      accionesBootTab: null,
      setAccionesBootTab: (accionesBootTab) => set({ accionesBootTab }),
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
    }),
    { name: "mckenna-app", partialize: (s) => ({ panel: s.panel }) },
  ),
);
