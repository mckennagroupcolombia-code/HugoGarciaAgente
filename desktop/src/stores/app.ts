import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Panel =
  | "dashboard"
  | "chat"
  | "preventa"
  | "sync"
  | "stock"
  | "settings";

interface AppState {
  panel: Panel;
  setPanel: (p: Panel) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      panel: "dashboard",
      setPanel: (panel) => set({ panel, sidebarOpen: false }),
      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    { name: "mckenna-app", partialize: (s) => ({ panel: s.panel }) },
  ),
);
