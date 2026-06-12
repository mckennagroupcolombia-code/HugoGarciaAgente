import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ActivityLog from "./ActivityLog";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { usePanelSession } from "../hooks/usePanelSession";
import { Icon } from "../icons";

export default function Layout({ children }: { children: ReactNode }) {
  usePanelSession();
  const panel = useAppStore((s) => s.panel);
  const centroMandoView = useAppStore((s) => s.centroMandoView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const isAdmin = (useTicketsAuth((s) => s.user)?.rol?.nivel ?? 0) >= 3;
  const isCentroMando = panel === "hugo" || panel === "tickets";
  const hubIntegrado =
    isCentroMando && centroMandoView === "home";

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm lg:hidden"
          onClick={toggle}
        />
      )}

      <Sidebar />

      <main className="flex flex-1 flex-col overflow-hidden bg-surface">
        <header className="flex items-center gap-3 border-b border-border bg-surface-panel px-4 py-3 shadow-paper-sm">
          <button
            type="button"
            onClick={toggle}
            className="rounded-full p-1 text-muted transition hover:bg-surface-hover hover:text-ink lg:hidden"
            aria-label="Abrir menú"
          >
            <Icon name="menu" size={24} weight="bold" aria-label="Abrir menú" />
          </button>
          <span className="flex-1 text-sm font-bold tracking-tight text-ink lg:hidden">
            {hubIntegrado ? "Centro de Mando" : "McKenna"}
          </span>
          <span className="hidden flex-1 text-sm font-bold tracking-tight text-ink lg:inline">
            {hubIntegrado ? "Hugo · Centro de Mando" : "Panel de operaciones"}
          </span>
        </header>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            className={`min-h-0 min-w-0 flex-1 ${
              isCentroMando
                ? hubIntegrado
                  ? "flex min-h-0 flex-col overflow-hidden px-5 pt-4 lg:px-10 lg:pt-5"
                  : "overflow-x-hidden overflow-y-auto px-5 py-5 lg:px-10 lg:py-6"
                : "overflow-x-hidden overflow-y-auto px-4 py-5 lg:px-10 lg:py-8"
            }`}
          >
            {children}
          </div>
          {isAdmin && !hubIntegrado && (
            <div className="shrink-0 border-t border-border bg-surface-panel px-4 pb-3 pt-2 shadow-paper-sm lg:px-8">
              <ActivityLog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
