import { create } from "zustand";
import { persist } from "zustand/middleware";

export const QUEST_BOARD_TITLE_DEFAULT = "KIMDOM";

interface QuestBoardState {
  title: string;
  setTitle: (title: string) => void;
  resetTitle: () => void;
}

/** Nombre del tablero (Centro de Mando), persistido en este navegador. */
export const useQuestBoardTitle = create<QuestBoardState>()(
  persist(
    (set) => ({
      title: QUEST_BOARD_TITLE_DEFAULT,
      setTitle: (title) => {
        const t = title.trim() || QUEST_BOARD_TITLE_DEFAULT;
        set({ title: t.slice(0, 40) });
      },
      resetTitle: () => set({ title: QUEST_BOARD_TITLE_DEFAULT }),
    }),
    { name: "mckenna-quest-board-title" },
  ),
);
