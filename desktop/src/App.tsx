import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useAppStore, type Panel, waitForAppHydration } from "./stores/app";
import { useTicketsAuth, type TicketsUser, ensureTicketsAuthHydrated } from "./stores/ticketsAuth";
import MobileHub, { useMobileLayout } from "./components/MobileHub";
import Layout from "./components/Layout";
import Dashboard from "./components/Dashboard";
import TicketsPanel from "./components/TicketsPanel";
import ThemesDialog from "./components/ThemesDialog";
import MatrixRain from "./components/MatrixRain";
import BarbieSparkles from "./components/BarbieSparkles";

// Paneles bajo demanda: cada uno baja en su propio chunk al abrirlo, en vez de
// inflar el bundle inicial. Dashboard y TicketsPanel quedan estáticos por ser
// los paneles de aterrizaje.
const Chat = lazy(() => import("./components/Chat"));
const VozIA = lazy(() => import("./components/VozIA"));
const PreventaPanel = lazy(() => import("./components/PreventaPanel"));
const PostventaPanel = lazy(() => import("./components/PostventaPanel"));
const FichasTecnicasPanel = lazy(() => import("./components/FichasTecnicasPanel"));
const PedidosWebPanel = lazy(() => import("./components/PedidosWebPanel"));
const EmpaquePanel = lazy(() => import("./components/EmpaquePanel"));
const ContabilidadPanel = lazy(() => import("./components/ContabilidadPanel"));
const WebChatPanel = lazy(() => import("./components/WebChatPanel"));
const WhatsAppPanel = lazy(() => import("./components/WhatsAppPanel"));
const SupervisorPanel = lazy(() => import("./components/SupervisorPanel"));
const ControlVersionesPanel = lazy(() => import("./components/ControlVersionesPanel"));
const MeliOAuthPanel = lazy(() => import("./components/MeliOAuthPanel"));
const GmailOAuthPanel = lazy(() => import("./components/GmailOAuthPanel"));
const TareasProgramadasPanel = lazy(() => import("./components/TareasProgramadasPanel"));
const EtiquetasPanel = lazy(() => import("./components/EtiquetasPanel"));
const ConfigurarProductosPanel = lazy(() =>
  import("./components/EtiquetasPanel").then((m) => ({
    default: m.ConfigurarProductosPanel,
  })),
);
const PlacasConcretoPanel = lazy(() => import("./components/PlacasConcretoPanel"));
const ContenidoPanel = lazy(() => import("./components/ContenidoPanel"));
const InventarioControlPanel = lazy(() => import("./components/InventarioControlPanel"));
const PublicacionesPanel = lazy(() => import("./components/PublicacionesPanel"));
const VitrinaWebPanel = lazy(() => import("./components/VitrinaWebPanel"));
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
import { googleAuthStartUrl, mckennaAndroidBridge } from "./lib/androidApp";
import { initAppBackNavigation, resetAppNavHistory } from "./lib/appBackNavigation";
import { onPanelResume } from "./lib/panelRefresh";
import { esPanelContabilidad, puedeVerModuloContabilidad } from "./lib/contabilidadAccess";
import { puedeVerModuloLogistica } from "./lib/logisticaAccess";
import { esAdminPanel } from "./lib/adminAccess";
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
    case "control-versiones":
      return <ControlVersionesPanel />;
    case "meli-oauth":
      return <MeliOAuthPanel />;
    case "gmail-oauth":
      return <GmailOAuthPanel />;
    case "tareas-programadas":
      return <TareasProgramadasPanel />;
    case "preventa":
      return <PreventaPanel />;
    case "postventa":
      return <PostventaPanel />;
    case "sync":
    case "facturas":
    case "facturacion":
    case "costos-productos":
    case "rentabilidad":
    case "publicidad":
    case "salud-negocio":
    case "compras-exterior":
    case "productos-siigo":
    case "rrhh":
    case "operativos":
    case "ingresos-egresos":
    case "creditos-adquiridos":
    case "libro-mayor":
    case "stock":
      return <ContabilidadPanel />;
    case "fichas":
      return <FichasTecnicasPanel />;
    case "pedidos":
      return <PedidosWebPanel />;
    case "empaque":
      return <EmpaquePanel />;
    case "etiquetas":
      return <EtiquetasPanel />;
    case "etiquetas-config":
      return <ConfigurarProductosPanel />;
    case "placas-concreto":
      return <PlacasConcretoPanel />;
    case "contenido":
      return <ContenidoPanel />;
    case "control-inventario":
      return <InventarioControlPanel />;
    case "publicaciones":
      return <PublicacionesPanel />;
    case "vitrina-web":
      return <VitrinaWebPanel />;
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

function AppLoginView({
  onLogin,
  bootstrapUntil,
}: {
  onLogin: (token: string, user: TicketsUser, apiToken?: string | null) => void;
  bootstrapUntil: { current: number };
}) {
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((u) => {
        if (u?.id) {
          bootstrapUntil.current = Date.now() + OAUTH_BOOTSTRAP_MS;
          onLogin(token, u as TicketsUser, u.api_token ?? null);
          mckennaAndroidBridge()?.clearWebHistory?.();
        } else {
          setAuthError("Sesión inválida. Intenta de nuevo.");
          setLoading(false);
        }
      })
      .catch(() => {
        setAuthError("Error al verificar sesión. Intenta de nuevo.");
        setLoading(false);
      });
  }, [onLogin, bootstrapUntil]);

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
    if (token) {
      bootstrapUntil.current = Date.now() + OAUTH_BOOTSTRAP_MS;
      consumeToken(token);
    }
  }, [consumeToken, bootstrapUntil]);

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
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
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
  if (panel === "empaque") return true;
  if (panel === "hugo" || panel === "tickets") {
    if (esAdminPanel(user)) return true;
    const p = user.permisos_secciones;
    if (!p) return true;
    return Boolean(p.tickets);
  }
  if (esAdminPanel(user)) return true;
  const p = user.permisos_secciones;
  if (!p) return panel === "settings";
  if (panel === "postventa" && p.preventa) return true;
  if (panel === "vitrina-web" && p.publicaciones) return true;
  return Boolean(p[panel]);
}

const OAUTH_BOOTSTRAP_MS = 4000;

function readUrlAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("_token");
}

async function refreshTicketsSession(
  token: string,
  setAuth: (token: string, user: TicketsUser, apiToken?: string | null) => void,
  clear: () => void,
  opts?: { bootstrapUntil?: { current: number } },
) {
  if (opts?.bootstrapUntil && Date.now() < opts.bootstrapUntil.current) return;
  try {
    const res = await fetch(`/api/tickets/auth/me?_t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}`, Pragma: "no-cache" },
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 401) clear();
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
  const { user, token, setAuth, clear, _hasHydrated: authHydrated } = useTicketsAuth();
  const applyTheme = usePanelTheme((s) => s.apply);
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const lastAppliedPrefs = useRef<string | null>(null);
  const bootstrapUntil = useRef(0);
  const pendingUrlToken = useRef(readUrlAuthToken());
  const isMobile = useMobileLayout();
  const mobileShell = useAppStore((s) => s.mobileShell);
  const setMobileShell = useAppStore((s) => s.setMobileShell);
  const [forceDesktop, setForceDesktop] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("mck-force-desktop") === "1"
  );
  // Hub simplificado por defecto en móvil (incluida la app Android) — el usuario elige
  // "vista escritorio" explícitamente desde el hub si la necesita; al abrir paneles →
  // Layout responsive (mobileShell=app).
  const showMobile = isMobile && !forceDesktop && mobileShell === "hub";

  useEffect(() => {
    document.documentElement.classList.remove("mck-apk");
  }, []);

  useEffect(() => {
    if (useTicketsAuth.persist.hasHydrated()) {
      ensureTicketsAuthHydrated();
      return;
    }
    const unsub = useTicketsAuth.persist.onFinishHydration(() => {
      ensureTicketsAuthHydrated();
    });
    const fallback = window.setTimeout(() => ensureTicketsAuthHydrated(), 600);
    return () => {
      unsub();
      window.clearTimeout(fallback);
    };
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
        && state.skin === prev.skin
        && state.fontScale === prev.fontScale
        && state.menuScale === prev.menuScale
        && state.activeCustomId === prev.activeCustomId
        && JSON.stringify(state.colors) === JSON.stringify(prev.colors)
        && JSON.stringify(state.customThemes) === JSON.stringify(prev.customThemes)
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

  useEffect(() => {
    if (!authHydrated) return;
    if (token && user) pendingUrlToken.current = null;
  }, [authHydrated, token, user]);

  // Revalidar sesión al abrir y al volver a la app (evita user.id obsoleto en filtros del móvil)
  useEffect(() => {
    if (!token || !authHydrated) return;
    if (pendingUrlToken.current) return;
    void refreshTicketsSession(token, setAuth, clear, { bootstrapUntil });
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        void refreshTicketsSession(token, setAuth, clear, { bootstrapUntil });
      }, 900);
    };
    const unsubResume = onPanelResume(debouncedRefresh);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      unsubResume();
    };
  }, [token, authHydrated, setAuth, clear]);

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

  if (!authHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const needsLogin = !user || !token;

  if (needsLogin) {
    return (
      <AppLoginView
        bootstrapUntil={bootstrapUntil}
        onLogin={(t, u, apiToken) => {
          pendingUrlToken.current = null;
          bootstrapUntil.current = Date.now() + OAUTH_BOOTSTRAP_MS;
          setAuth(t, u, apiToken);
          if (apiToken) mckennaAndroidBridge()?.saveApiToken?.(apiToken);
          mckennaAndroidBridge()?.clearWebHistory?.();
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
      <>
        <MatrixRain />
        <BarbieSparkles />
        <ThemesDialog />
        <MobileHub
          onSwitchDesktop={() => {
            localStorage.setItem("mck-force-desktop", "1");
            setForceDesktop(true);
            setMobileShell("app");
          }}
          onOpenPanel={() => setMobileShell("app")}
        />
      </>
    );
  }

  return (
    <>
      <MatrixRain />
      <BarbieSparkles />
      <ThemesDialog />
      <Layout
        onBackToMobileHub={
          isMobile && !forceDesktop
            ? () => {
                setMobileShell("hub");
                setPanel("hugo");
              }
            : undefined
        }
        onExitForceDesktop={
          forceDesktop && isMobile
            ? () => {
                localStorage.removeItem("mck-force-desktop");
                setForceDesktop(false);
                setMobileShell("hub");
              }
            : undefined
        }
      >
        <PanelRouter />
      </Layout>
    </>
  );
}
