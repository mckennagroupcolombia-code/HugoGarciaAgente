import type { EtiquetasTab, Panel } from "../stores/app";
import { useAppStore } from "../stores/app";
import { useInventarioCarrito } from "../stores/inventarioCarrito";
import { writeNavHash } from "./navHash";
import { mckennaAndroidBridge } from "./androidApp";

const HISTORY_KEY = "mck";

export type McKennaNavState = {
  [HISTORY_KEY]: true;
  panel: Panel;
  sidebarOpen: boolean;
  ticketsView: string;
  ticketsSelectedId: number | null;
  ticketsSelectedMisionId: number | null;
  etiquetasTab: EtiquetasTab;
};

type TicketsNavBridge = {
  getView: () => string;
  getSelectedId: () => number | null;
  getSelectedMisionId: () => number | null;
  apply: (partial: {
    view?: string;
    selectedId?: number | null;
    selectedMisionId?: number | null;
  }) => void;
};

let ticketsNavBridge: TicketsNavBridge | null = null;
const nestedBackHandlers = new Set<() => boolean>();
let applyingHistory = false;
let applyingHistoryClearTimer: ReturnType<typeof setTimeout> | null = null;
let navDepth = 0;

function isMckState(value: unknown): value is McKennaNavState {
  return Boolean(value && typeof value === "object" && (value as McKennaNavState)[HISTORY_KEY]);
}

function normalizeEtiquetasTab(value: unknown): EtiquetasTab {
  if (value === "imprimir" || value === "inventario" || value === "studio" || value === "codigos_ean") {
    return value;
  }
  return "imprimir";
}

function statesEqual(a: McKennaNavState, b: McKennaNavState): boolean {
  return (
    a.panel === b.panel
    && a.sidebarOpen === b.sidebarOpen
    && a.ticketsView === b.ticketsView
    && a.ticketsSelectedId === b.ticketsSelectedId
    && a.ticketsSelectedMisionId === b.ticketsSelectedMisionId
    && a.etiquetasTab === b.etiquetasTab
  );
}

function subViewForPanel(state: McKennaNavState): string | undefined {
  if (state.panel === "hugo" || state.panel === "tickets") {
    return state.ticketsView || undefined;
  }
  if (state.panel === "etiquetas") {
    return state.etiquetasTab || undefined;
  }
  return undefined;
}

function urlForNavState(state: McKennaNavState): string {
  const view = subViewForPanel(state);
  const hash = view ? `#/${state.panel}/${view}` : `#/${state.panel}`;
  return `${window.location.pathname}${window.location.search}${hash}`;
}

function beginApplyingHistory() {
  applyingHistory = true;
  if (applyingHistoryClearTimer != null) {
    clearTimeout(applyingHistoryClearTimer);
  }
  // Tras popstate, React monta paneles y corre effects que llaman notifyNavChange.
  // Mantener el flag hasta el siguiente macrotask para no empujar entradas espurias.
  applyingHistoryClearTimer = setTimeout(() => {
    applyingHistory = false;
    applyingHistoryClearTimer = null;
  }, 0);
}

export function captureNavState(): McKennaNavState {
  const app = useAppStore.getState();
  const bridge = ticketsNavBridge;
  return {
    [HISTORY_KEY]: true,
    panel: app.panel,
    sidebarOpen: app.sidebarOpen,
    // Preferir bridge (vista local) si Hugo está montado; si no, el store persistido.
    ticketsView: bridge?.getView() ?? app.centroMandoView ?? "home",
    ticketsSelectedId: bridge?.getSelectedId() ?? app.ticketsSelectedId,
    ticketsSelectedMisionId: bridge?.getSelectedMisionId() ?? app.ticketsSelectedMisionId,
    etiquetasTab: normalizeEtiquetasTab(app.etiquetasTab),
  };
}

function applyNavState(state: McKennaNavState) {
  beginApplyingHistory();
  const etiquetasTab = normalizeEtiquetasTab(state.etiquetasTab);
  useAppStore.setState({
    panel: state.panel,
    sidebarOpen: state.sidebarOpen,
    centroMandoView: state.ticketsView,
    ticketsSelectedId: state.ticketsSelectedId,
    ticketsSelectedMisionId: state.ticketsSelectedMisionId,
    etiquetasTab,
  });
  writeNavHash(state.panel, subViewForPanel({ ...state, etiquetasTab }));
  ticketsNavBridge?.apply({
    view: state.ticketsView,
    selectedId: state.ticketsSelectedId,
    selectedMisionId: state.ticketsSelectedMisionId,
  });
}

export function registerTicketsNavBridge(bridge: TicketsNavBridge | null) {
  ticketsNavBridge = bridge;
}

export function registerNestedBackHandler(handler: () => boolean): () => void {
  nestedBackHandlers.add(handler);
  return () => nestedBackHandlers.delete(handler);
}

/** Sincroniza el historial del navegador con la vista actual (misma URL /app). */
export function notifyNavChange() {
  if (applyingHistory || typeof window === "undefined") return;
  const next = captureNavState();
  const current = window.history.state;
  if (isMckState(current) && statesEqual(current, next)) {
    // Misma entrada: solo alinear hash/URL sin empujar.
    const url = urlForNavState(next);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
      window.history.replaceState(next, "", url);
    }
    return;
  }
  window.history.pushState(next, "", urlForNavState(next));
  navDepth += 1;
}

export function resetAppNavHistory() {
  if (typeof window === "undefined") return;
  const state = captureNavState();
  window.history.replaceState(state, "", urlForNavState(state));
  navDepth = 1;
  mckennaAndroidBridge()?.clearWebHistory?.();
}

function runNestedBackHandlers(): boolean {
  for (const handler of [...nestedBackHandlers].reverse()) {
    if (handler()) return true;
  }
  return false;
}

/** Botón atrás del móvil / popstate: vuelve a la pantalla anterior sin cerrar sesión. */
export function handleAppBack(): boolean {
  if (useInventarioCarrito.getState().modalOpen) {
    useInventarioCarrito.getState().setModalOpen(false);
    return true;
  }

  const app = useAppStore.getState();
  if (app.sidebarOpen) {
    if (navDepth > 1) {
      window.history.back();
    } else {
      useAppStore.setState({ sidebarOpen: false });
    }
    return true;
  }

  if (runNestedBackHandlers()) {
    return true;
  }

  if (navDepth > 1) {
    window.history.back();
    return true;
  }

  // En celular, desde paneles completos → volver al hub (no salir de la app).
  if (
    app.mobileShell === "app"
    && typeof window !== "undefined"
    && window.matchMedia("(max-width: 767px)").matches
  ) {
    useAppStore.setState({ mobileShell: "hub", panel: "hugo", sidebarOpen: false });
    return true;
  }

  return false;
}

function isAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function initAppBackNavigation() {
  if (typeof window === "undefined") return () => {};

  const initial = captureNavState();
  if (!isMckState(window.history.state)) {
    window.history.replaceState(initial, "", urlForNavState(initial));
    navDepth = 1;
  } else {
    navDepth = Math.max(navDepth, 1);
  }

  const onPopState = (event: PopStateEvent) => {
    if (isMckState(event.state)) {
      navDepth = Math.max(1, navDepth - 1);
      applyNavState({
        ...event.state,
        etiquetasTab: normalizeEtiquetasTab(
          (event.state as McKennaNavState).etiquetasTab
            ?? useAppStore.getState().etiquetasTab,
        ),
      });
      return;
    }

    // Estado vacío (p. ej. replaceState tras OAuth) o entrada ajena: no saltar a "inicio"
    // ni perder el panel; reanclar el historial en la vista actual.
    if (isAppPath(window.location.pathname)) {
      const current = captureNavState();
      window.history.replaceState(current, "", urlForNavState(current));
      navDepth = Math.max(1, navDepth);
    }
  };

  window.addEventListener("popstate", onPopState);

  const w = window as Window & { __mckennaHandleBack?: () => boolean };
  w.__mckennaHandleBack = handleAppBack;

  return () => {
    window.removeEventListener("popstate", onPopState);
    if (applyingHistoryClearTimer != null) {
      clearTimeout(applyingHistoryClearTimer);
      applyingHistoryClearTimer = null;
    }
    applyingHistory = false;
    if (w.__mckennaHandleBack === handleAppBack) {
      delete w.__mckennaHandleBack;
    }
  };
}
