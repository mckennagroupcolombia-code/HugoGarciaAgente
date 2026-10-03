import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiModeState {
  advanced: boolean;
  toggleAdvanced: () => void;
  setAdvanced: (v: boolean) => void;
  /** Navegación por departamentos (la anterior). Por defecto manda el flujo: lib/flujoApp.ts. */
  navClasica: boolean;
  setNavClasica: (v: boolean) => void;
}

export const useUiMode = create<UiModeState>()(
  persist(
    (set) => ({
      advanced: false,
      toggleAdvanced: () => set((s) => ({ advanced: !s.advanced })),
      setAdvanced: (advanced) => set({ advanced }),
      navClasica: false,
      setNavClasica: (navClasica) => set({ navClasica }),
    }),
    { name: "mckenna-ui-mode" },
  ),
);
