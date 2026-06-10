import { create } from "zustand";

interface ProfilePhotoPendingState {
  file: File | null;
  setFile: (file: File | null) => void;
}

export const useProfilePhotoPending = create<ProfilePhotoPendingState>((set) => ({
  file: null,
  setFile: (file) => set({ file }),
}));
