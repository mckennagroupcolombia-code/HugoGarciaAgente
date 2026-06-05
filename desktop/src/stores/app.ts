import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  | "tickets"
  | "etiquetas"
  | "settings";

/** Vista inicial del Centro de Mando al saltar desde Hugo u otro panel. */
export type TicketsBootView =
  | "home"
  | "list"
  | "acciones"
  | "solicitudes"
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
  ticketsBootView: TicketsBootView;
  setTicketsBootView: (v: TicketsBootView) => void;
  accionesBootTab: AccionesBootTab | null;
  setAccionesBootTab: (v: AccionesBootTab | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      panel: "hugo",
      setPanel: (panel) => set({ panel, sidebarOpen: false }),
      ticketsBootView: null,
      setTicketsBootView: (ticketsBootView) => set({ ticketsBootView }),
      accionesBootTab: null,
      setAccionesBootTab: (accionesBootTab) => set({ accionesBootTab }),
      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    { name: "mckenna-app", partialize: (s) => ({ panel: s.panel }) },
  ),
);
