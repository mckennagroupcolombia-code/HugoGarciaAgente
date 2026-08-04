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

export default function Layout({ children }: { children: ReactNode }) {
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
      ? "flex min-h-0 flex-col overflow-hidden px-5 pt-4 lg:px-10 lg:pt-5"
      : "overflow-x-hidden overflow-y-auto px-5 py-5 lg:px-10 lg:py-6"
    : isHub
    ? "flex min-h-0 flex-col overflow-hidden px-4 pt-3 lg:px-10 lg:pt-4"
    : "overflow-x-hidden overflow-y-auto px-4 py-5 lg:px-10 lg:py-8";

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm transition-opacity duration-200 lg:hidden"
          onClick={toggle}
          role="presentation"
        />
      )}

      <Sidebar />

      <main className="flex flex-1 flex-col overflow-hidden bg-transparent">
        <header className="mck-header-glass z-30 flex shrink-0 items-center gap-2 border-b border-border/80 px-3 py-2.5 shadow-paper-sm sm:gap-3 sm:px-4 sm:py-3">
          <button
            type="button"
            onClick={toggle}
            className="mck-press rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
            aria-label="Abrir menú"
          >
            <Icon name="menu" size={22} weight="bold" aria-label="Abrir menú" />
          </button>

          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5">
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

          {isHub && sectionId === "contabilidad" && (
            <div className="min-w-0 flex-1">
              <ContabilidadNavTabs />
            </div>
          )}
          {isHub && sectionId === "diseno" && (
            <div className="min-w-0 flex-1">
              <DisenoNavTabs />
            </div>
          )}
          {isHub && sectionId && sectionId !== "contabilidad" && sectionId !== "diseno" && (
            <div className="min-w-0 flex-1">
              <HubNavTabs sectionId={sectionId} />
            </div>
          )}
          {!isHub && advanced && (
            <span className="ml-auto hidden shrink-0 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent lg:inline">
              Avanzado
            </span>
          )}

          <div className={`shrink-0 ${isHub || advanced ? "ml-2" : "ml-auto"}`}>
            <ThemeModeToggle />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={`min-h-0 min-w-0 flex-1 ${contentScrollClass}`}>
            {isHub && !isCentroMando ? (
              sectionId === "contabilidad" ? (
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
          {isAdmin && !hubIntegrado && (
            <div className="shrink-0 border-t border-border bg-surface-panel/90 px-4 pb-3 pt-2 shadow-paper-sm backdrop-blur-sm lg:px-8">
              <ActivityLog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
