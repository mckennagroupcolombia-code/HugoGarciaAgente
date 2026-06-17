import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiModeState {
  advanced: boolean;
  toggleAdvanced: () => void;
  setAdvanced: (v: boolean) => void;
  /** Panels whose help banner has been permanently dismissed */
  dismissedHelps: string[];
  dismissHelp: (panelId: string) => void;
  resetHelps: () => void;
}

export const useUiMode = create<UiModeState>()(
  persist(
    (set) => ({
      advanced: false,
      toggleAdvanced: () => set((s) => ({ advanced: !s.advanced })),
      setAdvanced: (advanced) => set({ advanced }),
      dismissedHelps: [],
      dismissHelp: (panelId) =>
        set((s) => ({
          dismissedHelps: s.dismissedHelps.includes(panelId)
            ? s.dismissedHelps
            : [...s.dismissedHelps, panelId],
        })),
      resetHelps: () => set({ dismissedHelps: [] }),
    }),
    { name: "mckenna-ui-mode" },
  ),
);
