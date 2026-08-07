import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ActivityLog from "./ActivityLog";
import ContabilidadNavTabs from "./ContabilidadNavTabs";
import HubNavTabs from "./nav/HubNavTabs";
import DisenoNavTabs from "./nav/DisenoNavTabs";
import ThemeModeToggle from "./ThemeModeToggle";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { usePanelSession } from "../hooks/usePanelSession";
import { Icon } from "../icons";
import { PANEL_INFO } from "../lib/panelInfo";
import { esAdminPanel, modoAvanzadoEfectivo } from "../lib/adminAccess";
import {
  esSeccionHub,
  navSectionForPanel,
  NAV_CATEGORY_LABEL,
} from "../lib/navStructure";
import { HUB_SECTION_ICON } from "../lib/hubNav";
import { useUiMode } from "../stores/uiMode";
import { PanelTransition } from "./ui/PanelTransition";

export default function Layout({
  children,
  onBackToMobileHub,
  onExitForceDesktop,
}: {
  children: ReactNode;
  /** Vuelve al hub móvil simplificado (sin forzar escritorio). */
  onBackToMobileHub?: () => void;
  /** Sale del modo “vista escritorio” forzada en el teléfono. */
  onExitForceDesktop?: () => void;
}) {
  usePanelSession();
  const panel = useAppStore((s) => s.panel);
  const centroMandoView = useAppStore((s) => s.centroMandoView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const user = useTicketsAuth((s) => s.user);
  const isAdmin = esAdminPanel(user);
  const { advanced: advancedToggle } = useUiMode();
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);
  const isCentroMando = panel === "hugo" || panel === "tickets";
  const hubIntegrado = isCentroMando && centroMandoView === "home";

  const sectionId = navSectionForPanel(panel);
  const isHub = esSeccionHub(sectionId);
  const sectionLabel = sectionId ? NAV_CATEGORY_LABEL[sectionId] : null;
  const panelInfo = PANEL_INFO[panel];

  const headerTitle = panel === "perfil"
    ? "Mi perfil"
    : panel === "settings"
    ? "Ajustes"
    : isHub && sectionLabel
    ? sectionLabel
    : panelInfo?.label ?? "Panel de operaciones";

  const headerSubtitle =
    panel === "perfil" || panel === "settings" ? "Cuenta" : null;

  /** Contenedor de contenido: hubs = flex + scroll interno (como Contabilidad). */
  const contentScrollClass = isCentroMando
    ? hubIntegrado
      ? "flex min-h-0 flex-col overflow-hidden px-3 pt-3 sm:px-5 sm:pt-4 lg:px-10 lg:pt-5"
      : "overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-10 lg:py-6"
    : isHub
    ? "flex min-h-0 flex-col overflow-hidden px-3 pt-2 sm:px-4 sm:pt-3 lg:px-10 lg:pt-4"
    : "overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 lg:px-10 lg:py-8";

  const showHubTabs = isHub && sectionId;

  return (
    <div className="mck-app-shell flex h-dvh max-w-[100vw] overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm transition-opacity duration-200 lg:hidden"
          onClick={toggle}
          role="presentation"
        />
      )}

      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <header
          className="mck-header-glass z-30 flex shrink-0 flex-col gap-2 border-b border-border/80 px-3 py-2 shadow-paper-sm sm:gap-2.5 sm:px-4 sm:py-2.5"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {onBackToMobileHub && (
              <button
                type="button"
                onClick={onBackToMobileHub}
                className="mck-press rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
                aria-label="Volver al inicio móvil"
                title="Inicio móvil"
              >
                <Icon name="caretDown" size={22} weight="bold" className="rotate-90" />
              </button>
            )}
            <button
              type="button"
              onClick={toggle}
              className="mck-press rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
              aria-label="Abrir menú"
            >
              <Icon name="menu" size={22} weight="bold" aria-label="Abrir menú" />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
              {isHub && sectionId ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon name={HUB_SECTION_ICON[sectionId]} size={20} weight="duotone" />
                </span>
              ) : panel === "perfil" || panel === "settings" ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon name={panel === "perfil" ? "user" : "wrench"} size={20} weight="duotone" />
                </span>
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-sm font-bold tracking-tight text-ink lg:text-base">
                  {headerTitle}
                </h1>
                {headerSubtitle && (
                  <p className="hidden truncate text-[10px] leading-snug text-muted lg:block">
                    {headerSubtitle}
                  </p>
                )}
              </div>
            </div>

            {!isHub && advanced && (
              <span className="hidden shrink-0 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent sm:inline">
                Avanzado
              </span>
            )}

            {onExitForceDesktop && (
              <button
                type="button"
                onClick={onExitForceDesktop}
                className="mck-press hidden shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted hover:bg-surface-hover hover:text-ink sm:inline lg:hidden"
              >
                Vista móvil
              </button>
            )}

            <div className="shrink-0">
              <ThemeModeToggle />
            </div>
          </div>

          {showHubTabs && (
            <div className="min-w-0 w-full">
              {sectionId === "contabilidad" && <ContabilidadNavTabs />}
              {sectionId === "diseno" && <DisenoNavTabs />}
              {sectionId !== "contabilidad" && sectionId !== "diseno" && (
                <HubNavTabs sectionId={sectionId} />
              )}
            </div>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={`mck-panel-scroll min-h-0 min-w-0 flex-1 ${contentScrollClass}`}>
            {isHub && !isCentroMando ? (
              sectionId === "contabilidad" || sectionId === "publicaciones" ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <PanelTransition>{children}</PanelTransition>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6">
                  <PanelTransition>{children}</PanelTransition>
                </div>
              )
            ) : (
              <PanelTransition>{children}</PanelTransition>
            )}
          </div>
          {isAdmin && !hubIntegrado && panel !== "stock" && (
            <div className="hidden shrink-0 border-t border-border bg-surface-panel/90 px-4 pb-3 pt-2 shadow-paper-sm backdrop-blur-sm md:block lg:px-8">
              <ActivityLog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
