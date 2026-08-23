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
  telefono?: string | null;
  /** CC/NIT para cuentas de cobro (emisor). */
  documento_identidad?: string | null;
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
  /** true tras rehidratar localStorage — evita pisar sesión OAuth recién guardada. */
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setAuth: (token: string, user: TicketsUser, apiToken?: string | null) => void;
  clear: () => void;
}

function urlHasOAuthToken(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(new URLSearchParams(window.location.search).get("_token"));
}

export const useTicketsAuth = create<TicketsAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      apiToken: null,
      _hasHydrated: false,
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
      setAuth: (token, user, apiToken = null) =>
        set({ token, user: conPrivilegiosAdminCynthia(user), apiToken }),
      clear: () => set({ token: null, user: null, apiToken: null }),
    }),
    {
      name: "mckenna-tickets-auth",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        apiToken: state.apiToken,
      }),
      merge: (persisted, current) => {
        if (urlHasOAuthToken()) return current as TicketsAuthState;
        return { ...(current as TicketsAuthState), ...(persisted as object) };
      },
      onRehydrateStorage: () => (state, error) => {
        if (!error && state?.user) {
          state.user = conPrivilegiosAdminCynthia(state.user);
        }
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** Marca la sesión como lista (fallback si persist tarda o falla en WebView). */
export function ensureTicketsAuthHydrated(): void {
  if (!useTicketsAuth.getState()._hasHydrated) {
    useTicketsAuth.getState().setHasHydrated(true);
  }
}

/** Espera a que localStorage restaure la sesión de tickets antes de decidir login vs panel. */
export function waitForTicketsAuthHydration(): Promise<void> {
  if (useTicketsAuth.getState()._hasHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useTicketsAuth.subscribe((s) => {
      if (s._hasHydrated) {
        unsub();
        resolve();
      }
    });
  });
}
