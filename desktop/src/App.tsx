import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useAppStore, type Panel, waitForAppHydration } from "./stores/app";
import { useTicketsAuth, type TicketsUser } from "./stores/ticketsAuth";
import MobileHub, { useMobileLayout } from "./components/MobileHub";
import Layout from "./components/Layout";
import Dashboard from "./components/Dashboard";
import TicketsPanel from "./components/TicketsPanel";

// Paneles bajo demanda: cada uno baja en su propio chunk al abrirlo, en vez de
// inflar el bundle inicial. Dashboard y TicketsPanel quedan estáticos por ser
// los paneles de aterrizaje.
const Chat = lazy(() => import("./components/Chat"));
const VozIA = lazy(() => import("./components/VozIA"));
const PreventaPanel = lazy(() => import("./components/PreventaPanel"));
const PostventaPanel = lazy(() => import("./components/PostventaPanel"));
const StockPanel = lazy(() => import("./components/StockPanel"));
const FichasTecnicasPanel = lazy(() => import("./components/FichasTecnicasPanel"));
const PedidosWebPanel = lazy(() => import("./components/PedidosWebPanel"));
const ContabilidadPanel = lazy(() => import("./components/ContabilidadPanel"));
const WebChatPanel = lazy(() => import("./components/WebChatPanel"));
const WhatsAppPanel = lazy(() => import("./components/WhatsAppPanel"));
const SupervisorPanel = lazy(() => import("./components/SupervisorPanel"));
const EtiquetasPanel = lazy(() => import("./components/EtiquetasPanel"));
const ConfigurarProductosPanel = lazy(() =>
  import("./components/EtiquetasPanel").then((m) => ({
    default: m.ConfigurarProductosPanel,
  })),
);
const PlacasConcretoPanel = lazy(() => import("./components/PlacasConcretoPanel"));
const PublicacionesPanel = lazy(() => import("./components/PublicacionesPanel"));
const SitioWebPanel = lazy(() => import("./components/SitioWebPanel"));
const LogisticaInternacionalPanel = lazy(
  () => import("./components/LogisticaInternacionalPanel"),
);
const Settings = lazy(() => import("./components/Settings"));
const PerfilPanel = lazy(() => import("./components/PerfilPanel"));
import { usePanelTheme } from "./stores/panelTheme";
import { useQuestTheme } from "./stores/questTheme";
import {
  applyUserUiPreferences,
  resetSaveBaseline,
  scheduleSaveUserUiPreferences,
} from "./lib/userThemeSync";
import { googleAuthStartUrl, isMcKennaAndroidApp, mckennaAndroidBridge } from "./lib/androidApp";
import { initAppBackNavigation, resetAppNavHistory } from "./lib/appBackNavigation";
import { onPanelResume } from "./lib/panelRefresh";
import { esPanelContabilidad, puedeVerModuloContabilidad } from "./lib/contabilidadAccess";
import { puedeVerModuloLogistica } from "./lib/logisticaAccess";
import { NAV_PANEL_ORDER } from "./lib/navStructure";

function PanelCargando() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted">
      Cargando panel…
    </div>
  );
}

function PanelRouter() {
  return (
    <Suspense fallback={<PanelCargando />}>
      <PanelRouterInner />
    </Suspense>
  );
}

function PanelRouterInner() {
  const panel = useAppStore((s) => s.panel);
  switch (panel) {
    case "hugo":
    case "tickets":
      return <TicketsPanel />;
    case "dashboard":
      return <Dashboard />;
    case "chat":
      return <Chat />;
    case "voz":
      return <VozIA />;
    case "webchat":
      return <WebChatPanel />;
    case "whatsapp":
      return <WhatsAppPanel />;
    case "supervisor":
      return <SupervisorPanel />;
    case "preventa":
      return <PreventaPanel />;
    case "postventa":
      return <PostventaPanel />;
    case "sync":
    case "facturas":
    case "costos-productos":
    case "rentabilidad":
    case "compras-exterior":
    case "productos-siigo":
    case "rrhh":
      return <ContabilidadPanel />;
    case "stock":
      return <StockPanel />;
    case "fichas":
      return <FichasTecnicasPanel />;
    case "pedidos":
      return <PedidosWebPanel />;
    case "etiquetas":
      return <EtiquetasPanel />;
    case "etiquetas-config":
      return <ConfigurarProductosPanel />;
    case "placas-concreto":
      return <PlacasConcretoPanel />;
    case "publicaciones":
      return <PublicacionesPanel />;
    case "sitioweb":
      return <SitioWebPanel />;
    case "logistica-importaciones":
    case "logistica-embarques":
    case "logistica-aduanas":
    case "logistica-proveedores":
    case "logistica-seguimiento":
      return <LogisticaInternacionalPanel />;
    case "settings":
      return <Settings />;
    case "perfil":
      return <PerfilPanel />;
    default:
      return esPanelContabilidad(panel) ? <ContabilidadPanel /> : <Dashboard />;
  }
}

function AppLoginView({ onLogin }: { onLogin: (token: string, user: TicketsUser, apiToken?: string | null) => void }) {
  const [authError, setAuthError] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return decodeURIComponent(p.get("auth_error") || "");
  });
  // Empieza en loading=true si hay _token en la URL para evitar el flash del formulario
  const [loading, setLoading] = useState(() => !!new URLSearchParams(window.location.search).get("_token"));

  const consumeToken = useCallback((token: string) => {
    setLoading(true);
    fetch("/api/tickets/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((u) => {
        if (u?.id) {
          onLogin(token, u as TicketsUser, u.api_token ?? null);
        } else {
          setAuthError("Sesión inválida. Intenta de nuevo.");
          setLoading(false);
        }
      })
      .catch(() => {
        setAuthError("Error al verificar sesión. Intenta de nuevo.");
        setLoading(false);
      });
  }, [onLogin]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const token = p.get("_token");
    const err = p.get("auth_error");
    if (token || err) {
      // Conservar history.state de la app (mck) al limpiar ?_token= / auth_error
      const keep = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : { mck: true };
      window.history.replaceState(keep, "", window.location.pathname);
    }
    if (err) {
      setAuthError(decodeURIComponent(err));
      return;
    }
    if (token) consumeToken(token);
  }, [consumeToken]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-paper border-2 border-border bg-surface-panel p-8 shadow-paper">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white text-3xl font-black shadow-[0_4px_0_#045159]">
            M
          </div>
          <h1 className="text-xl font-extrabold text-ink">Panel de Operaciones</h1>
          <p className="mt-1 text-sm text-muted">McKenna Group</p>
        </div>

        {authError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {authError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <a
            href={googleAuthStartUrl()}
            className="flex w-full items-center justify-center gap-3 rounded-paper border-2 border-border bg-surface py-3 text-sm font-semibold text-ink shadow-sm transition hover:border-accent hover:bg-surface-hover active:translate-y-0.5"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
              <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.5-.4-3.5z" fill="#FFC107"/>
              <path d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/>
              <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z" fill="#4CAF50"/>
              <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.2-.1-2.5-.4-3.5z" fill="#1976D2"/>
            </svg>
            Iniciar sesión con Google
          </a>
        )}

        <p className="mt-5 text-center text-xs text-muted">
          Solo cuentas autorizadas por el administrador
        </p>
      </div>
    </div>
  );
}

const NAV_ORDER: Panel[] = NAV_PANEL_ORDER;

function puedeVerPanel(user: TicketsUser, panel: Panel): boolean {
  if (panel === "perfil") return true;
  const logistica = puedeVerModuloLogistica(user, panel);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, panel);
  if (contab !== null) return contab;
  if (panel === "etiquetas") return true;
  if (panel === "hugo" || panel === "tickets") {
    if ((user.rol?.nivel ?? 0) >= 3) return true;
    const p = user.permisos_secciones;
    if (!p) return true;
    return Boolean(p.tickets);
  }
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return panel === "settings";
  if (panel === "postventa" && p.preventa) return true;
  // Sitio Web comparte permiso con Publicaciones (ambos editan contenido de la tienda)
  if (panel === "sitioweb" && p.publicaciones) return true;
  return Boolean(p[panel]);
}

async function refreshTicketsSession(
  token: string,
  setAuth: (token: string, user: TicketsUser, apiToken?: string | null) => void,
  clear: () => void,
) {
  try {
    const res = await fetch(`/api/tickets/auth/me?_t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}`, Pragma: "no-cache" },
      cache: "no-store",
    });
    if (!res.ok) {
      clear();
      return;
    }
    const u = await res.json();
    if (u?.id) {
      setAuth(token, u as TicketsUser, u.api_token ?? null);
      if (u.api_token) mckennaAndroidBridge()?.saveApiToken?.(u.api_token);
    } else {
      clear();
    }
  } catch {
    /* red sin conexión: conservar sesión local */
  }
}

export default function App() {
  const { user, token, setAuth, clear } = useTicketsAuth();
  const applyTheme = usePanelTheme((s) => s.apply);
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const lastAppliedPrefs = useRef<string | null>(null);
  const isMobile = useMobileLayout();
  const [forceDesktop, setForceDesktop] = useState(
    () =>
      (typeof localStorage !== "undefined" && localStorage.getItem("mck-force-desktop") === "1") ||
      isMcKennaAndroidApp()
  );
  const showMobile = isMobile && !forceDesktop;

  useEffect(() => {
    document.documentElement.classList.remove("mck-apk");
  }, []);

  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  // Tema personalizado por usuario (servidor)
  useEffect(() => {
    if (!user || !token) {
      lastAppliedPrefs.current = null;
      return;
    }
    const json = JSON.stringify(user.preferencias_ui ?? null);
    if (json === lastAppliedPrefs.current) return;
    lastAppliedPrefs.current = json;
    applyUserUiPreferences(user.preferencias_ui);
    resetSaveBaseline(user.preferencias_ui);
  }, [user, token]);

  useEffect(() => {
    if (!token) return;
    const unsubPanel = usePanelTheme.subscribe((state, prev) => {
      if (
        state.mode === prev.mode
        && state.fontSans === prev.fontSans
        && state.accentRgb === prev.accentRgb
        && state.radius === prev.radius
      ) {
        return;
      }
      scheduleSaveUserUiPreferences(token);
    });
    const unsubQuest = useQuestTheme.subscribe((state, prev) => {
      if (state.dark === prev.dark) return;
      scheduleSaveUserUiPreferences(token);
    });
    return () => {
      unsubPanel();
      unsubQuest();
    };
  }, [token]);

  useEffect(() => initAppBackNavigation(), []);

  const navHistoryReset = useRef(false);
  useEffect(() => {
    if (!user || !token || !hasHydrated) {
      if (!user || !token) navHistoryReset.current = false;
      return;
    }
    if (navHistoryReset.current) return;
    navHistoryReset.current = true;
    resetAppNavHistory();
  }, [user, token, hasHydrated]);

  // Revalidar sesión al abrir y al volver a la app (evita user.id obsoleto en filtros del móvil)
  useEffect(() => {
    if (!token) return;
    void refreshTicketsSession(token, setAuth, clear);
    return onPanelResume(() => { void refreshTicketsSession(token, setAuth, clear); });
  }, [token, setAuth, clear]);

  // Centro de Mando quedó integrado en Hugo (misma ruta de panel)
  useEffect(() => {
    if (panel === "tickets") setPanel("hugo");
  }, [panel, setPanel]);

  // Si el panel guardado no es visible para este usuario, ir al primero disponible
  useEffect(() => {
    if (!user || !hasHydrated) return;
    if (!puedeVerPanel(user, panel)) {
      const first = NAV_ORDER.find((p) => puedeVerPanel(user, p)) ?? "settings";
      setPanel(first);
    }
  }, [user, panel, setPanel, hasHydrated]);

  if (!user || !token) {
    return (
      <AppLoginView
        onLogin={(t, u, apiToken) => {
          setAuth(t, u, apiToken);
          if (apiToken) mckennaAndroidBridge()?.saveApiToken?.(apiToken);
          void waitForAppHydration().then(() => {
            const current = useAppStore.getState().panel;
            if (!puedeVerPanel(u, current)) {
              const first = NAV_ORDER.find((p) => puedeVerPanel(u, p)) ?? "settings";
              useAppStore.getState().setPanel(first);
            }
          });
        }}
      />
    );
  }

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (showMobile) {
    return (
      <MobileHub
        onSwitchDesktop={() => {
          localStorage.setItem("mck-force-desktop", "1");
          setForceDesktop(true);
        }}
      />
    );
  }

  return (
    <Layout>
      <PanelRouter />
    </Layout>
  );
}
