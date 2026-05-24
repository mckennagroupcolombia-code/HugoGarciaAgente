import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BoardStickyLayout = {
  x: number;
  y: number;
  w: number;
  /** Si falta, la altura sigue el contenido. */
  h?: number;
};

export type BoardFrameVariant = "card" | "section" | "task";

const COL_GAP = 16;
const DEFAULT_ROW_H = 220;

export const BOARD_FRAME_SIZES: Record<
  BoardFrameVariant,
  { defaultW: number; minW: number; maxW: number; minH: number; rowH: number }
> = {
  card: { defaultW: 260, minW: 200, maxW: 560, minH: 120, rowH: 220 },
  section: { defaultW: 480, minW: 280, maxW: 1200, minH: 160, rowH: 320 },
  task: { defaultW: 220, minW: 140, maxW: 420, minH: 56, rowH: 72 },
};

export const BOARD_ROOT_SECTION = "__root__";

export function boardLayoutKey(sectionKey: string, cardKey: string): string {
  return `${sectionKey}|${cardKey}`;
}

/** Posición inicial cuando aún no hay layout guardado. */
export function defaultBoardLayout(
  index: number,
  containerWidth: number,
  variant: BoardFrameVariant = "card",
): BoardStickyLayout {
  const cfg = BOARD_FRAME_SIZES[variant];
  const usable = Math.max(containerWidth, cfg.minW + 16);

  if (variant === "section") {
    return {
      x: 8,
      y: index * cfg.rowH + 8,
      w: Math.min(cfg.maxW, usable - 16),
    };
  }

  if (variant === "task") {
    const w = Math.min(cfg.defaultW, usable - 16);
    return {
      x: 8,
      y: index * cfg.rowH + 4,
      w,
    };
  }

  const colW = cfg.defaultW + COL_GAP;
  const cols = Math.max(1, Math.floor((usable + COL_GAP) / colW));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * colW + 4,
    y: row * cfg.rowH + 4,
    w: cfg.defaultW,
  };
}

interface QuestBoardLayoutState {
  layouts: Record<string, BoardStickyLayout>;
  setLayout: (key: string, layout: BoardStickyLayout) => void;
  clearLayout: (key: string) => void;
  resetSection: (sectionKey: string) => void;
  resetAll: () => void;
}

export const useQuestBoardLayout = create<QuestBoardLayoutState>()(
  persist(
    (set) => ({
      layouts: {},
      setLayout: (key, layout) =>
        set((s) => ({
          layouts: {
            ...s.layouts,
            [key]: {
              x: Math.round(layout.x),
              y: Math.round(layout.y),
              w: Math.round(layout.w),
              h: layout.h != null ? Math.round(layout.h) : undefined,
            },
          },
        })),
      clearLayout: (key) =>
        set((s) => {
          const next = { ...s.layouts };
          delete next[key];
          return { layouts: next };
        }),
      resetSection: (sectionKey) =>
        set((s) => {
          const prefix = `${sectionKey}|`;
          const next = { ...s.layouts };
          for (const k of Object.keys(next)) {
            if (k.startsWith(prefix)) delete next[k];
          }
          return { layouts: next };
        }),
      resetAll: () => set({ layouts: {} }),
    }),
    { name: "mckenna-quest-board-layout" },
  ),
);
