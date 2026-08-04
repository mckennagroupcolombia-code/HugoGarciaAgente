import { create } from "zustand";
import { persist } from "zustand/middleware";

import { conPrivilegiosAdminCynthia } from "../lib/adminAccess";
import type { UserUiPreferences } from "../lib/userThemeSync";

export interface TicketsRol {
  id: number;
  nombre: string;
  nivel: number;
}

export interface TicketsDept {
  id: number;
  nombre: string;
  color: string;
}

export interface TicketsUser {
  id: number;
  nombre: string;
  username: string;
  email?: string | null;
  activo: number;
  foto?: string | null;
  rol: TicketsRol | null;
  departamento: TicketsDept | null;
  permisos_secciones?: Record<string, boolean> | null;
  preferencias_ui?: UserUiPreferences | null;
}

interface TicketsAuthState {
  token: string | null;
  user: TicketsUser | null;
  /** CHAT_API_TOKEN del servidor — solo para usuarios admin (nivel >= 3). */
  apiToken: string | null;
  setAuth: (token: string, user: TicketsUser, apiToken?: string | null) => void;
  clear: () => void;
}

export const useTicketsAuth = create<TicketsAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      apiToken: null,
      setAuth: (token, user, apiToken = null) =>
        set({ token, user: conPrivilegiosAdminCynthia(user), apiToken }),
      clear: () => set({ token: null, user: null, apiToken: null }),
    }),
    {
      name: "mckenna-tickets-auth",
      onRehydrateStorage: () => (state) => {
        if (state?.user) {
          state.user = conPrivilegiosAdminCynthia(state.user);
        }
      },
    },
  ),
);
