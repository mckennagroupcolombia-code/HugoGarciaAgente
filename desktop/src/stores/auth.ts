import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string;
  setToken: (t: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: "",
      setToken: (token) => set({ token }),
      clear: () => set({ token: "" }),
    }),
    { name: "mckenna-auth" },
  ),
);
