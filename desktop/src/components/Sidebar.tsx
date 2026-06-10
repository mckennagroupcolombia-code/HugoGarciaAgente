import { useRef } from "react";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { useAuthStore } from "../stores/auth";
import UserAvatar from "./UserAvatar";
import { useProfilePhotoPending } from "../stores/profilePhotoPending";
import { usePreventa } from "../hooks/usePreventa";
import { usePostventa } from "../hooks/usePostventa";
import { useWebChat } from "../hooks/useWebChat";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { cerrarSesionPanel } from "../hooks/usePanelSession";
import { Icon } from "../icons";
import TemasSidebarButton from "./TemasSidebarButton";

const NAV: { id: Panel; label: string }[] = [
  { id: "hugo",       label: "Hugo · Centro" },
  { id: "dashboard",  label: "Métricas" },
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
  { id: "etiquetas",  label: "Impresora · Etiquetas" },
  { id: "settings",   label: "Ajustes" },
];

const DEFAULT_SECCIONES = new Set(["tickets", "etiquetas"]);

function puedeVerTickets(user: TicketsUser): boolean {
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return DEFAULT_SECCIONES.has("tickets");
  return Boolean(p.tickets);
}

function puedeVerSeccion(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if ((user.rol?.nivel ?? 0) >= 3) return true; // admin siempre ve todo
  if (seccion === "settings") return true; // todos ven ajustes
  if (seccion === "etiquetas") return true; // impresora disponible para todo el equipo
  const p = user.permisos_secciones;
  if (!p) return DEFAULT_SECCIONES.has(seccion);
  if (seccion === "postventa" && p.preventa) return true;
  return Boolean(p[seccion]);
}

/** Misma regla que el sidebar — reutilizable en Hugo / Centro de Mando. */
export function puedeVerSeccionPanel(user: TicketsUser | null, seccion: string): boolean {
  return puedeVerSeccion(user, seccion);
}

export default function Sidebar() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const { user, token, clear: clearTickets } = useTicketsAuth();
  const clearMain = useAuthStore((s) => s.clear);
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const setFotoPendiente = useProfilePhotoPending((s) => s.setFile);
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

  function elegirFotoPerfil(file: File) {
    setFotoPendiente(file);
    setPanel("perfil");
    if (fotoInputRef.current) fotoInputRef.current.value = "";
  }

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
          {user && token ? (
            <>
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) elegirFotoPerfil(f);
                }}
              />
              <button
                type="button"
                title="Elegir foto de perfil"
                onClick={() => fotoInputRef.current?.click()}
                className="relative shrink-0 rounded-full transition hover:opacity-90"
              >
                <UserAvatar user={user} token={token} />
              </button>
              <button
                type="button"
                title="Mi perfil"
                onClick={() => setPanel("perfil")}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-base font-extrabold tracking-tight text-ink">
                  {user.nombre}
                </div>
                <div className="truncate text-[11px] text-muted">
                  {user.rol?.nombre ?? user.email ?? `@${user.username}`}
                </div>
              </button>
              <button
                type="button"
                title="Mi perfil"
                onClick={() => setPanel("perfil")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-accent hover:bg-surface-hover hover:text-accent"
              >
                <Icon name="settings" size={18} weight="regular" />
              </button>
            </>
          ) : (
            <>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-sun text-base font-black text-ink shadow-[0_3px_0_#e8a838]">
                M
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-extrabold tracking-tight text-ink">McKenna</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Panel operaciones</div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-1 border-b border-border px-3 pb-3">
          <TemasSidebarButton />
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-paper border-2 border-transparent px-3 py-2.5 text-left text-sm font-semibold text-muted transition hover:border-border-strong hover:bg-surface-hover hover:text-danger"
          >
            <Icon name="signOut" size={20} className="shrink-0" />
            Salir
          </button>
        </div>

        <p className="px-5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Menu</p>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleNav.map((item) => {
            const active = panel === item.id || (item.id === "hugo" && panel === "tickets");
            return (
              <button
                key={item.id}
                onClick={() => {
                  setAccionesBootTab(null);
                  if (item.id === "hugo") {
                    setTicketsBootView("agente");
                    setCentroMandoView("home");
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
      </div>
    </aside>
  );
}
