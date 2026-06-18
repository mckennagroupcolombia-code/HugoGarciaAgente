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
import ContabilidadSidebarGroup, { contabilidadNavVisible } from "./ContabilidadSidebarGroup";
import { puedeVerModuloContabilidad } from "../lib/contabilidadAccess";
import { puedeVerModuloLogistica } from "../lib/logisticaAccess";
import { useUiMode } from "../stores/uiMode";
import { PANEL_INFO, type PanelTier } from "../lib/panelInfo";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import { PanelIcon } from "../icons/PanelIcon";
import { Icon } from "../icons";

// ── Access control ─────────────────────────────────────────────────────────────

function puedeVerSeccion(user: TicketsUser | null, seccion: string): boolean {
  if (!user) return false;
  const logistica = puedeVerModuloLogistica(user, seccion);
  if (logistica !== null) return logistica;
  const contab = puedeVerModuloContabilidad(user, seccion);
  if (contab !== null) return contab;
  if (seccion === "hugo" || seccion === "tickets") return puedeVerTickets(user);
  if ((user.rol?.nivel ?? 0) >= 3) return true;
  if (seccion === "settings") return true;
  if (seccion === "etiquetas" || seccion === "etiquetas-config" || seccion === "plantillas-visuales") return true;
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

export function puedeVerSeccionPanel(user: TicketsUser | null, seccion: string): boolean {
  return puedeVerSeccion(user, seccion);
}

// ── NavItem ────────────────────────────────────────────────────────────────────

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
  if (!puedeVerSeccion(user, id)) return null;
  if (tier === "advanced" && !advanced) return null;

  const info = PANEL_INFO[id];
  const active = panel === id || (id === "hugo" && panel === "tickets");
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
        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
          active
            ? "bg-accent text-white shadow-[0_2px_0_rgba(2,45,51,0.2)]"
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
        {tier === "advanced" && !active && (
          <span className="shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide text-muted opacity-60">pro</span>
        )}
      </button>

      {/* Tooltip on hover (desktop only) — shows description */}
      {hovered && description && !active && (
        <div className="pointer-events-none absolute left-full top-0 z-50 ml-2 w-64 rounded-xl border border-border bg-surface-panel p-3 shadow-paper-lg">
          <p className="mb-1 flex items-center gap-2 text-xs font-bold text-ink">
            <IllustrationIcon name={id} size={20} bubble={false} tone="accent" />
            {label}
          </p>
          <p className="text-xs leading-relaxed text-ink-secondary">{description}</p>
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

// ── SectionLabel ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">
      {children}
    </p>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="mx-3 my-1 h-px bg-border/60" />;
}

// ── AdvancedToggle ─────────────────────────────────────────────────────────────

function AdvancedToggle({ advanced, onToggle }: { advanced: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all ${
        advanced
          ? "bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300"
          : "text-muted hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <span className="text-base">
        <Icon name={advanced ? "flask" : "lock"} size={18} weight="duotone" />
      </span>
      <span className="flex-1">{advanced ? "Modo avanzado activo" : "Activar modo avanzado"}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          advanced ? "bg-amber-400 dark:bg-amber-500" : "bg-border"
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

// ── Logística collapsible group ────────────────────────────────────────────────

const LOGISTICA_ITEMS: { id: Panel }[] = [
  { id: "logistica-importaciones" },
  { id: "logistica-embarques" },
  { id: "logistica-aduanas" },
  { id: "logistica-proveedores" },
  { id: "logistica-seguimiento" },
];

function LogisticaGroup({
  panel, user, onNavigate, advanced,
}: {
  panel: Panel;
  user: TicketsUser | null;
  onNavigate: (id: Panel) => void;
  advanced: boolean;
}) {
  const visible = LOGISTICA_ITEMS.filter((i) => puedeVerSeccion(user, i.id));
  if (visible.length === 0 || !advanced) return null;

  const hasActive = visible.some((i) => i.id === panel);
  const [open, setOpen] = useState(hasActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all ${
          hasActive ? "text-ink" : "text-muted hover:bg-surface-hover hover:text-ink"
        }`}
      >
        <span className="text-lg">🌎</span>
        <span className="flex-1">Logística Internacional</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 pl-4">
          {visible.map((item) => (
            <NavItem
              key={item.id}
              id={item.id}
              panel={panel}
              user={user}
              onNavigate={onNavigate}
              advanced={advanced}
              tier="advanced"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────

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

  const verContabilidad = contabilidadNavVisible(user, puedeVerSeccion);

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
        fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col border-r border-border bg-surface-panel
        transition-transform duration-200 ease-out lg:static lg:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      {/* ── Header: Branding + Usuario ── */}
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
              className="relative shrink-0 rounded-full transition hover:opacity-90"
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

      {/* ── Nav ── */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">

        {/* ESENCIALES — siempre visibles */}
        <SectionLabel>Esencial</SectionLabel>
        <div className="space-y-0.5">
          <NavItem id="hugo"      panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
          <NavItem id="dashboard" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
          <NavItem id="chat"      panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
        </div>

        <Divider />

        {/* VENTAS */}
        {(puedeVerSeccion(user, "preventa") || puedeVerSeccion(user, "postventa") || puedeVerSeccion(user, "pedidos")) && (
          <>
            <SectionLabel>Ventas</SectionLabel>
            <div className="space-y-0.5">
              <NavItem id="preventa"  panel={panel} user={user} badges={badges} onNavigate={navegarPanel} advanced={advanced} tier="core" />
              <NavItem id="postventa" panel={panel} user={user} badges={badges} onNavigate={navegarPanel} advanced={advanced} tier="core" />
              <NavItem id="pedidos"   panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
            </div>
            <Divider />
          </>
        )}

        {/* INVENTARIO */}
        {(puedeVerSeccion(user, "stock") || puedeVerSeccion(user, "etiquetas") || puedeVerSeccion(user, "plantillas-visuales")) && (
          <>
            <SectionLabel>Inventario</SectionLabel>
            <div className="space-y-0.5">
              <NavItem id="stock"            panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
              <NavItem id="etiquetas"        panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
              <NavItem id="fichas"           panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              <NavItem id="plantillas-visuales" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              <NavItem id="etiquetas-config" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
            </div>
            <Divider />
          </>
        )}

        {/* FINANZAS */}
        {(verContabilidad || puedeVerSeccion(user, "sync") || puedeVerSeccion(user, "facturas")) && (
          <>
            <SectionLabel>Finanzas</SectionLabel>
            <div className="space-y-0.5">
              <NavItem id="sync"     panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              <NavItem id="facturas" panel={panel} user={user} badges={badges} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              {verContabilidad && (
                <ContabilidadSidebarGroup
                  user={user}
                  panel={panel}
                  puedeVer={puedeVerSeccion}
                  facturasPendientes={facturasPendientes}
                  onNavigate={navegarPanel}
                />
              )}
              <NavItem id="centros-costo" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
              <NavItem id="rentabilidad"  panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
            </div>
            <Divider />
          </>
        )}

        {/* CANALES & CONTENIDO */}
        {(puedeVerSeccion(user, "whatsapp") || puedeVerSeccion(user, "publicaciones")) && (
          <>
            <SectionLabel>Canales</SectionLabel>
            <div className="space-y-0.5">
              <NavItem id="whatsapp"     panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              <NavItem id="publicaciones" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="standard" />
              <NavItem id="supervisor"   panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
              <NavItem id="voz"          panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
              <NavItem id="webchat"      panel={panel} user={user} badges={badges} onNavigate={navegarPanel} advanced={advanced} tier="advanced" />
            </div>
            <Divider />
          </>
        )}

        {/* LOGÍSTICA INTERNACIONAL — solo en modo avanzado */}
        <LogisticaGroup panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} />

        {/* AJUSTES */}
        <div className="mt-1 space-y-0.5">
          <NavItem id="settings" panel={panel} user={user} onNavigate={navegarPanel} advanced={advanced} tier="core" />
        </div>
      </nav>

      {/* ── Footer ── */}
      <div className="shrink-0 space-y-1 border-t border-border px-2.5 py-3">
        {/* Modo avanzado toggle */}
        <AdvancedToggle advanced={advanced} onToggle={toggleAdvanced} />

        {/* Help reset */}
        {advanced && (
          <button
            type="button"
            onClick={resetHelps}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-muted hover:text-ink hover:bg-surface-hover transition-all"
          >
            <span>💡</span>
            Volver a mostrar ayudas
          </button>
        )}

        <TemasSidebarButton />

        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
        >
          <span className="text-base">🚪</span>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
