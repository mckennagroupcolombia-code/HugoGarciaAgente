import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ActivityLog from "./ActivityLog";
import { useAppStore } from "../stores/app";

export default function Layout({ children }: { children: ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-sm lg:hidden"
          onClick={toggle}
        />
      )}

      <Sidebar />

      <main className="flex flex-1 flex-col overflow-hidden bg-surface">
        <header className="flex items-center gap-3 border-b border-border bg-surface-panel px-4 py-3 shadow-paper-sm lg:hidden">
          <button type="button" onClick={toggle} className="rounded-full p-1 text-muted transition hover:bg-surface-hover hover:text-ink">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold tracking-tight text-ink">McKenna</span>
        </header>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto px-4 py-5 lg:px-10 lg:py-8">{children}</div>
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 pb-3 pt-2 shadow-paper-sm lg:px-8">
            <ActivityLog />
          </div>
        </div>
      </main>
    </div>
  );
}
