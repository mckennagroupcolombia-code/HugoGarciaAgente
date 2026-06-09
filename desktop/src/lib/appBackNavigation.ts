import type { Panel } from "../stores/app";
import { useAppStore } from "../stores/app";
import { useInventarioCarrito } from "../stores/inventarioCarrito";
import { mckennaAndroidBridge } from "./androidApp";

const HISTORY_KEY = "mck";

export type McKennaNavState = {
  [HISTORY_KEY]: true;
  panel: Panel;
  sidebarOpen: boolean;
  ticketsView: string;
  ticketsSelectedId: number | null;
  ticketsSelectedMisionId: number | null;
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
let navDepth = 0;

function isMckState(value: unknown): value is McKennaNavState {
  return Boolean(value && typeof value === "object" && (value as McKennaNavState)[HISTORY_KEY]);
}

function statesEqual(a: McKennaNavState, b: McKennaNavState): boolean {
  return (
    a.panel === b.panel
    && a.sidebarOpen === b.sidebarOpen
    && a.ticketsView === b.ticketsView
    && a.ticketsSelectedId === b.ticketsSelectedId
    && a.ticketsSelectedMisionId === b.ticketsSelectedMisionId
  );
}

export function captureNavState(): McKennaNavState {
  const app = useAppStore.getState();
  const bridge = ticketsNavBridge;
  return {
    [HISTORY_KEY]: true,
    panel: app.panel,
    sidebarOpen: app.sidebarOpen,
    ticketsView: bridge?.getView() ?? "home",
    ticketsSelectedId: bridge?.getSelectedId() ?? null,
    ticketsSelectedMisionId: bridge?.getSelectedMisionId() ?? null,
  };
}

function applyNavState(state: McKennaNavState) {
  applyingHistory = true;
  try {
    const app = useAppStore.getState();
    if (app.sidebarOpen !== state.sidebarOpen) {
      useAppStore.setState({ sidebarOpen: state.sidebarOpen });
    }
    if (app.panel !== state.panel) {
      useAppStore.setState({ panel: state.panel, sidebarOpen: state.sidebarOpen });
    }
    ticketsNavBridge?.apply({
      view: state.ticketsView,
      selectedId: state.ticketsSelectedId,
      selectedMisionId: state.ticketsSelectedMisionId,
    });
  } finally {
    applyingHistory = false;
  }
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
  if (isMckState(current) && statesEqual(current, next)) return;
  window.history.pushState(next, "", window.location.pathname + window.location.search);
  navDepth += 1;
}

export function resetAppNavHistory() {
  if (typeof window === "undefined") return;
  const state = captureNavState();
  window.history.replaceState(state, "", window.location.pathname + window.location.search);
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

  return false;
}

export function initAppBackNavigation() {
  if (typeof window === "undefined") return () => {};

  const initial = captureNavState();
  if (!isMckState(window.history.state)) {
    window.history.replaceState(initial, "", window.location.pathname + window.location.search);
    navDepth = 1;
  } else {
    navDepth = Math.max(navDepth, 1);
  }

  const onPopState = (event: PopStateEvent) => {
    if (!isMckState(event.state)) return;
    navDepth = Math.max(1, navDepth - 1);
    applyNavState(event.state);
  };

  window.addEventListener("popstate", onPopState);

  const w = window as Window & { __mckennaHandleBack?: () => boolean };
  w.__mckennaHandleBack = handleAppBack;

  return () => {
    window.removeEventListener("popstate", onPopState);
    if (w.__mckennaHandleBack === handleAppBack) {
      delete w.__mckennaHandleBack;
    }
  };
}
