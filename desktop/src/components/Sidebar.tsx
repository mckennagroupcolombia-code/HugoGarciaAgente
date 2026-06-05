import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { useAuthStore } from "../stores/auth";
import { usePreventa } from "../hooks/usePreventa";
import { usePostventa } from "../hooks/usePostventa";
import { useWebChat } from "../hooks/useWebChat";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { cerrarSesionPanel } from "../hooks/usePanelSession";
import { Icon } from "../icons";

const NAV: { id: Panel; label: string }[] = [
  { id: "hugo",       label: "Hugo" },
  { id: "dashboard",  label: "Métricas" },
  { id: "tickets",    label: "Centro de Mando" },
  { id: "chat",       label: "Chat IA" },
  { id: "voz",        label: "Voz IA" },
  { id: "webchat",    label: "Chat web" },
  { id: "whatsapp",   label: "Agente WA" },
  { id: "supervisor", label: "Supervisor WA" },
  { id: "preventa",   label: "Preventa MeLi" },
  { id: "postventa",  label: "Postventa MeLi" },
  { id: "sync",       label: "Sincronización" },
  { id: "stock",      label: "Stock" },
  { id: "fichas",     label: "Docs técnicos" },
  { id: "pedidos",       label: "Pedidos Web" },
  { id: "publicaciones", label: "Publicaciones" },
  { id: "facturas",      label: "Facturas Compra" },
  { id: "etiquetas",  label: "Etiquetas" },
  { id: "settings",   label: "Ajustes" },
];

const DEFAULT_SECCIONES = new Set(["tickets"]);

function puedeVerSeccion(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  if (seccion === "hugo") return puedeVerSeccion(user, "tickets");
  if ((user.rol?.nivel ?? 0) >= 3) return true; // admin siempre ve todo
  if (seccion === "settings") return true; // todos ven ajustes
  const p = user.permisos_secciones;
  if (!p) return DEFAULT_SECCIONES.has(seccion) || seccion === "hugo"; // sin permisos: Hugo + tickets
  if (seccion === "postventa" && p.preventa) return true;
  return Boolean(p[seccion]);
}

export default function Sidebar() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const { user, token, clear: clearTickets } = useTicketsAuth();
  const clearMain = useAuthStore((s) => s.clear);
  const { data } = usePreventa();
  const pendientes = data?.total ?? 0;
  const { data: postventaData } = usePostventa();
  const postventaPendientes = postventaData?.total ?? 0;
  const { data: webChat } = useWebChat(true);
  const webChatPendientes = webChat?.summary?.unreviewed_count ?? 0;
  const { data: facturaData } = useQuery({
    queryKey: ["facturas-pendientes"],
    queryFn: () => api.get<{ total: number }>("/api/facturas/pendientes"),
    refetchInterval: 15000,
  });
  const facturasPendientes = facturaData?.total ?? 0;

  const visibleNav = NAV.filter((item) => puedeVerSeccion(user, item.id));

  async function logout() {
    if (token) {
      let sid = "";
      try {
        sid = sessionStorage.getItem("mckenna-panel-session-uuid") ?? "";
      } catch {
        /* ignore */
      }
      await cerrarSesionPanel(token);
      try {
        await api.post("/api/tickets/auth/logout", { session_uuid: sid });
      } catch {
        /* ignore */
      }
    }
    clearTickets();
    clearMain();
  }

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-surface-panel
        transition-transform duration-200 ease-out lg:static lg:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-sun text-base font-black text-ink shadow-[0_3px_0_#e8a838]">
            M
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-extrabold tracking-tight text-ink">McKenna</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Panel operaciones</div>
          </div>
        </div>

        {user && (
          <div className="mx-3 mb-2 rounded-paper border border-border bg-surface px-3 py-2">
            <p className="truncate text-xs font-semibold text-ink">{user.nombre}</p>
            {user.email && (
              <p className="truncate text-[10px] text-muted">{user.email}</p>
            )}
          </div>
        )}

        <p className="px-5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Menu</p>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleNav.map((item) => {
            const active = panel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "tickets") setTicketsBootView("home");
                  if (item.id === "hugo") {
                    setTicketsBootView(null);
                    setAccionesBootTab(null);
                  }
                  setPanel(item.id);
                }}
                className={`
                  flex w-full items-center gap-3 rounded-paper border-2 px-3 py-2.5 text-left text-sm font-semibold transition
                  ${active
                    ? "border-ink bg-surface-hover text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface-hover"
                  }
                `}
              >
                <Icon
                  name={item.id}
                  size={20}
                  weight={active ? "bold" : "regular"}
                  className="shrink-0 opacity-80"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.id === "preventa" && pendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">
                    {pendientes}
                  </span>
                )}
                {item.id === "postventa" && postventaPendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">
                    {postventaPendientes}
                  </span>
                )}
                {item.id === "webchat" && webChatPendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[11px] font-bold text-black">
                    {webChatPendientes}
                  </span>
                )}
                {item.id === "facturas" && facturasPendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-yellow-500 px-2 py-0.5 text-[11px] font-bold text-black">
                    {facturasPendientes}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-border p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-paper border-2 border-transparent px-3 py-2.5 text-sm font-semibold text-muted transition hover:border-border-strong hover:bg-surface-hover hover:text-danger"
          >
            <Icon name="signOut" size={20} className="shrink-0" />
            Cerrar sesion
          </button>
        </div>
      </div>
    </aside>
  );
}
