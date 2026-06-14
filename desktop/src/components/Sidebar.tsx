import { useRef, useState, useEffect } from "react";
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
import type { IconName } from "../icons/types";
import TemasSidebarButton from "./TemasSidebarButton";
import ContabilidadSidebarGroup, { contabilidadNavVisible } from "./ContabilidadSidebarGroup";
import { puedeVerModuloContabilidad } from "../lib/contabilidadAccess";
import { puedeVerModuloLogistica } from "../lib/logisticaAccess";

const NAV_TOP: { id: Panel; label: string }[] = [
  { id: "hugo",      label: "Centro" },
  { id: "dashboard", label: "Métricas" },
  { id: "chat",      label: "Chat IA" },
  { id: "whatsapp",  label: "Agente WA" },
];

const NAV_MELI: { id: Panel; label: string }[] = [
  { id: "preventa",  label: "Preventa" },
  { id: "postventa", label: "Postventa" },
];

const NAV_OPERACIONES: { id: Panel; label: string }[] = [
  { id: "pedidos",          label: "Pedidos Web" },
  { id: "stock",            label: "Stock" },
  { id: "fichas",           label: "Docs técnicos" },
  { id: "publicaciones",    label: "Publicaciones" },
  { id: "etiquetas",        label: "Etiquetas" },
  { id: "etiquetas-config", label: "Config productos" },
];

const NAV_CANALES: { id: Panel; label: string }[] = [
  { id: "voz",       label: "Voz IA" },
  { id: "webchat",   label: "Chat web" },
  { id: "supervisor", label: "Supervisor WA" },
];

const NAV_LOGISTICA_INT: { id: Panel; label: string }[] = [
  { id: "logistica-importaciones", label: "Importaciones" },
  { id: "logistica-embarques",     label: "Embarques" },
  { id: "logistica-aduanas",       label: "Aduana" },
  { id: "logistica-proveedores",   label: "Proveedores" },
  { id: "logistica-seguimiento",   label: "Seguimiento" },
];

function puedeVerSeccion(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  const logistica = puedeVerModuloLogistica(user, seccion);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, seccion);
  if (contab !== null) return contab;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  if (seccion === "settings") return true;
  if (seccion === "etiquetas" || seccion === "etiquetas-config") return true;
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas"]).has(seccion);
  if (seccion === "postventa" && p.preventa) return true;
  return Boolean(p[seccion]);
}

function puedeVerTickets(user: TicketsUser): boolean {
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  const p = user.permisos_secciones;
  if (!p) return new Set(["tickets", "etiquetas"]).has("tickets");
  return Boolean(p.tickets);
}

/** Misma regla que el sidebar — reutilizable en Hugo / Centro de Mando. */
export function puedeVerSeccionPanel(user: TicketsUser | null, seccion: string): boolean {
  return puedeVerSeccion(user, seccion);
}

// ── NavGroup: sección colapsable ──────────────────────────────────────────────
function NavGroup({
  groupId, label, icon, items, badges = {}, panel, user, onNavigate, extras,
}: {
  groupId: string;
  label: string;
  icon: IconName;
  items: { id: Panel; label: string }[];
  badges?: Partial<Record<Panel, number>>;
  panel: Panel;
  user: TicketsUser | null;
  onNavigate: (id: Panel) => void;
  extras?: React.ReactNode;
}) {
  const visibleItems = items.filter((i) => puedeVerSeccion(user, i.id));
  const hasActive = visibleItems.some(
    (i) => i.id === panel || (i.id === "hugo" && panel === "tickets"),
  );
  const totalBadge = visibleItems.reduce((s, i) => s + (badges[i.id] ?? 0), 0);

  const storageKey = `sidebar-group-${groupId}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (hasActive && !open) {
      setOpen(true);
      try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
  };

  if (visibleItems.length === 0 && !extras) return null;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={`flex w-full items-center gap-2 rounded-paper px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition hover:bg-surface-hover ${
          hasActive ? "text-ink" : "text-muted"
        }`}
      >
        <Icon name={icon} size={15} className="shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 text-left">{label}</span>
        {totalBadge > 0 && (
          <span className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
            {totalBadge}
          </span>
        )}
        <svg
          className={`ml-1 shrink-0 h-3 w-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 pl-3">
          {visibleItems.map((item) => {
            const active = panel === item.id;
            const badge = badges[item.id] ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-paper border-2 px-3 py-2 text-left text-sm font-semibold transition ${
                  active
                    ? "border-ink bg-surface-hover text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface-hover"
                }`}
              >
                <Icon
                  name={item.id as IconName}
                  size={18}
                  weight={active ? "bold" : "regular"}
                  className="shrink-0 opacity-80"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {badge > 0 && (
                  <span className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          {extras}
        </div>
      )}
    </div>
  );
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

  const verContabilidad = contabilidadNavVisible(user, puedeVerSeccion);

  function navegarPanel(id: Panel) {
    setAccionesBootTab(null);
    if (id === "hugo") {
      setTicketsBootView("agente");
      setCentroMandoView("home");
    }
    setPanel(id);
  }

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

  const meliBadges: Partial<Record<Panel, number>> = {
    preventa: pendientes,
    postventa: postventaPendientes,
  };
  const canalesBadges: Partial<Record<Panel, number>> = {
    webchat: webChatPendientes,
  };

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-64 transform border-r border-border bg-surface-panel
        transition-transform duration-200 ease-out lg:static lg:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      <div className="flex h-full flex-col">
        {/* ── Perfil ── */}
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
                aria-label="Abrir mi perfil"
                onClick={() => setPanel("perfil")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-accent/50 bg-accent/10 text-accent shadow-sm transition hover:border-accent hover:bg-accent/20"
              >
                <Icon name="settings" size={18} weight="duotone" />
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

        {/* ── Acciones rápidas ── */}
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

        {/* ── Nav ── */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {/* Ítems principales */}
          {NAV_TOP.filter((i) => puedeVerSeccion(user, i.id)).map((item) => {
            const active = panel === item.id || (item.id === "hugo" && panel === "tickets");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navegarPanel(item.id)}
                className={`
                  flex w-full items-center gap-3 rounded-paper border-2 px-3 py-2.5 text-left text-sm font-semibold transition
                  ${active
                    ? "border-ink bg-surface-hover text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface-hover"
                  }
                `}
              >
                <Icon
                  name={item.id as IconName}
                  size={20}
                  weight={active ? "bold" : "regular"}
                  className="shrink-0 opacity-80"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            );
          })}

          {/* Grupo MeLi + Finanzas */}
          <NavGroup
            groupId="meli"
            label="MeLi"
            icon={"cart" as IconName}
            items={NAV_MELI}
            badges={meliBadges}
            panel={panel}
            user={user}
            onNavigate={navegarPanel}
            extras={
              verContabilidad ? (
                <ContabilidadSidebarGroup
                  user={user}
                  panel={panel}
                  puedeVer={puedeVerSeccion}
                  facturasPendientes={facturasPendientes}
                  onNavigate={navegarPanel}
                />
              ) : undefined
            }
          />

          {/* Si contabilidad visible pero MeLi no visible: mostrar finanzas suelto */}
          {verContabilidad &&
            NAV_MELI.every((i) => !puedeVerSeccion(user, i.id)) && (
              <ContabilidadSidebarGroup
                user={user}
                panel={panel}
                puedeVer={puedeVerSeccion}
                facturasPendientes={facturasPendientes}
                onNavigate={navegarPanel}
              />
            )}

          {/* Grupo Operaciones */}
          <NavGroup
            groupId="operaciones"
            label="Operaciones"
            icon={"wrench" as IconName}
            items={NAV_OPERACIONES}
            panel={panel}
            user={user}
            onNavigate={navegarPanel}
          />

          {/* Grupo Canales IA */}
          <NavGroup
            groupId="canales"
            label="Canales IA"
            icon={"wave" as IconName}
            items={NAV_CANALES}
            badges={canalesBadges}
            panel={panel}
            user={user}
            onNavigate={navegarPanel}
          />

          {/* Grupo Logística Internacional */}
          <NavGroup
            groupId="logistica-int"
            label="Logística Internacional"
            icon={"truck" as IconName}
            items={NAV_LOGISTICA_INT}
            panel={panel}
            user={user}
            onNavigate={navegarPanel}
          />

          {/* Ajustes — siempre al final */}
          {puedeVerSeccion(user, "settings") && (
            <button
              type="button"
              onClick={() => navegarPanel("settings")}
              className={`
                flex w-full items-center gap-3 rounded-paper border-2 px-3 py-2.5 text-left text-sm font-semibold transition mt-2
                ${panel === "settings"
                  ? "border-ink bg-surface-hover text-ink"
                  : "border-transparent text-ink-secondary hover:bg-surface-hover"
                }
              `}
            >
              <Icon name={"settings" as IconName} size={20} weight={panel === "settings" ? "bold" : "regular"} className="shrink-0 opacity-80" />
              <span className="min-w-0 flex-1 truncate">Ajustes</span>
            </button>
          )}
        </nav>
      </div>
    </aside>
  );
}
