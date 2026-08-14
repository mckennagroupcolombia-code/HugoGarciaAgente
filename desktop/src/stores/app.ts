import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notifyNavChange } from "../lib/appBackNavigation";
import { readNavHash, writeNavHash } from "../lib/navHash";
import { LOGISTICA_PANEL_LEGACY } from "../lib/logisticaAccess";
import { CONTABILIDAD_PANEL_OCULTO, normalizarPanelContabilidad } from "../lib/contabilidadAccess";

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
  | "empaque"
  | "publicaciones"
  | "sitioweb"
  | "facturacion"
  | "facturas"
  | "costos-productos"
  | "centros-costo"
  | "rentabilidad"
  | "compras-exterior"
  | "productos-siigo"
  | "rrhh"
  | "operativos"
  | "impuestos"
  | "servicios"
  | "ingresos-egresos"
  | "libro-mayor"
  | "tickets"
  | "etiquetas"
  | "etiquetas-config"
  | "placas-concreto"
  | "logistica-importaciones"
  | "logistica-embarques"
  | "logistica-aduanas"
  | "logistica-proveedores"
  | "logistica-seguimiento"
  | "control-versiones"
  | "meli-oauth"
  | "tareas-programadas"
  | "settings"
  | "perfil";

/** Pestaña activa dentro de Impresora · Etiquetas. */
export type EtiquetasTab = "imprimir" | "inventario" | "studio" | "codigos_ean";

export type MobileHubTab = "home" | "chat" | "acciones" | "yo";

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
export type RentabilidadBootTab = "combos" | "nomina" | "servicios" | "periodo" | "cobros-meli" | "ganancia";

interface AppState {
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Vista activa dentro de Hugo / Centro de Mando (p. ej. home, acciones, list). */
  centroMandoView: string;
  setCentroMandoView: (v: string) => void;
  ticketsSelectedId: number | null;
  setTicketsSelectedId: (id: number | null) => void;
  ticketsSelectedMisionId: number | null;
  setTicketsSelectedMisionId: (id: number | null) => void;
  mobileTab: MobileHubTab;
  setMobileTab: (t: MobileHubTab) => void;
  /** En viewport móvil: hub simplificado vs paneles completos (Layout). */
  mobileShell: "hub" | "app";
  setMobileShell: (s: "hub" | "app") => void;
  ticketsBootView: TicketsBootView;
  setTicketsBootView: (v: TicketsBootView) => void;
  solicitudBoot: SolicitudBoot | null;
  setSolicitudBoot: (v: SolicitudBoot | null) => void;
  accionesBootTab: AccionesBootTab | null;
  setAccionesBootTab: (v: AccionesBootTab | null) => void;
  /** One-shot: Acciones → «Continuar donde quedé» abre ejecución en Hugo. No persistir. */
  hugoAccionBoot: { id: number; titulo: string } | null;
  setHugoAccionBoot: (v: { id: number; titulo: string } | null) => void;
  rentabilidadBootTab: RentabilidadBootTab | null;
  setRentabilidadBootTab: (v: RentabilidadBootTab | null) => void;
  /** Abrir detalle de factura pendiente al entrar al panel Facturas. */
  facturasBootSufijo: string | null;
  setFacturasBootSufijo: (v: string | null) => void;
  /** Vista interna al abrir Facturas desde el menú Facturación. */
  facturasBootVista: "pendientes" | "historial" | "consultar" | null;
  setFacturasBootVista: (v: "pendientes" | "historial" | "consultar" | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  etiquetasTab: EtiquetasTab;
  setEtiquetasTab: (t: EtiquetasTab) => void;
  /** Studio visual en vista de lienzo (editor): Layout usa fill sin padding. */
  etiquetasStudioInmersivo: boolean;
  setEtiquetasStudioInmersivo: (v: boolean) => void;
  etiquetasHandoff: EtiquetasHandoff | null;
  setEtiquetasHandoff: (h: EtiquetasHandoff | null) => void;
  etiquetasSolicitudActiva: EtiquetasSolicitudActiva | null;
  setEtiquetasSolicitudActiva: (s: EtiquetasSolicitudActiva | null) => void;
  /** true tras rehidratar localStorage — evita saltos de panel al refrescar. */
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
}

function normalizePanel(panel: Panel): Panel {
  let next = panel === "tickets" ? "hugo" : panel;
  if ((next as string) === LOGISTICA_PANEL_LEGACY) next = "logistica-importaciones";
  if ((next as string) === CONTABILIDAD_PANEL_OCULTO) next = "facturacion";
  const contab = normalizarPanelContabilidad(next);
  if (contab) next = contab;
  return next;
}

function syncNavHash(panel: Panel, view?: string) {
  const p = normalizePanel(panel);
  writeNavHash(p, view);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      panel: "hugo",
      centroMandoView: "home",
      ticketsSelectedId: null,
      ticketsSelectedMisionId: null,
      mobileTab: "home",
      mobileShell: "hub",
      setMobileShell: (mobileShell) => set({ mobileShell }),
      _hasHydrated: false,
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
      setCentroMandoView: (centroMandoView) => {
        if (get().centroMandoView === centroMandoView) return;
        set({ centroMandoView });
        queueMicrotask(() => notifyNavChange());
      },
      setTicketsSelectedId: (ticketsSelectedId) => {
        if (get().ticketsSelectedId === ticketsSelectedId) return;
        set({ ticketsSelectedId });
        queueMicrotask(() => notifyNavChange());
      },
      setTicketsSelectedMisionId: (ticketsSelectedMisionId) => {
        if (get().ticketsSelectedMisionId === ticketsSelectedMisionId) return;
        set({ ticketsSelectedMisionId });
        queueMicrotask(() => notifyNavChange());
      },
      setMobileTab: (mobileTab) => set({ mobileTab }),
      setPanel: (panel) => {
        const next = normalizePanel(panel);
        const cur = get();
        if (cur.panel === next && !cur.sidebarOpen) return;
        // Al abrir un panel operativo desde el hub, pasar al Layout responsive.
        const shell =
          cur.mobileShell === "hub" && next !== "hugo" && next !== "tickets"
            ? ("app" as const)
            : cur.mobileShell;
        set({ panel: next, sidebarOpen: false, mobileShell: shell });
        queueMicrotask(() => notifyNavChange());
      },
      ticketsBootView: null,
      setTicketsBootView: (ticketsBootView) => set({ ticketsBootView }),
      solicitudBoot: null,
      setSolicitudBoot: (solicitudBoot) => set({ solicitudBoot }),
      accionesBootTab: null,
      setAccionesBootTab: (accionesBootTab) => set({ accionesBootTab }),
      hugoAccionBoot: null,
      setHugoAccionBoot: (hugoAccionBoot) => set({ hugoAccionBoot }),
      rentabilidadBootTab: null,
      setRentabilidadBootTab: (rentabilidadBootTab) => set({ rentabilidadBootTab }),
      facturasBootSufijo: null,
      setFacturasBootSufijo: (facturasBootSufijo) => set({ facturasBootSufijo }),
      facturasBootVista: null,
      setFacturasBootVista: (facturasBootVista) => set({ facturasBootVista }),
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => {
        if (get().sidebarOpen === sidebarOpen) return;
        set({ sidebarOpen });
        queueMicrotask(() => notifyNavChange());
      },
      toggleSidebar: () => {
        set((s) => ({ sidebarOpen: !s.sidebarOpen }));
        queueMicrotask(() => notifyNavChange());
      },
      etiquetasTab: "imprimir",
      setEtiquetasTab: (etiquetasTab) => {
        if (get().etiquetasTab === etiquetasTab) return;
        set({
          etiquetasTab,
          ...(etiquetasTab !== "studio" ? { etiquetasStudioInmersivo: false } : {}),
        });
        queueMicrotask(() => notifyNavChange());
      },
      etiquetasStudioInmersivo: false,
      setEtiquetasStudioInmersivo: (etiquetasStudioInmersivo) => {
        if (get().etiquetasStudioInmersivo === etiquetasStudioInmersivo) return;
        set({ etiquetasStudioInmersivo });
      },
      etiquetasHandoff: null,
      setEtiquetasHandoff: (etiquetasHandoff) => set({ etiquetasHandoff }),
      etiquetasSolicitudActiva: null,
      setEtiquetasSolicitudActiva: (etiquetasSolicitudActiva) => set({ etiquetasSolicitudActiva }),
    }),
    {
      name: "mckenna-app",
      partialize: (s) => ({
        panel: s.panel,
        centroMandoView: s.centroMandoView,
        ticketsSelectedId: s.ticketsSelectedId,
        ticketsSelectedMisionId: s.ticketsSelectedMisionId,
        mobileTab: s.mobileTab,
        mobileShell: s.mobileShell,
        etiquetasTab: s.etiquetasTab,
      }),
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        if (s.panel === LOGISTICA_PANEL_LEGACY) s.panel = "logistica-importaciones";
        if (s.panel === CONTABILIDAD_PANEL_OCULTO) s.panel = "facturacion";
        if (s.panel === "sync" || s.panel === "facturas") s.panel = "facturacion";
        if (version < 2) {
          if (!s.centroMandoView) s.centroMandoView = "home";
          if (!s.mobileTab) s.mobileTab = "home";
          if (!s.etiquetasTab) s.etiquetasTab = "imprimir";
        }
        if (version < 3) {
          if (!s.mobileShell) s.mobileShell = "hub";
        }
        return s as unknown as AppState;
      },
      version: 3,
      onRehydrateStorage: () => (state) => {
        const hash = readNavHash();
        if (hash?.panel && state) {
          state.panel = normalizePanel(hash.panel);
          if (hash.view && (hash.panel === "hugo" || hash.panel === "tickets")) {
            state.centroMandoView = hash.view;
          }
          if (
            hash.view
            && hash.panel === "etiquetas"
            && (hash.view === "imprimir"
              || hash.view === "inventario"
              || hash.view === "studio"
              || hash.view === "codigos_ean")
          ) {
            state.etiquetasTab = hash.view;
          }
        }
        state?.setHasHydrated(true);
        if (state) {
          syncNavHash(
            state.panel,
            state.panel === "hugo" || state.panel === "tickets"
              ? state.centroMandoView
              : state.panel === "etiquetas"
                ? state.etiquetasTab
                : undefined,
          );
        }
      },
    },
  ),
);

/** Espera a que localStorage restaure panel y sub-vistas. */
export function waitForAppHydration(): Promise<void> {
  if (useAppStore.getState()._hasHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useAppStore.subscribe((s) => {
      if (s._hasHydrated) {
        unsub();
        resolve();
      }
    });
  });
}
