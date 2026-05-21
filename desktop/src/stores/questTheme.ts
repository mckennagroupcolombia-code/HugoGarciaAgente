import { create } from "zustand";
import { persist } from "zustand/middleware";

interface QuestThemeState {
  dark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

/** Tema del Centro de Mando / Tablero de Quests (no afecta el resto del panel). */
export const useQuestTheme = create<QuestThemeState>()(
  persist(
    (set) => ({
      dark: true,
      toggle: () => set((s) => ({ dark: !s.dark })),
      setDark: (dark) => set({ dark }),
    }),
    { name: "mckenna-quest-theme" },
  ),
);
