import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ActivityLog from "./ActivityLog";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { usePanelSession } from "../hooks/usePanelSession";
import { Icon } from "../icons";
import { PanelIcon } from "../icons/PanelIcon";
import { PANEL_INFO } from "../lib/panelInfo";
import { navSectionForPanel, NAV_CATEGORY_LABEL } from "../lib/navStructure";
import { useUiMode } from "../stores/uiMode";
import { PanelTransition } from "./ui/PanelTransition";

export default function Layout({ children }: { children: ReactNode }) {
  usePanelSession();
  const panel = useAppStore((s) => s.panel);
  const centroMandoView = useAppStore((s) => s.centroMandoView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const isAdmin = (useTicketsAuth((s) => s.user)?.rol?.nivel ?? 0) >= 3;
  const { advanced } = useUiMode();
  const isCentroMando = panel === "hugo" || panel === "tickets";
  const hubIntegrado = isCentroMando && centroMandoView === "home";

  const sectionId = navSectionForPanel(panel);
  const sectionLabel = sectionId ? NAV_CATEGORY_LABEL[sectionId] : null;
  const panelInfo = PANEL_INFO[panel];
  const headerTitle = panel === "perfil"
    ? "Mi perfil"
    : hubIntegrado
    ? "Hugo · Centro de Mando"
    : panelInfo?.label ?? "Panel de operaciones";

  const headerSubtitle =
    panel === "perfil"
      ? "Cuenta"
      : hubIntegrado
      ? "Inicio"
      : sectionLabel;

  const showPanelIcon = panel !== "perfil" && !hubIntegrado && panelInfo;

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm transition-opacity duration-200 lg:hidden"
          onClick={toggle}
        />
      )}

      <Sidebar />

      <main className="flex flex-1 flex-col overflow-hidden bg-transparent">
        <header className="mck-header-glass flex shrink-0 items-center gap-3 border-b border-border/80 px-4 py-3 shadow-paper-sm">
          <button
            type="button"
            onClick={toggle}
            className="mck-press rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
            aria-label="Abrir menú"
          >
            <Icon name="menu" size={22} weight="bold" aria-label="Abrir menú" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {showPanelIcon && (
              <PanelIcon panel={panel} size={32} bubble className="shrink-0" />
            )}
            {hubIntegrado && (
              <PanelIcon panel="hugo" size={32} bubble className="shrink-0" />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight text-ink lg:text-base">
                {headerTitle}
              </h1>
              {headerSubtitle && !hubIntegrado && (
                <p className="hidden truncate text-[11px] text-muted lg:block">
                  {headerSubtitle}
                </p>
              )}
            </div>
          </div>

          {advanced && (
            <span className="hidden shrink-0 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent lg:inline">
              Avanzado
            </span>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={`min-h-0 min-w-0 flex-1 ${
              isCentroMando
                ? hubIntegrado
                  ? "flex min-h-0 flex-col overflow-hidden px-5 pt-4 lg:px-10 lg:pt-5"
                  : "overflow-x-hidden overflow-y-auto px-5 py-5 lg:px-10 lg:py-6"
                : "overflow-x-hidden overflow-y-auto px-4 py-5 lg:px-10 lg:py-8"
            }`}
          >
            <PanelTransition>{children}</PanelTransition>
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
