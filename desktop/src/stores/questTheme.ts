import { create } from "zustand";

interface QuestThemeState {
  dark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

/** Tema del Centro de Mando / Tablero de Quests (persistido por usuario en el servidor). */
export const useQuestTheme = create<QuestThemeState>()((set) => ({
  dark: true,
  toggle: () => set((s) => ({ dark: !s.dark })),
  setDark: (dark) => set({ dark }),
}));
