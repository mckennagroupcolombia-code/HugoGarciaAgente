import { useRef, useState } from "react";
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
import TemasSidebarButton from "./TemasSidebarButton";
import NavCategoryHub from "./nav/NavCategoryHub";
import { NAV_SECTIONS } from "../lib/navStructure";
import type { NavItemDef } from "../lib/navStructure";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { useUiMode } from "../stores/uiMode";
import { PANEL_INFO, type PanelTier } from "../lib/panelInfo";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import { PanelIcon } from "../icons/PanelIcon";
import { Icon } from "../icons";

export { puedeVerSeccionPanel } from "../lib/panelAccess";

function NavItem({
  id, panel, user, badges = {}, onNavigate, advanced, tier,
}: {
  id: Panel;
  panel: Panel;
  user: TicketsUser | null;
  badges?: Partial<Record<string, number>>;
  onNavigate: (id: Panel) => void;
  advanced: boolean;
  tier: PanelTier;
}) {
  const [hovered, setHovered] = useState(false);
  if (!puedeVerSeccionPanel(user, id)) return null;
  if (tier === "advanced" && !advanced) return null;

  const info = PANEL_INFO[id];
  const active = panel === id;
  const badge = badges[id] ?? 0;
  const label = info?.label ?? id;
  const description = info?.description ?? "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onNavigate(id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`group mck-nav-item mck-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
          active
            ? "is-active bg-accent text-white"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
        }`}
      >
        <PanelIcon panel={id} size={28} active={active} className="shrink-0" />
        <span className="min-w-0 flex-1 text-sm font-semibold leading-none truncate">{label}</span>
        {badge > 0 && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-danger text-white"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {hovered && description && !active && (
        <div className="mck-tooltip-fly pointer-events-none absolute left-full top-0 z-50 ml-2 w-64 rounded-xl border border-border bg-surface-panel/95 p-3 shadow-paper-lg backdrop-blur-sm">
          <p className="mb-1 flex items-center gap-2 text-xs font-bold text-ink">
            <IllustrationIcon name={id} size={20} bubble={false} tone="accent" />
            {label}
          </p>
          <p className="mck-help-text leading-snug text-ink-secondary">{description}</p>
          {info?.tips?.[0] && (
            <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
              <span className="text-accent">✦</span> {info.tips[0]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div className="mx-3 my-1 h-px bg-border/60" />;
}

function sectionVisible(
  items: readonly NavItemDef[],
  user: TicketsUser | null,
  advanced: boolean,
): boolean {
  return items.some(
    (item) => puedeVerSeccionPanel(user, item.panel) && (item.tier !== "advanced" || advanced),
  );
}

function AdvancedToggle({ advanced, onToggle }: { advanced: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mck-press flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
        advanced
          ? "bg-accent/5 text-accent dark:bg-accent/25 dark:text-accent/30"
          : "text-muted hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <Icon name={advanced ? "flask" : "lock"} size={18} weight="duotone" />
      <span className="flex-1">{advanced ? "Modo avanzado activo" : "Activar modo avanzado"}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          advanced ? "bg-accent/40 dark:bg-accent/50" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            advanced ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
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
  const { advanced, toggleAdvanced, resetHelps } = useUiMode();

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

  const badges: Partial<Record<string, number>> = {
    preventa: pendientes,
    postventa: postventaPendientes,
    webchat: webChatPendientes,
    facturas: facturasPendientes,
  };

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
      try { sid = sessionStorage.getItem("mckenna-panel-session-uuid") ?? ""; } catch { /* */ }
      await cerrarSesionPanel(token);
      try { await api.post("/api/tickets/auth/logout", { session_uuid: sid }); } catch { /* */ }
    }
    clearTickets();
    clearMain();
  }

  const totalAlerts = pendientes + postventaPendientes;

  return (
    <aside
      className={`
        mck-sidebar fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col border-r border-border/80 bg-surface-panel/95 backdrop-blur-md
        transition-transform duration-300 ease-out lg:static lg:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      <div className="shrink-0 border-b border-border px-4 pb-4 pt-5">
        {user && token ? (
          <div className="flex items-center gap-3">
            <input
              ref={fotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) elegirFotoPerfil(f); }}
            />
            <button
              type="button"
              title="Cambiar foto de perfil"
              onClick={() => fotoInputRef.current?.click()}
              className="mck-press relative shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-accent/30"
            >
              <UserAvatar user={user} token={token} />
              {totalAlerts > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
                  {totalAlerts > 9 ? "9+" : totalAlerts}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPanel("perfil")}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-extrabold leading-tight text-ink">{user.nombre}</p>
              <p className="truncate text-[10px] leading-tight text-muted">
                {user.rol?.nombre ?? user.departamento?.nombre ?? `@${user.username}`}
              </p>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-black text-white shadow">M</div>
            <div>
              <p className="font-extrabold text-ink">McKenna</p>
              <p className="text-[10px] text-muted">Panel de operaciones</p>
            </div>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {NAV_SECTIONS.filter(
          (section) =>
            (!section.advancedOnly || advanced)
            && sectionVisible(section.items, user, advanced),
        ).map((section) => (
          <NavCategoryHub
            key={section.id}
            sectionId={section.id}
            items={section.items}
            panel={panel}
            user={user}
            badges={badges}
            puedeVer={puedeVerSeccionPanel}
            onNavigate={navegarPanel}
          />
        ))}

        <Divider />
        <NavItem id="settings" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
      </nav>

      <div className="shrink-0 space-y-1 border-t border-border px-2.5 py-3">
        <AdvancedToggle advanced={advanced} onToggle={toggleAdvanced} />
        {advanced && (
          <button
            type="button"
            onClick={resetHelps}
            className="mck-press flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="lightning" size={16} weight="duotone" />
            Volver a mostrar ayudas
          </button>
        )}
        <TemasSidebarButton />
        <button
          type="button"
          onClick={logout}
          className="mck-press flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
        >
          <Icon name="signOut" size={18} weight="duotone" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
