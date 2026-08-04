import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiModeState {
  advanced: boolean;
  toggleAdvanced: () => void;
  setAdvanced: (v: boolean) => void;
}

export const useUiMode = create<UiModeState>()(
  persist(
    (set) => ({
      advanced: false,
      toggleAdvanced: () => set((s) => ({ advanced: !s.advanced })),
      setAdvanced: (advanced) => set({ advanced }),
    }),
    { name: "mckenna-ui-mode" },
  ),
);
