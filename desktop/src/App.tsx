import { useEffect, useState, useCallback } from "react";
import { useAppStore, type Panel } from "./stores/app";
import { useTicketsAuth, type TicketsUser } from "./stores/ticketsAuth";
import Layout from "./components/Layout";
import Dashboard from "./components/Dashboard";
import Chat from "./components/Chat";
import VozIA from "./components/VozIA";
import PreventaPanel from "./components/PreventaPanel";
import SyncPanel from "./components/SyncPanel";
import StockPanel from "./components/StockPanel";
import PedidosWebPanel from "./components/PedidosWebPanel";
import FacturasCompraPanel from "./components/FacturasCompraPanel";
import TicketsPanel from "./components/TicketsPanel";
import WebChatPanel from "./components/WebChatPanel";
import Settings from "./components/Settings";
import { usePanelTheme } from "./stores/panelTheme";
import { googleAuthStartUrl, mckennaAndroidBridge } from "./lib/androidApp";

function PanelRouter() {
  const panel = useAppStore((s) => s.panel);
  switch (panel) {
    case "dashboard":
      return <Dashboard />;
    case "chat":
      return <Chat />;
    case "voz":
      return <VozIA />;
    case "webchat":
      return <WebChatPanel />;
    case "preventa":
      return <PreventaPanel />;
    case "sync":
      return <SyncPanel />;
    case "stock":
      return <StockPanel />;
    case "pedidos":
      return <PedidosWebPanel />;
    case "facturas":
      return <FacturasCompraPanel />;
    case "tickets":
      return <TicketsPanel />;
    case "settings":
      return <Settings />;
    default:
      return <Dashboard />;
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
      window.history.replaceState({}, "", window.location.pathname);
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

const NAV_ORDER: Panel[] = [
  "dashboard", "chat", "voz", "webchat", "preventa",
  "sync", "stock", "pedidos", "facturas", "tickets", "settings",
];

function puedeVerPanel(user: TicketsUser, panel: Panel): boolean {
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  if (panel === "settings") return true;
  const p = user.permisos_secciones;
  if (!p) return panel === "tickets";
  return Boolean(p[panel]);
}

export default function App() {
  const { user, token, setAuth } = useTicketsAuth();
  const applyTheme = usePanelTheme((s) => s.apply);
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);

  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  // Si el panel persistido no es visible para este usuario, ir al primero disponible
  useEffect(() => {
    if (!user) return;
    if (!puedeVerPanel(user, panel)) {
      const first = NAV_ORDER.find((p) => puedeVerPanel(user, p)) ?? "settings";
      setPanel(first);
    }
  }, [user, panel, setPanel]);

  if (!user || !token) {
    return (
      <AppLoginView
        onLogin={(t, u, apiToken) => {
          setAuth(t, u, apiToken);
          if (apiToken) mckennaAndroidBridge()?.saveApiToken?.(apiToken);
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
