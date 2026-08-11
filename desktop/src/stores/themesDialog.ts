import { create } from "zustand";

/** Diálogo global de temas (sidebar, cabezote y hub móvil). */
export const useThemesDialog = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
